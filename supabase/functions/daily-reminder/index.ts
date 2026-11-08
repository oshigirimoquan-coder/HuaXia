// 每天晚上 20:00（台北）由排程呼叫：提醒明天的行程與幹部任務；
// 每週日：把下週一到週日要算出席的行程，在還有人沒回覆的那幾組頻道問一次（不 @ 人），一場一個「確定會去」按鈕；
// 明天：還沒回覆的人到他那組的頻道 @ 他，附「確定會去」「請假」按鈕
// 呼叫時需帶 header  x-cron-secret: <CRON_SECRET>
import { admin, cors, discord, json, kindsOf, kindText, officerOnly } from "../_shared/common.ts";

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
  const noteLines = (e: any) => (e.note ?? "").trim() ? "\n" + e.note.trim().split(/\r?\n/).filter((l: string) => l.trim()).map((l: string) => `　${l.trim()}`).join("\n") : "";
  // 公告：• 11/10（二） 19:30 週二絲竹，下面放備註和回覆狀況
  const line = (e: any) => {
    const r = rates.get(e.id);
    const reply = r && r.expected ? `\n　應到 ${r.expected} 人：已回覆出席 ${r.said_yes}、請假 ${r.said_off}、晚到早退 ${r.said_late}、還沒回覆 ${r.no_reply}` : "";
    return `• ${md(e.starts_at)} ${hhmm(e.starts_at)} ${e.title}${noteLines(e)}${reply}`;
  };
  const pub = (events ?? []).filter((e) => !officerOnly(e));
  const off = (events ?? []).filter((e) => officerOnly(e));
  const sent: string[] = [];
  if (pub.length && await discord(hooks.announce, `**明天的行程**\n${pub.map(line).join("\n")}\n\n不能到的請先請假${SITE ? `：${SITE}` : ""}`)) sent.push("announce");

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
    const buttons: [string, string][] = SITE ? [["✅ 確定會去", `${SITE}#/events/${e.id}/yes`], ["請假／晚到早退", `${SITE}#/events/${e.id}`]] : [];
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
    const { data: wk } = await db.from("events").select("*").gte("starts_at", wf).lte("starts_at", wt).eq("counts_attendance", true).order("starts_at");
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
      const buttons: [string, string][] = SITE ? list.map((e) => [`✅ ${md(e.starts_at)}${e.title}`, `${SITE}#/events/${e.id}/yes`]) : [];
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
