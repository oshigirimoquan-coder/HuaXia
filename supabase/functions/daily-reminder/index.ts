// 每日提醒，由排程呼叫（header 需帶 x-cron-secret: <CRON_SECRET>）
// - 晚上 20:00（台北，body 不帶 mode）：明天的行程、明天到期的幹部任務；明天中午以前開始的練習，順便 @ 還沒回覆的人
// - 中午 12:00（台北，body {"mode":"noon"}）：今天中午以後的練習，還沒回覆要不要來的人，到他那組的頻道 @ 他
import { admin, cors, discord, json, kindsOf, kindText, officerOnly } from "../_shared/common.ts";

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
const twDay = (offsetDays: number) => {
  const tw = new Date(Date.now() + 8 * 3600e3);
  tw.setUTCDate(tw.getUTCDate() + offsetDays);
  return tw.toISOString().slice(0, 10);
};
const at = (day: string, time: string) => new Date(`${day}T${time}+08:00`).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  const db = admin();
  const SITE = Deno.env.get("SITE_URL") ?? "";
  const mode = ((await req.json().catch(() => ({}))) as any)?.mode === "noon" ? "noon" : "night";

  const { data: d } = await db.from("private_settings").select("value").eq("key", "discord").maybeSingle();
  const hooks = d?.value ?? {};
  const sent: string[] = [];

  // 還沒回覆（沒按出席，也沒請假／晚到／早退）的人：依組別發到各組頻道（沒設定就發公告頻道）並 @ 他
  async function nag(list: any[], when: string) {
    let n = 0;
    for (const e of list.filter((x) => x.counts_attendance && !officerOnly(x))) {
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
      for (const [sec, people] of bySec) {
        const users = people.map((r) => did.get(r.user_id)).filter(Boolean) as string[];
        const who = people.map((r) => (did.get(r.user_id) ? `<@${did.get(r.user_id)}>` : r.display_name)).join(" ");
        const text = `**${when} ${hhmm(e.starts_at)} ${e.title}**（${kindText(e)}）還沒回覆要不要來：\n${who}\n\n會到請按「出席」；不能來、會晚到或早退，請請假並寫事由${SITE ? `：${SITE}` : ""}`;
        if (await discord(hooks.sections?.[sec] ?? hooks.announce, text, { users: users.slice(0, 100) })) n += people.length;
      }
    }
    if (n) sent.push(`unanswered:${n}`);
  }

  if (mode === "noon") {
    // 今天 12:00 以後開始的練習
    const day = twDay(0);
    const { data: events } = await db.from("events").select("*")
      .gte("starts_at", at(day, "12:00:00")).lte("starts_at", at(day, "23:59:59")).order("starts_at");
    await nag(events ?? [], "今天");
    return json({ ok: true, mode, day, events: events?.length ?? 0, sent });
  }

  // 晚上：明天的行程
  const day = twDay(1);
  const { data: events } = await db.from("events").select("*, event_pieces(pieces(title))")
    .gte("starts_at", at(day, "00:00:00")).lte("starts_at", at(day, "23:59:59")).order("starts_at");
  const line = (e: any) => {
    const ps = (e.event_pieces ?? []).map((x: any) => x.pieces?.title).filter(Boolean);
    return `• ${hhmm(e.starts_at)}–${hhmm(e.ends_at)} [${kindText(e)}] ${e.title}${e.location ? `｜${e.location}` : ""}${ps.length ? `\n　曲目：${ps.join("、")}` : ""}`;
  };
  const pub = (events ?? []).filter((e) => !officerOnly(e));
  const off = (events ?? []).filter((e) => officerOnly(e));
  if (pub.length && await discord(hooks.announce, `**明天的行程**\n${pub.map(line).join("\n")}\n\n不能到的請先請假${SITE ? `：${SITE}` : ""}`)) sent.push("announce");

  // 明天中午以前就開始的練習，等不到明天中午的提醒，今晚先 @
  await nag(pub.filter((e) => new Date(e.starts_at) < new Date(at(day, "12:00:00"))), "明天");

  const { data: tasks } = await db.from("tasks").select("title, due").eq("due", day).neq("status", "done");
  const offText = [
    off.length ? `**明天的幹部行程**\n${off.map(line).join("\n")}` : "",
    tasks?.length ? `**明天到期的任務**\n${tasks.map((t) => `• ${t.title}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (offText && await discord(hooks.officers, offText)) sent.push("officers");

  return json({ ok: true, mode, day, events: events?.length ?? 0, sent });
});
