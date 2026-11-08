// daily-reminder：自動產生的單檔版本（來源 supabase/functions/daily-reminder），請勿直接修改
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

// 每天晚上 20:00（台北）由排程呼叫：提醒明天的行程與幹部任務；
// 每週日：把下週一到週日要算出席的行程，在還有人沒回覆的那幾組頻道問一次（不 @ 人），一場一個「確定會去」按鈕；
// 明天：還沒回覆的人到他那組的頻道 @ 他，附「確定會去」「請假」按鈕
// 呼叫時需帶 header  x-cron-secret: <CRON_SECRET>

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  const db = admin();
  const SITE = Deno.env.get("SITE_URL") ?? "";

  // 台北時間的「明天」（週日另外看下週一到週日）
  const twDay = (n: number) => { const t = new Date(Date.now() + 8 * 3600e3); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const range = (d: string) => [new Date(`${d}T00:00:00+08:00`).toISOString(), new Date(`${d}T23:59:59+08:00`).toISOString()];
  const day = twDay(1);
  const [from, to] = range(day);

  const { data: d } = await db.from("private_settings").select("value").eq("key", "discord").maybeSingle();
  const hooks = d?.value ?? {};
  const { data: events } = await db.from("events").select("*, event_pieces(pieces(title))")
    .gte("starts_at", from).lte("starts_at", to).order("starts_at");

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
  // 每場事先回覆的狀況（應到幾人、幾人回覆）
  const rates = new Map<string, any>();
  for (const sem of new Set((events ?? []).filter((e) => e.counts_attendance && e.semester_id).map((e) => e.semester_id))) {
    const { data } = await db.rpc("event_rates", { sem });
    for (const r of data ?? []) rates.set(r.event_id, r);
  }
  const WK = "日一二三四五六";
  const md = (iso: string) => { const t = new Date(new Date(iso).getTime() + 8 * 3600e3); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WK[t.getUTCDay()]}）`; };
  // 行程的備註（例如「19:30 草蜢／20:30 春節序曲」），每行縮排放在行程下面
  // 備註沒寫，就自動寫開始到結束的時間，和勾選的曲目
  const piecesOf = (e: any) => (e.event_pieces ?? []).map((x: any) => x.pieces?.title).filter(Boolean) as string[];
  const noteLines = (e: any) => (e.note ?? "").trim() ? "\n" + e.note.trim().split(/\r?\n/).filter((l: string) => l.trim()).map((l: string) => `　${l.trim()}`).join("\n") : `\n　${hhmm(e.starts_at)}–${hhmm(e.ends_at)}${piecesOf(e).length ? `\n　曲目：${piecesOf(e).join("、")}` : ""}`;
  // 公告：• 11/10（二）週二絲竹 | 721，下面放備註和回覆狀況
  const line = (e: any) => {
    const r = rates.get(e.id);
    const reply = r && r.expected ? `\n　應到 ${r.expected} 人：已回覆出席 ${r.said_yes}、請假 ${r.said_off}、晚到早退 ${r.said_late}、還沒回覆 ${r.no_reply}` : "";
    return `• ${md(e.starts_at)}${e.title}${e.location ? ` | ${e.location}` : ""}${noteLines(e)}${reply}`;
  };
  const pub = (events ?? []).filter((e) => !officerOnly(e));
  const off = (events ?? []).filter((e) => officerOnly(e));
  const sent: string[] = [];
  if (pub.length && await discord(hooks.announce, `**明天的行程**\n${pub.map(line).join("\n")}\n不能到的請先請假${SITE ? `：${SITE}` : ""}`)) sent.push("announce");

  // 還沒回覆（沒按出席，也沒請假／晚到／早退）的人：依組別發到各組頻道（沒設定就發公告頻道）並 @ 他，附按鈕
  let nagged = 0;
  // 還沒回覆的人依組別分（分部課先算這次上課的組）；沒設定組頻道的發到公告頻道
  async function unansweredBySec(e: any) {
    const { data: rows } = await db.rpc("unanswered", { eid: e.id });
    const evSecs: string[] = kindsOf(e).includes("sectional") ? (e.sections?.length ? e.sections : [e.section]) : [];
    const bySec = new Map<string, any[]>();
    for (const r of rows ?? []) {
      const secs: string[] = r.sections ?? [];
      const sec = secs.find((s) => evSecs.includes(s)) ?? secs[0] ?? "";
      if (!bySec.has(sec)) bySec.set(sec, []);
      bySec.get(sec)!.push(r);
    }
    return bySec;
  }
  const hookOf = (sec: string) => hooks.sections?.[sec] ?? hooks.announce;

  // 明天：@ 還沒回覆的人
  for (const e of pub.filter((x) => x.counts_attendance)) {
    const bySec = await unansweredBySec(e);
    if (!bySec.size) continue;
    const all = [...bySec.values()].flat();
    const { data: ids } = await db.rpc("discord_ids", { uids: all.map((r: any) => r.user_id) });
    const did = new Map((ids ?? []).map((x: any) => [x.user_id, x.discord_id]));
    const buttons: Btn[] = SITE ? [["✅ 確定會去", `${SITE}#/events/${e.id}/yes`, `yes:${e.id}`], ["請假／晚到早退", `${SITE}#/events/${e.id}`]] : [];
    for (const [sec, list] of bySec) {
      const users = list.map((r) => did.get(r.user_id)).filter(Boolean) as string[];
      const who = list.map((r) => (did.get(r.user_id) ? `<@${did.get(r.user_id)}>` : r.display_name)).join(" ");
      const text = `**明天 ${md(e.starts_at)}${e.title}** 會到嗎？${noteLines(e)}\n還沒回覆的人：\n${who}\n\n會到請按「確定會去」；不能來、會晚到或早退，請按「請假」並寫事由`;
      if (await discord(hookOf(sec), text, { users: users.slice(0, 100) }, buttons)) nagged += list.length;
    }
  }

  // 每週日：下週的行程一次問完，不 @ 人，一場一個按鈕
  let weekly = 0;
  if (new Date(Date.now() + 8 * 3600e3).getUTCDay() === 0) {
    const [wf] = range(twDay(1)), [, wt] = range(twDay(7));
    const { data: wk } = await db.from("events").select("*, event_pieces(pieces(title))").gte("starts_at", wf).lte("starts_at", wt).eq("counts_attendance", true).order("starts_at");
    const byHook = new Map<string, any[]>();
    for (const e of (wk ?? []).filter((x) => !officerOnly(x))) {
      for (const sec of (await unansweredBySec(e)).keys()) {
        const h = hookOf(sec);
        if (!h) continue;
        if (!byHook.has(h)) byHook.set(h, []);
        if (!byHook.get(h)!.includes(e)) byHook.get(h)!.push(e);
      }
    }
    for (const [h, list] of byHook) {
      const text = `**下週的練習，會到嗎？**\n${list.map((e) => `• ${md(e.starts_at)}${e.title}${noteLines(e)}`).join("\n")}\n\n會到的那幾場，按下面對應的「確定會去」；不能來、會晚到或早退，請到網站請假${SITE ? `：${SITE}#/events` : ""}`;
      const buttons: Btn[] = SITE ? list.map((e) => [`✅ ${md(e.starts_at)}${e.title}`, `${SITE}#/events/${e.id}/yes`, `yes:${e.id}`]) : [];
      if (await discord(h, text, {}, buttons)) weekly++;
    }
  }
  if (weekly) sent.push(`weekly:${weekly}`);
  if (nagged) sent.push(`unanswered:${nagged}`);

  const { data: tasks } = await db.from("tasks").select("title, due").eq("due", day).neq("status", "done");
  const offText = [
    off.length ? `**明天的幹部行程**\n${off.map(line).join("\n")}` : "",
    tasks?.length ? `**明天到期的任務**\n${tasks.map((t) => `• ${t.title}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (offText && await discord(hooks.officers, offText)) sent.push("officers");

  return json({ ok: true, day, events: events?.length ?? 0, sent });
});
