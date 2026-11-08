// discord-interact：自動產生的單檔版本（來源 supabase/functions/discord-interact），請勿直接修改
// 共用工具：CORS、身分檢查、Google 存取權杖、Discord 發文
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// 以呼叫者身分檢查角色（is_officer / is_admin）
export async function callerIs(req: Request, fn: "is_officer" | "is_admin"): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await c.rpc(fn);
  return data === true;
}

// ---------- Google 服務帳戶 → 存取權杖 ----------
let cached: { token: string; exp: number } | null = null;
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = ""; bytes.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function googleToken(): Promise<string> {
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.token;
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("尚未設定 GOOGLE_SERVICE_ACCOUNT");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claim}.${b64url(sig)}`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Google 授權失敗：" + JSON.stringify(j));
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

export async function gcal(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => null);
  if (!res.ok && !(method === "DELETE" && res.status === 410)) {
    throw new Error(`Google Calendar ${method} ${path}: ${res.status} ${JSON.stringify(j)}`);
  }
  return j;
}

// ---------- Discord ----------
// buttons：[文字, 網址, 互動代碼?]。
// 有設定 DISCORD_BOT_TOKEN 時改由機器人發文，帶互動代碼的按鈕在 Discord 裡按了就直接處理（discord-interact 函式）；
// 沒有機器人時用 webhook，按鈕都變成「打開網址」。Webhook 要加 ?with_components=true 才能放按鈕；失敗就改成附網址再送一次
export type Btn = [string, string, string?];
const channelOf = new Map<string, string>();
async function webhookChannel(url: string) {
  if (!channelOf.has(url)) {
    const r = await fetch(url).catch(() => null);
    const id = r?.ok ? (await r.json()).channel_id : "";
    channelOf.set(url, id || "");
  }
  return channelOf.get(url)!;
}
const rows = (buttons: Btn[], interactive: boolean) => Array.from({ length: Math.ceil(Math.min(buttons.length, 25) / 5) }, (_, i) => ({
  type: 1,
  components: buttons.slice(i * 5, i * 5 + 5).map(([label, u, id]) => interactive && id
    ? { type: 2, style: 3, label: label.slice(0, 80), custom_id: id }
    : { type: 2, style: 5, label: label.slice(0, 80), url: u }),
}));
export async function discord(url: string | undefined, content: string, mention: { users?: string[]; roles?: string[] } = {}, buttons: Btn[] = []) {
  if (!url) return false;
  const base = { content: content.slice(0, 1990), allowed_mentions: { parse: [], users: mention.users ?? [], roles: mention.roles ?? [] } };
  const bot = Deno.env.get("DISCORD_BOT_TOKEN");
  if (bot && buttons.some((b) => b[2])) {
    const ch = await webhookChannel(url);
    if (ch) {
      const r = await fetch(`https://discord.com/api/v10/channels/${ch}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${bot}` },
        body: JSON.stringify({ ...base, components: rows(buttons, true) }),
      });
      if (r.ok) return true;
      console.log("bot send failed", ch, r.status, await r.text());
    }
  }
  const send = (withButtons: boolean, text = base.content) => fetch(withButtons ? `${url}${url.includes("?") ? "&" : "?"}with_components=true` : url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, content: text, ...(withButtons ? { components: rows(buttons, false) } : {}) }),
  });
  if (buttons.length) {
    const res = await send(true);
    if (res.ok) return true;
    return (await send(false, (content + "\n" + buttons.map(([l, u]) => `${l}：${u}`).join("\n")).slice(0, 1990))).ok;
  }
  return (await send(false)).ok;
}

export const KIND: Record<string, string> = {
  tutti: "大團", sizhu: "絲竹", extra: "加練", sectional: "分部課", class: "教學班",
  dress: "總彩", concert: "公演", officer: "幹部會議", other: "活動",
};

// 複選類型：大團・絲竹；只有幹部會議時才算幹部行程
export const kindsOf = (e: any): string[] => (e.kinds?.length ? e.kinds : [e.kind]);
export const kindText = (e: any) => kindsOf(e).map((k) => KIND[k] ?? "活動").join("・");
export const officerOnly = (e: any) => kindsOf(e).every((k) => k === "officer");

export const twTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

// Discord 機器人的按鈕：在 Discord 按「✅ 確定會去」就直接幫他記出席，回一句只有他看得到的訊息
// Discord 開發者後台的 Interactions Endpoint URL 填這個函式的網址；Verify JWT 要關掉（改用 Discord 簽章驗證）
// Secrets：DISCORD_PUBLIC_KEY（應用程式的 Public Key）

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
