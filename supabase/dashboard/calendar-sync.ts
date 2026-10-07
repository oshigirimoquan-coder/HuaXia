// calendar-sync：自動產生的單檔版本（來源 supabase/functions/calendar-sync），請勿直接修改
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
export async function discord(url: string | undefined, content: string) {
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: [] } }),
  });
  return res.ok;
}

export const KIND: Record<string, string> = {
  tutti: "大團", sizhu: "絲竹", extra: "加練", sectional: "分部課", class: "教學班",
  dress: "總彩", concert: "公演", officer: "幹部會議", other: "活動",
};

export const twTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

// Google 行事曆同步
// action: "setup"  （管理員）建立尚未建立的共用行事曆，非幹部行事曆設為公開唯讀
//         "acl"    （管理員）把幹部的 Google 信箱加入「幹部」行事曆的讀取名單
//         "upsert" （幹部）新增或更新一筆行程 {event_id}
//         "delete" （幹部）刪除 Google 上的行程 {calendar_key, gcal_event_id}

const SITE = Deno.env.get("SITE_URL") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const db = admin();

    if (body.action === "setup" || body.action === "acl") {
      if (!(await callerIs(req, "is_admin"))) return json({ error: "只有管理員可以設定行事曆" }, 403);
    } else if (!(await callerIs(req, "is_officer"))) {
      return json({ error: "只有幹部可以同步行程" }, 403);
    }

    if (body.action === "setup") {
      const { data: cals } = await db.from("calendars").select("*").order("sort");
      const out = [];
      for (const c of cals ?? []) {
        let id = c.gcal_id;
        if (!id) {
          const created = await gcal("/calendars", "POST", { summary: c.name, timeZone: "Asia/Taipei" });
          id = created.id;
          await db.from("calendars").update({ gcal_id: id }).eq("key", c.key);
        }
        if (c.audience !== "officers") {
          await gcal(`/calendars/${encodeURIComponent(id)}/acl`, "POST", { role: "reader", scope: { type: "default" } });
        }
        out.push({ key: c.key, gcal_id: id });
      }
      return json({ ok: true, calendars: out });
    }

    if (body.action === "acl") {
      const { data: cal } = await db.from("calendars").select("gcal_id").eq("key", "officers").single();
      if (!cal?.gcal_id) return json({ error: "請先執行行事曆初始化" }, 400);
      const { data: rows } = await db.from("user_roles").select("user_id").in("role", ["admin", "officer"]);
      const ids = [...new Set((rows ?? []).map((r) => r.user_id))];
      const { data: priv } = await db.from("profile_private").select("google_email").in("user_id", ids);
      const want = new Set((priv ?? []).map((p) => p.google_email?.trim().toLowerCase()).filter(Boolean));
      const base = `/calendars/${encodeURIComponent(cal.gcal_id)}/acl`;
      const acl = await gcal(base);
      const have = new Map<string, string>();
      for (const r of acl.items ?? []) if (r.scope?.type === "user" && r.role === "reader") have.set(r.scope.value.toLowerCase(), r.id);
      for (const e of want) if (!have.has(e)) await gcal(base, "POST", { role: "reader", scope: { type: "user", value: e } });
      for (const [e, rid] of have) if (!want.has(e)) await gcal(`${base}/${encodeURIComponent(rid)}`, "DELETE");
      return json({ ok: true, readers: [...want].length });
    }

    if (body.action === "delete") {
      const { data: cal } = await db.from("calendars").select("gcal_id").eq("key", body.calendar_key).single();
      if (cal?.gcal_id && body.gcal_event_id) {
        await gcal(`/calendars/${encodeURIComponent(cal.gcal_id)}/events/${encodeURIComponent(body.gcal_event_id)}`, "DELETE");
      }
      return json({ ok: true });
    }

    if (body.action === "upsert") {
      const { data: ev } = await db.from("events").select("*").eq("id", body.event_id).single();
      if (!ev) return json({ error: "找不到行程" }, 404);
      const { data: cal } = await db.from("calendars").select("gcal_id").eq("key", ev.calendar_key).single();
      if (!cal?.gcal_id) return json({ error: "這本行事曆尚未初始化，請管理員到設定頁執行「建立行事曆」" }, 400);
      const { data: ps } = await db.from("event_pieces").select("pieces(title)").eq("event_id", ev.id);
      const pieces = (ps ?? []).map((p: any) => p.pieces?.title).filter(Boolean);
      const desc = [
        pieces.length ? `練習曲目：${pieces.join("、")}` : "",
        ev.note,
        SITE ? `請假與詳情：${SITE}#/events/${ev.id}` : "",
      ].filter(Boolean).join("\n\n");
      const payload = {
        summary: `[${KIND[ev.kind] ?? "活動"}] ${ev.title}`,
        location: ev.location,
        description: desc,
        start: { dateTime: ev.starts_at, timeZone: "Asia/Taipei" },
        end: { dateTime: ev.ends_at, timeZone: "Asia/Taipei" },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 24 * 60 }, { method: "popup", minutes: 60 }] },
      };
      const base = `/calendars/${encodeURIComponent(cal.gcal_id)}/events`;
      let gid = ev.gcal_event_id;
      if (gid) {
        try { await gcal(`${base}/${encodeURIComponent(gid)}`, "PUT", payload); }
        catch { gid = null; }
      }
      if (!gid) {
        const created = await gcal(base, "POST", payload);
        gid = created.id;
        await db.from("events").update({ gcal_event_id: gid }).eq("id", ev.id);
      }
      return json({ ok: true, gcal_event_id: gid });
    }

    return json({ error: "未知的 action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
