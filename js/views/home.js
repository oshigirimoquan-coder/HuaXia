import { sb, state, me, route, esc, pageHead, empty, nameOf, fmtDate } from '../core.js';
import { ANN_TYPE, rateLevel, daysFromToday } from '../logic.js';
import { eventCard } from './events.js';
import { taskRow, bindTasks } from './tasks.js';

export function rateRing(rate, label) {
  const lv = rateLevel(rate); const v = rate ?? 0; const c = 2 * Math.PI * 34;
  return `<div class="ring ring-${lv}" role="img" aria-label="${label} ${rate == null ? '尚無資料' : rate + '%'}">
    <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" class="ring-bg"/><circle cx="40" cy="40" r="34" class="ring-fg" stroke-dasharray="${(v / 100) * c} ${c}"/></svg>
    <div><b class="mono">${rate == null ? '—' : Math.round(rate)}<small>${rate == null ? '' : '%'}</small></b><span>${label}</span></div></div>`;
}

route('/', async () => {
  const p = state.p;
  const nowIso = new Date(Date.now() - 3 * 3600e3).toISOString();
  const [evs, leaves, anns, reads, tasks, stats, pending] = await Promise.all([
    sb.from('events').select('*').gte('starts_at', nowIso).order('starts_at').limit(6),
    sb.from('leave_requests').select('*').eq('user_id', me()),
    sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(20),
    sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
    sb.from('tasks').select('*').neq('status', 'done').order('due', { ascending: true }),
    state.semester ? sb.rpc('attendance_stats', { sem: state.semester.id }) : { data: [] },
    p.admin ? sb.from('profiles').select('id').eq('status', 'pending') : { data: [] },
  ]);
  const lv = new Map((leaves.data || []).map((l) => [l.event_id, l]));
  const read = new Set((reads.data || []).map((r) => r.ann_id));
  const unread = (anns.data || []).filter((a) => !read.has(a.id));
  const myStat = (stats.data || []).find((s) => s.user_id === me());
  const myTasks = (tasks.data || []).filter((t) => (t.assignees || []).includes(me()));
  const officerTasks = p.officer ? (tasks.data || []).filter((t) => t.audience === 'officers' && daysFromToday(t.due ? t.due + 'T12:00:00+08:00' : '2999-01-01') <= 7) : [];
  const hour = +new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date());
  setTimeout(() => bindTasks([...myTasks, ...officerTasks]));
  const hi = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';

  return pageHead(`${hi}，${esc(nameOf(me()))}`, state.semester ? `${esc(state.semester.name)} 學期` : '') +
    (p.admin && pending.data?.length ? `<a class="banner" href="#/members"><b>${pending.data.length} 人等待核准加入</b><span>前往審核 →</span></a>` : '') +
    (p.admin && !state.semester ? `<a class="banner" href="#/settings"><b>還沒有設定目前學期</b><span>先到設定建立學期，才能新增行程 →</span></a>` : '') +
    `<div class="home-grid">
      <div class="stack">
      <section class="card">
        <div class="card-head"><h2>接下來</h2><a href="#/events" class="link">全部行程 →</a></div>
        ${evs.data?.length ? `<div class="ev-list">${evs.data.slice(0, 4).map((e) => eventCard(e, { leave: lv.get(e.id) })).join('')}</div>` : empty('接下來沒有行程', p.officer ? '到「行程」新增第一次練習。' : '幹部排好練習後會出現在這裡。')}
      </section>
      <section class="card">
        <div class="card-head"><h2>我的任務</h2><a href="#/tasks" class="link">全部 →</a></div>
        ${myTasks.length ? `<div class="task-list">${myTasks.slice(0, 5).map((t) => taskRow(t, true)).join('')}</div>` : '<p class="muted">沒有指派給你的任務</p>'}
      </section>
      </div>
      <div class="stack">
      ${!p.ringerOnly ? `<section class="card rate-card">
        <div class="card-head"><h2>我的出席率</h2><a href="#/attendance" class="link">明細 →</a></div>
        <div class="rings">${rateRing(myStat?.current_rate ?? null, '目前')}${rateRing(myStat?.total_rate ?? null, '整學期')}</div>
        ${myStat ? `<p class="small muted mono">出席 ${myStat.present}・晚到 ${myStat.late}・早退 ${myStat.early}・請假 ${myStat.excused}・缺席 ${myStat.absent}</p>` : '<p class="small muted">點過名之後就會有數字。</p>'}
      </section>` : ''}
      <section class="card">
        <div class="card-head"><h2>公告 ${unread.length ? `<span class="dot-n">${unread.length}</span>` : ''}</h2><a href="#/announcements" class="link">全部 →</a></div>
        ${(anns.data || []).length ? `<ul class="ann-mini">${(anns.data || []).slice(0, 4).map((a) => `<li class="${read.has(a.id) ? '' : 'unread'}"><a href="#/announcements"><span class="atype t-${a.type}">${ANN_TYPE[a.type]}</span>${esc(a.title)}</a><span class="muted small">${fmtDate(a.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">目前沒有公告</p>'}
      </section>
      ${officerTasks.length ? `<section class="card"><div class="card-head"><h2>幹部事項・7 天內到期</h2></div><div class="task-list">${officerTasks.slice(0, 5).map((t) => taskRow(t, true)).join('')}</div></section>` : ''}
      </div>
    </div>`;
});
