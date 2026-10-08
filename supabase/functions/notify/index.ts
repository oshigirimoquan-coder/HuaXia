// 公告與行程異動通知
// body: { type: "announcement", id } | { type: "event", id?, change: "created"|"updated"|"deleted", title?, starts_at? }
// 管道由 settings.notify.channel 決定："discord" | "email" | "both"（待社長決定）
// Discord webhook 存在 private_settings.discord = { announce, officers, sections: { 吹管: url, ... } }
import { admin, callerIs, cors, discord, json, kindsOf, kindText, officerOnly, twTime } from "../_shared/common.ts";

const SITE = Deno.env.get("SITE_URL") ?? "";
const TYPE: Record<string, string> = {
  practice: "練習異動", performance: "演出", admin: "行政", class: "教學班", urgent: "緊急", other: "公告",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await callerIs(req, "is_officer"))) return json({ error: "只有幹部可以發送通知" }, 403);
    const body = await req.json();
    const db = admin();
    const { data: s } = await db.from("settings").select("value").eq("key", "notify").single();
    const channel: string = s?.value?.channel ?? "discord";
    const { data: d } = await db.from("private_settings").select("value").eq("key", "discord").maybeSingle();
    const hooks = d?.value ?? {};
    const sent: string[] = [];

    if (body.type === "announcement") {
      const { data: a } = await db.from("announcements").select("*").eq("id", body.id).single();
      if (!a) return json({ error: "找不到公告" }, 404);
      const CH: Record<string, string> = { sizhu: "絲竹", concerts: "音樂會分享", alumni: "校友團" };
      const url = a.channel && a.channel !== "main" ? (hooks.channels?.[a.channel] ?? hooks.announce)
        : a.audience === "officers" ? hooks.officers
        : a.audience === "section" ? (hooks.sections?.[a.section] ?? hooks.announce)
        : hooks.announce;
      const head = a.type === "urgent" ? "🔴 **【緊急】**" : `**【${CH[a.channel] ?? TYPE[a.type] ?? "公告"}】**`;
      const where = a.channel === "concerts" ? [a.event_at ? `🗓 ${twTime(a.event_at)}` : "", a.venue ? `📍 ${a.venue}` : "", a.link].filter(Boolean).join("　") : "";
      const page = ({ sizhu: "sizhu", concerts: "concerts", alumni: "alumni" } as Record<string, string>)[a.channel] ?? "announcements";
      const text = `${head} ${a.title}${where ? `\n${where}` : ""}\n${a.body}${SITE ? `\n\n${SITE}#/${page}` : ""}`;
      if (channel === "discord" || channel === "both") {
        if (a.audience === "ringers") {
          // 槍手不在社團 DC，等 Email 管道決定後再寄
        } else {
          // 標記：被點名的人用 Discord ID @；全體絲竹成員用設定頁填的 DC 身分組 @
          const users: string[] = [], roles: string[] = [];
          if (a.mentions?.length) {
            const { data: ids } = await db.rpc("discord_ids", { uids: a.mentions });
            for (const r of ids ?? []) users.push(r.discord_id);
          }
          const role = hooks.roles?.[a.channel];
          if (a.mention_all && role) roles.push(role);
          const ping = [...roles.map((r) => `<@&${r}>`), ...users.map((u) => `<@${u}>`)].join(" ");
          if (await discord(url, ping ? `${ping}\n${text}` : text, { users, roles })) sent.push("discord");
        }
      }
      if (channel === "email" || channel === "both") {
        // TODO：社長決定使用 Gmail 後，在這裡接上寄信（Gmail API 或 SMTP 服務）
      }
      return json({ ok: true, sent });
    }

    if (body.type === "event") {
      let ev = body;
      if (body.id && body.change !== "deleted") {
        const { data } = await db.from("events").select("*").eq("id", body.id).single();
        if (data) ev = { ...data, change: body.change };
      }
      const verb = body.change === "created" ? "新增行程" : body.change === "deleted" ? "取消行程" : "行程異動";
      const text = `**【${verb}】** [${kindText(ev)}] ${ev.title}\n🕖 ${twTime(ev.starts_at)}${ev.location ? `　📍 ${ev.location}` : ""}${SITE && ev.id && body.change !== "deleted" ? `\n${SITE}#/events/${ev.id}` : ""}`;
      const url = officerOnly(ev) ? hooks.officers : kindsOf(ev).includes("sectional") && kindsOf(ev).length === 1 ? (hooks.sections?.[ev.section] ?? hooks.announce) : hooks.announce;
      if ((channel === "discord" || channel === "both") && await discord(url, text)) sent.push("discord");
      return json({ ok: true, sent });
    }

    return json({ error: "未知的通知類型" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
