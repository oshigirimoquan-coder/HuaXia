// Google 行事曆同步
// action: "setup"  （管理員）建立尚未建立的共用行事曆，非幹部行事曆設為公開唯讀
//         "acl"    （管理員）把幹部的 Google 信箱加入「幹部」行事曆的讀取名單
//         "upsert" （幹部）新增或更新一筆行程 {event_id}
//         "delete" （幹部）刪除 Google 上的行程 {calendar_key, gcal_event_id}
import { admin, callerIs, cors, gcal, json, kindText } from "../_shared/common.ts";

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
        summary: `[${kindText(ev)}] ${ev.title}`,
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
