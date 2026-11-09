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
  if (it.type !== 3 && it.type !== 5) return reply("看不懂這個指令");

  // 選了請假類型 → 馬上跳出小視窗（要在 3 秒內回，所以不查資料庫）
  const cid = String(it.data?.custom_id ?? "");
  if (it.type === 3 && cid.startsWith("ltype:")) return json({ type: 9, data: leaveModal(cid.split(":")[1], it.data.values?.[0]) });

  // 其他的：先回「處理中」，背景做完再把回覆改成結果（第一次啟動比較慢也不會「未及時回應」）
  const finish = async () => {
    let out: Out = "出了點問題，請到網站處理";
    try { out = await handle(it); } catch (e) { console.log("handle failed", e); }
    const msg = typeof out === "string" ? { content: out, components: [] } : out;
    await fetch(`https://discord.com/api/v10/webhooks/${it.application_id}/${it.token}/messages/@original`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg),
    });
  };
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(finish()); return json({ type: 5, data: { flags: 64 } }); }
  const out = await handle(it);
  return json({ type: 4, data: { flags: 64, ...(typeof out === "string" ? { content: out } : out) } });
});

type Out = string | { content: string; components: any[] };
const TYPES: Record<string, string> = { leave: "事假", sick: "病假", official: "公假", late: "晚到", early: "早退" };

// 請假小視窗：晚到／早退多一格時間；事假、公假寫原因或寫「已私訊團長」；病假要私訊團長（照片要到網站上傳）
function leaveModal(eid: string, type: string) {
  const t = TYPES[type] ? type : "leave";
  const input = (custom_id: string, label: string, placeholder: string, style = 1, max = 200) =>
    ({ type: 1, components: [{ type: 4, custom_id, label, placeholder, style, required: true, max_length: max }] });
  const rows = [];
  if (t === "late" || t === "early") rows.push(input("at", t === "late" ? "預計幾點到" : "預計幾點走", "例：19:30", 1, 5));
  rows.push(input("reason", "事由",
    t === "sick" ? "請寫原因，並私訊團長後寫「已私訊團長」（要附證明照片請到網站）"
    : t === "leave" || t === "official" ? "請寫原因；或私訊團長後寫「已私訊團長」"
    : "例：家教卡到、課程延後", 2));
  return { custom_id: `lsub:${eid}:${t}`, title: `請假：${TYPES[t]}`, components: rows };
}

async function handle(it: any): Promise<Out> {
  const [action, eventId, ltype] = String(it.data?.custom_id ?? "").split(":");
  const SITE = Deno.env.get("SITE_URL") ?? "";
  const did = it.member?.user?.id ?? it.user?.id;
  const db = admin();
  // 幹部頻道的測試按鈕：確認接通、也確認認得出是誰
  if (action === "test" && did) {
    const uid = await userOf(db, did);
    const { data: p } = uid ? await db.from("profiles").select("display_name").eq("id", uid).maybeSingle() : { data: null };
    return (p ? `✅ 機器人接通了！你是網站上的「${p.display_name}」。` : "✅ 機器人接通了，但找不到你的網站帳號請到網站「我的」頁面按「連結 Discord」。");
  }
  if (!["yes", "leave", "lsub"].includes(action) || !eventId || !did) return ("這個按鈕已經不能用了");
  const web = SITE ? `：${SITE}#/events/${eventId}` : "";

  const { data: ev } = await db.from("events").select("id, title, starts_at").eq("id", eventId).maybeSingle();
  if (!ev) return ("找不到這個行程，可能已經刪除了");
  if (new Date(ev.starts_at).getTime() < Date.now() - 3 * 3600e3) return (`「${ev.title}」已經結束了`);

  let uid = await userOf(db, did);
  if (!uid) { users = null; uid = await userOf(db, did); }  // 剛註冊的人：重新讀一次
  if (!uid) return (`機器人還不認得你的 Discord。請到網站「我的」頁面按「連結 Discord」（只要做一次）${SITE ? `：${SITE}#/me` : ""}\n這次可以先到網站處理${web}`);

  const { data: open } = await db.rpc("unanswered", { eid: ev.id });
  const notYet = (open ?? []).some((r: any) => r.user_id === uid);
  const { data: row } = await db.from("leave_requests").select("type, proof_paths").eq("event_id", ev.id).eq("user_id", uid).maybeSingle();
  const { data: att } = await db.from("attendance").select("status").eq("event_id", ev.id).eq("user_id", uid).maybeSingle();
  if (att) return ("這場已經點過名了");
  if (!notYet && !row) return (`「${ev.title}」這次沒有排到你，不用到`);

  if (action === "yes") {
    if (row?.type === "attend") return (`你已經確認會去「${ev.title}」了`);
    if (row) return (`你已經請${TYPES[row.type] ?? "假"}了；要改成會去的話到網站修改${web}`);
    const { error } = await db.from("leave_requests").upsert({ event_id: ev.id, user_id: uid, type: "attend", reason: "" });
    return (error ? `沒有記成功，請到網站按出席${web}` : `✅ 已確認會去「${ev.title}」，到時見！`);
  }

  if (action === "leave") {
    // 先選類型（下一步會跳出小視窗填事由）
    const now = row && row.type !== "attend" ? `（目前是：${TYPES[row.type] ?? row.type}，選了會改掉）` : "";
    return {
      content: `「${ev.title}」要請哪一種？${now}`,
      components: [{ type: 1, components: [{ type: 3, custom_id: `ltype:${ev.id}`, placeholder: "選擇請假類型", options: [
        { label: "事假", value: "leave", description: "私訊團長或寫原因（擇一）" },
        { label: "病假", value: "sick", description: "要私訊團長，或到網站上傳證明" },
        { label: "公假", value: "official", description: "學校活動、比賽、系上公務" },
        { label: "晚到", value: "late", description: "填預計幾點到" },
        { label: "早退", value: "early", description: "填預計幾點走" },
      ] }] }],
    };
  }

  // lsub：小視窗送出
  const t = TYPES[ltype] ? ltype : "leave";
  const field = (id: string) => (it.data?.components ?? []).flatMap((r: any) => r.components ?? []).find((c: any) => c.custom_id === id)?.value?.trim() ?? "";
  let reason = field("reason");
  if (!reason) return ("事由要填喔");
  const dm = /私訊/.test(reason);
  if (t === "late" || t === "early") {
    const m = field("at").replace(/[：.]/g, ":").match(/^(\d{1,2}):?(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) return (`時間看不懂，請寫成像「19:30」這樣，再按一次「請假」`);
    reason = `【${m[1].padStart(2, "0")}:${m[2]} ${t === "late" ? "到" : "走"}】${reason}`;
  }
  const keepProofs = t === "sick" && row?.type === "sick" ? row.proof_paths ?? [] : [];
  if (t === "sick" && !dm && !keepProofs.length) return (`病假要附證明：請私訊團長後，再按一次「請假」並在事由寫「已私訊團長」；或到網站上傳證明照片${web}`);
  const { error } = await db.from("leave_requests").upsert({
    event_id: ev.id, user_id: uid, type: t, reason,
    proof_paths: keepProofs, proof_dm: t === "sick" || t === "leave" || t === "official" ? dm : false,
  });
  if (error) { console.log("leave upsert failed", error.message); return (`沒有送出成功，請到網站請假${web}`); }
  return (`✅ 已送出「${ev.title}」${TYPES[t]}：${reason.replace(/^【(.+?)】/, "$1，")}`);
}
