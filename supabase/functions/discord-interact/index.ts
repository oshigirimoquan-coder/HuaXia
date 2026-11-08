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

// Discord 帳號 → 網站帳號（用 Discord 登入過網站的人才找得到）
let users: Map<string, string> | null = null;
async function userOf(db: ReturnType<typeof admin>, did: string) {
  if (!users) {
    users = new Map();
    for (let page = 1; page <= 5; page++) {
      const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      for (const u of data?.users ?? []) {
        for (const i of u.identities ?? []) {
          if (i.provider !== "discord") continue;
          const d: any = i.identity_data ?? {};
          for (const id of [d.provider_id, d.sub, d.id, (i as any).provider_id, i.id]) if (id) users.set(String(id), u.id);
        }
      }
      if ((data?.users?.length ?? 0) < 1000) break;
    }
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

  const [action, eventId] = String(it.data?.custom_id ?? "").split(":");
  const SITE = Deno.env.get("SITE_URL") ?? "";
  const did = it.member?.user?.id ?? it.user?.id;
  if (action !== "yes" || !eventId || !did) return reply("這個按鈕已經不能用了");

  const db = admin();
  const { data: ev } = await db.from("events").select("id, title, starts_at").eq("id", eventId).maybeSingle();
  if (!ev) return reply("找不到這個行程，可能已經刪除了");
  if (new Date(ev.starts_at).getTime() < Date.now() - 3 * 3600e3) return reply(`「${ev.title}」已經結束了`);

  let uid = await userOf(db, did);
  if (!uid) { users = null; uid = await userOf(db, did); }  // 剛註冊的人：重新讀一次
  if (!uid) return reply(`找不到你的網站帳號。請先用 Discord 登入網站一次${SITE ? `：${SITE}#/events/${ev.id}/yes` : ""}`);

  const { data: open } = await db.rpc("unanswered", { eid: ev.id });
  if ((open ?? []).some((r: any) => r.user_id === uid)) {
    const { error } = await db.from("leave_requests").upsert({ event_id: ev.id, user_id: uid, type: "attend", reason: "" });
    return reply(error ? `沒有記成功，請到網站按出席${SITE ? `：${SITE}#/events/${ev.id}` : ""}` : `✅ 已確認會去「${ev.title}」，到時見！`);
  }
  const { data: row } = await db.from("leave_requests").select("type").eq("event_id", ev.id).eq("user_id", uid).maybeSingle();
  if (row?.type === "attend") return reply(`你已經確認會去「${ev.title}」了`);
  if (row) return reply(`你已經請假了；要改的話到網站修改${SITE ? `：${SITE}#/events/${ev.id}` : ""}`);
  const { data: att } = await db.from("attendance").select("status").eq("event_id", ev.id).eq("user_id", uid).maybeSingle();
  if (att) return reply("這場已經點過名了");
  return reply(`「${ev.title}」這次沒有排到你，不用到`);
});
