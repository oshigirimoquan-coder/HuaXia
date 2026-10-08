import { sb, state, me, route, esc, pageHead, empty, nameOf, fmtDate, fmtTime } from '../core.js';
import { ANN_TYPE, KIND_LABEL, LEAVE_LABEL, rateLevel, daysFromToday, twParts, twWeekday, backupDue, kindsLabel } from '../logic.js';
import { eventCard } from './events.js';
import { SHARE_CATS, catLabel } from './announcements.js';

// 出席率大數字＋進度條（首頁與出席頁共用）
export function rateRing(rate, label) {
  const lv = rateLevel(rate);
  return `<div class="r lv-${lv}"><span>${label}</span><b class="mono">${rate == null ? '—' : Math.round(rate)}${rate == null ? '' : '<small>%</small>'}</b>
    <div class="bar"><i style="width:${rate ?? 0}%"></i></div></div>`;
}

function untilText(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return '進行中';
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return `還有 ${Math.max(1, Math.round(ms / 60e3))} 分鐘`;
  if (h < 48) return `還有 ${h} 小時`;
  return `還有 ${Math.round(h / 24)} 天`;
}

route('/', async () => {
  const p = state.p;
  const nowIso = new Date(Date.now() - 2 * 3600e3).toISOString();
  const [evs, leaves, anns, reads, stats, pending, tags] = await Promise.all([
    sb.from('events').select('*').gte('starts_at', nowIso).order('starts_at').limit(8),
    sb.from('leave_requests').select('*').eq('user_id', me()),
    sb.from('announcements').select('*').not('channel', 'in', `(${SHARE_CATS.join(',')})`).order('created_at', { ascending: false }).limit(20),
    sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
    state.semester ? sb.rpc('attendance_stats', { sem: state.semester.id }) : { data: [] },
    p.admin ? sb.from('profiles').select('id').eq('status', 'pending') : { data: [] },
    p.insider ? sb.rpc('my_mentions') : { data: [] },
  ]);
  const lv = new Map((leaves.data || []).map((l) => [l.event_id, l]));
  const read = new Set((reads.data || []).map((r) => r.ann_id));
  const annList = (anns.data || []).slice().sort((a, b) => (b.pinned - a.pinned) || (b.created_at > a.created_at ? 1 : -1));
  const latest = annList[0];
  const myStat = (stats.data || []).find((s) => s.user_id === me());
  const upcoming = evs.data || [];
  const next = upcoming[0];
  const rest = upcoming.slice(1, 6);
  const hour = +new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date());
  const hi = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';

  let hero;
  if (next) {
    const t = twParts(next.starts_at); const d = daysFromToday(next.starts_at);
    const myLeave = lv.get(next.id);
    hero = `<section class="hero"><div class="hero-in"><div>
      <p class="hello">${esc(nameOf(me()))}，${hi}</p>
      <div class="next-k">下一次${kindsLabel(next)}・${d === 0 ? '今天' : d === 1 ? '明天' : `${d} 天後`}</div>
      <div class="next-t">${esc(next.title)}</div>
      <div class="next-m"><b>${t.month}/${t.day}（${twWeekday(next.starts_at)}）${fmtTime(next.starts_at)}–${fmtTime(next.ends_at)}</b>${next.location ? `<span>${esc(next.location)}</span>` : ''}</div>
      ${myLeave ? `<div class="next-state">你已${LEAVE_LABEL[myLeave.type]}：${esc(myLeave.reason)}</div>` : `<div class="next-note">${untilText(next.starts_at)}</div>`}
    </div>
    <div class="actions"><a class="btn pri" href="#/events/${next.id}">${myLeave ? '修改請假' : '請假／晚到'}</a>${p.ringerOnly || p.insider ? '<a class="btn line" href="#/pieces">我的曲目</a>' : ''}</div></div></section>`;
  } else {
    hero = `<section class="hero"><div class="hero-empty"><p class="hello">${esc(nameOf(me()))}，${hi}</p><div class="next-t">接下來沒有練習</div>
      <div class="next-m">${p.officer ? '<a class="btn line" href="#/events">新增行程</a>' : '<span>幹部排好練習後會顯示在這裡。</span>'}</div></div></section>`;
  }

  const newTags = (tags.data || []).filter((a) => !read.has(a.id)).slice(0, 3);
  const tagBox = newTags.length ? `<section class="tag-box"><b>有人提到你</b>${newTags.map((a) => `<a href="#/announcements"><span class="k">${catLabel(a)}</span>${esc(a.title)}<span class="muted small">${fmtDate(a.created_at)}</span></a>`).join('')}</section>` : '';
  return tagBox + (p.admin && pending.data?.length ? `<a class="banner" href="#/members"><b>${pending.data.length} 人等待核准加入</b><span>前往審核 →</span></a>` : '') +
    (p.admin && !state.semester ? `<a class="banner" href="#/settings"><b>還沒有設定目前學期</b><span>先建立學期，才能新增行程 →</span></a>` : '') +
    (p.admin && backupDue(state.settings.last_backup_at, state.semester?.starts_on) ? `<a class="banner" href="#/settings"><b>${state.settings.last_backup_at ? '超過 60 天沒有備份資料' : '這學期還沒備份過資料'}</b><span>到設定頁匯出備份 →</span></a>` : '') +
    (latest ? `<a class="ann-top" href="#/announcements"><span class="k ${latest.type === 'urgent' ? 'urgent' : ''}">${latest.pinned ? '置頂公告' : '最新公告'}</span>
      <h2>${esc(latest.title)}</h2>${latest.body ? `<p>${esc(latest.body)}</p>` : `<p>${fmtDate(latest.created_at)}・${catLabel(latest)}</p>`}<span class="go">全部公告 →</span></a>` : '') +
    hero +
    `<div class="home-grid">
      <section class="card wide">
        <div class="card-head"><h2>接下來</h2><a href="#/events" class="link">全部行程</a></div>
        ${rest.length ? `<div class="ev-list">${rest.map((e) => eventCard(e, { leave: lv.get(e.id) })).join('')}</div>` : '<p class="muted small">之後沒有其他行程。</p>'}
      </section>
      ${!p.ringerOnly ? `<section class="card">
        <div class="card-head"><h2>出席率</h2><a href="#/attendance" class="link">明細</a></div>
        <div class="bign">${rateRing(myStat?.current_rate ?? null, '目前')}${rateRing(myStat?.total_rate ?? null, '整學期')}
          <p class="small muted">${myStat ? `已出席 ${myStat.present + myStat.late + myStat.early} 次，這學期還有 ${Math.max(0, myStat.expected_total - myStat.expected_so_far)} 次。` : '點過名之後就會有數字。'}</p></div>
      </section>` : ''}
    </div>`;
});
