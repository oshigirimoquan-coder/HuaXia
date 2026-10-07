// 每天晚上 20:00（台北）由排程呼叫：提醒明天的行程與幹部任務
// 呼叫時需帶 header  x-cron-secret: <CRON_SECRET>
import { admin, cors, discord, json, KIND } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  const db = admin();
  const SITE = Deno.env.get("SITE_URL") ?? "";

  // 台北時間的「明天」
  const tw = new Date(Date.now() + 8 * 3600e3);
  tw.setUTCDate(tw.getUTCDate() + 1);
  const day = tw.toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00+08:00`).toISOString();
  const to = new Date(`${day}T23:59:59+08:00`).toISOString();

  const { data: d } = await db.from("private_settings").select("value").eq("key", "discord").maybeSingle();
  const hooks = d?.value ?? {};
  const { data: events } = await db.from("events").select("*, event_pieces(pieces(title))")
    .gte("starts_at", from).lte("starts_at", to).order("starts_at");

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
  const line = (e: any) => {
    const ps = (e.event_pieces ?? []).map((x: any) => x.pieces?.title).filter(Boolean);
    return `• ${hhmm(e.starts_at)}–${hhmm(e.ends_at)} [${KIND[e.kind] ?? "活動"}] ${e.title}${e.location ? `｜${e.location}` : ""}${ps.length ? `\n　曲目：${ps.join("、")}` : ""}`;
  };
  const pub = (events ?? []).filter((e) => e.kind !== "officer");
  const off = (events ?? []).filter((e) => e.kind === "officer");
  const sent: string[] = [];
  if (pub.length && await discord(hooks.announce, `**明天的行程**\n${pub.map(line).join("\n")}\n\n不能到的請先請假${SITE ? `：${SITE}` : ""}`)) sent.push("announce");

  const { data: tasks } = await db.from("tasks").select("title, due").eq("due", day).neq("status", "done");
  const offText = [
    off.length ? `**明天的幹部行程**\n${off.map(line).join("\n")}` : "",
    tasks?.length ? `**明天到期的任務**\n${tasks.map((t) => `• ${t.title}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (offText && await discord(hooks.officers, offText)) sent.push("officers");

  return json({ ok: true, day, events: events?.length ?? 0, sent });
});
