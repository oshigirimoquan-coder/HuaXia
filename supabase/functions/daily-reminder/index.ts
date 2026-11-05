// 每天晚上 20:00（台北）由排程呼叫：提醒明天的行程與幹部任務；明天要算出席、還沒回覆的人，到他那組的頻道 @ 他
// 呼叫時需帶 header  x-cron-secret: <CRON_SECRET>
import { admin, cors, discord, json, kindsOf, kindText, officerOnly } from "../_shared/common.ts";

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
  // 每場事先回覆的狀況（應到幾人、幾人回覆）
  const rates = new Map<string, any>();
  for (const sem of new Set((events ?? []).filter((e) => e.counts_attendance && e.semester_id).map((e) => e.semester_id))) {
    const { data } = await db.rpc("event_rates", { sem });
    for (const r of data ?? []) rates.set(r.event_id, r);
  }
  const line = (e: any) => {
    const ps = (e.event_pieces ?? []).map((x: any) => x.pieces?.title).filter(Boolean);
    const r = rates.get(e.id);
    const reply = r && r.expected ? `\n　應到 ${r.expected} 人：已回覆出席 ${r.said_yes}、請假 ${r.said_off}、晚到早退 ${r.said_late}、還沒回覆 ${r.no_reply}` : "";
    return `• ${hhmm(e.starts_at)}–${hhmm(e.ends_at)} [${kindText(e)}] ${e.title}${e.location ? `｜${e.location}` : ""}${ps.length ? `\n　曲目：${ps.join("、")}` : ""}${reply}`;
  };
  const pub = (events ?? []).filter((e) => !officerOnly(e));
  const off = (events ?? []).filter((e) => officerOnly(e));
  const sent: string[] = [];
  if (pub.length && await discord(hooks.announce, `**明天的行程**\n${pub.map(line).join("\n")}\n\n不能到的請先請假${SITE ? `：${SITE}` : ""}`)) sent.push("announce");

  // 還沒回覆（沒按出席，也沒請假／晚到／早退）的人：依組別發到各組頻道（沒設定就發公告頻道）並 @ 他
  let nagged = 0;
  for (const e of pub.filter((x) => x.counts_attendance)) {
    const { data: rows } = await db.rpc("unanswered", { eid: e.id });
    if (!rows?.length) continue;
    const { data: ids } = await db.rpc("discord_ids", { uids: rows.map((r: any) => r.user_id) });
    const did = new Map((ids ?? []).map((x: any) => [x.user_id, x.discord_id]));
    const evSecs: string[] = kindsOf(e).includes("sectional") ? (e.sections?.length ? e.sections : [e.section]) : [];
    const bySec = new Map<string, any[]>();
    for (const r of rows) {
      const secs: string[] = r.sections ?? [];
      const sec = secs.find((s) => evSecs.includes(s)) ?? secs[0] ?? "";
      if (!bySec.has(sec)) bySec.set(sec, []);
      bySec.get(sec)!.push(r);
    }
    for (const [sec, list] of bySec) {
      const users = list.map((r) => did.get(r.user_id)).filter(Boolean) as string[];
      const who = list.map((r) => (did.get(r.user_id) ? `<@${did.get(r.user_id)}>` : r.display_name)).join(" ");
      const text = `**明天 ${hhmm(e.starts_at)} ${e.title}**（${kindText(e)}）還沒回覆要不要來：\n${who}\n\n會到請按「出席」；不能來、會晚到或早退，請請假並寫事由${SITE ? `：${SITE}` : ""}`;
      if (await discord(hooks.sections?.[sec] ?? hooks.announce, text, { users: users.slice(0, 100) })) nagged += list.length;
    }
  }
  if (nagged) sent.push(`unanswered:${nagged}`);

  const { data: tasks } = await db.from("tasks").select("title, due").eq("due", day).neq("status", "done");
  const offText = [
    off.length ? `**明天的幹部行程**\n${off.map(line).join("\n")}` : "",
    tasks?.length ? `**明天到期的任務**\n${tasks.map((t) => `• ${t.title}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (offText && await discord(hooks.officers, offText)) sent.push("officers");

  return json({ ok: true, day, events: events?.length ?? 0, sent });
});
