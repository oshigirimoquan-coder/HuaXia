// Discord 機器人的按鈕：在 Discord 按「✅ 確定會去」就直接幫他記出席，回一句只有他看得到的訊息
// Discord 開發者後台的 Interactions Endpoint URL 填這個函式的網址；Verify JWT 要關掉（改用 Discord 簽章驗證）
// Secrets：DISCORD_PUBLIC_KEY（應用程式的 Public Key）
import { admin, json } from "../_shared/common.ts";

const hex = (h: string) => new Uint8Array((h.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
let key: CryptoKey | null = null;
async function verified(req: Request, body: string) {
  const sig = req.headers.get("x-signature-ed25519"), ts = req.headers.get("x-signature-timestamp");
  const pub = Deno.env.get("DISCORD_PUBLIC_KEY");
  if (!sig || !ts || !pub) return false;
  key ??= await crypto.subtle.importKey("raw", hex(pub), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + body));
}
const reply = (content: string) => json({ type: 4, data: { content, flags: 64 } });  // 64 = 只有按的人看得到

// Discord 帳號 → 網站帳號（用 Discord 登入或在「我的」頁面連結過 Discord 的人才找得到）
// 跟每晚提醒 @ 人用的是同一個查法（discord_ids），從登入紀錄裡的 Discord 身分對回社員
let users: Map<string, string> | null = null;
async function userOf(db: ReturnType<typeof admin>, did: string) {
  if (!users) {
    users = new Map();
    const { data: ps } = await db.from("profiles").select("id");
    const ids = (ps ?? []).map((p: any) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await db.rpc("discord_ids", { uids: ids.slice(i, i + 500) });
      if (error) console.log("discord_ids failed", error.message);
      for (const r of data ?? []) if (r.discord_id) users.set(String(r.discord_id), r.user_id);
    }
    console.log("discord accounts known:", users.size);
  }
  return users.get(did);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.text();
  if (!(await verified(req, body))) return new Response("invalid request signature", { status: 401 });
  const it = JSON.parse(body);
  if (it.type === 1) return json({ type: 1 });  // Discord 檢查網址用的 PING
  if (it.type !== 3) return reply("看不懂這個指令");

  // Discord 只等 3 秒：先回「處理中」，背景做完再把回覆改成結果（第一次啟動比較慢也不會「未及時回應」）
  const finish = async () => {
    let text = "出了點問題，請到網站按出席";
    try { text = await handle(it); } catch (e) { console.log("handle failed", e); }
    await fetch(`https://discord.com/api/v10/webhooks/${it.application_id}/${it.token}/messages/@original`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }),
    });
  };
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(finish()); return json({ type: 5, data: { flags: 64 } }); }
  return reply(await handle(it));
});

async function handle(it: any): Promise<string> {
  const [action, eventId] = String(it.data?.custom_id ?? "").split(":");
  const SITE = Deno.env.get("SITE_URL") ?? "";
  const did = it.member?.user?.id ?? it.user?.id;
  const db = admin();
  // 幹部頻道的測試按鈕：確認接通、也確認認得出是誰
  if (action === "test" && did) {
    const uid = await userOf(db, did);
    const { data: p } = uid ? await db.from("profiles").select("display_name").eq("id", uid).maybeSingle() : { data: null };
    return (p ? `✅ 機器人接通了！你是網站上的「${p.display_name}」。` : "✅ 機器人接通了，但找不到你的網站帳號請到網站「我的」頁面按「連結 Discord」。");
  }
  if (action !== "yes" || !eventId || !did) return ("這個按鈕已經不能用了");

  const { data: ev } = await db.from("events").select("id, title, starts_at").eq("id", eventId).maybeSingle();
  if (!ev) return ("找不到這個行程，可能已經刪除了");
  if (new Date(ev.starts_at).getTime() < Date.now() - 3 * 3600e3) return (`「${ev.title}」已經結束了`);

  let uid = await userOf(db, did);
  if (!uid) { users = null; uid = await userOf(db, did); }  // 剛註冊的人：重新讀一次
  if (!uid) return (`機器人還不認得你的 Discord。請到網站「我的」頁面按「連結 Discord」（只要做一次）${SITE ? `：${SITE}#/me` : ""}\n這次可以先到這裡按出席${SITE ? `：${SITE}#/events/${ev.id}/yes` : ""}`);

  const { data: open } = await db.rpc("unanswered", { eid: ev.id });
  if ((open ?? []).some((r: any) => r.user_id === uid)) {
    const { error } = await db.from("leave_requests").upsert({ event_id: ev.id, user_id: uid, type: "attend", reason: "" });
    return (error ? `沒有記成功，請到網站按出席${SITE ? `：${SITE}#/events/${ev.id}` : ""}` : `✅ 已確認會去「${ev.title}」，到時見！`);
  }
  const { data: row } = await db.from("leave_requests").select("type").eq("event_id", ev.id).eq("user_id", uid).maybeSingle();
  if (row?.type === "attend") return (`你已經確認會去「${ev.title}」了`);
  if (row) return (`你已經請假了；要改的話到網站修改${SITE ? `：${SITE}#/events/${ev.id}` : ""}`);
  const { data: att } = await db.from("attendance").select("status").eq("event_id", ev.id).eq("user_id", uid).maybeSingle();
  if (att) return ("這場已經點過名了");
  return (`「${ev.title}」這次沒有排到你，不用到`);
}
