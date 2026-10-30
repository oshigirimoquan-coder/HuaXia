// 各組（2026-10 改版）：五個組別＋教學班。每組看成員、分部課、組內公告、出席率。
import { secsOf, mySecs } from '../core.js';
import { sb, state, me, route, esc, pageHead, empty, avatar, nameOf, fmtDate, render, $$ } from '../core.js';
import { SECTIONS, rateLevel } from '../logic.js';
import { eventCard } from './events.js';
import { classesTab } from './teaching.js';

const TEACH = '教學班';
const pct = (r) => r == null ? '<span class="muted">—</span>' : `<span class="rate rate-${rateLevel(r)} mono">${Math.round(r)}%</span>`;

// 點得進哪些組：幹部全部；其他人只有自己所屬的組（其他組的分頁看得到但不能點）
const visibleSecs = () => (state.p.officer ? SECTIONS : SECTIONS.filter((s) => mySecs().includes(s)));

function pickTab() {
  const saved = sessionStorage.getItem('grp');
  if (saved && (visibleSecs().includes(saved) || saved === TEACH)) return saved;
  return visibleSecs().find((s) => mySecs().includes(s)) || visibleSecs()[0] || TEACH;
}


async function sectionView(sec) {
  const p = state.p;
  const members = [...state.people.values()].filter((u) => u.status === 'active' && secsOf(u).includes(sec))
    .sort((a, b) => (b.roles.includes('leader') - a.roles.includes('leader')) || nameOf(a.id).localeCompare(nameOf(b.id), 'zh-Hant'));
  const leaders = members.filter((u) => u.roles.includes('leader'));
  const nowIso = new Date(Date.now() - 3 * 3600e3).toISOString();
  const sem = state.semester && !p.ringerOnly ? state.semester.id : null;
  const [evs, anns, stats, secAvg, honor] = await Promise.all([
    sb.from('events').select('*').contains('sections', [sec]).gte('starts_at', nowIso).order('starts_at').limit(6),
    sb.from('announcements').select('*').eq('audience', 'section').eq('section', sec).order('created_at', { ascending: false }).limit(5),
    sem ? sb.rpc('attendance_stats', { sem }) : { data: [] },
    sem ? sb.rpc('section_attendance', { sem }) : { data: [] },
    sem ? sb.rpc('attendance_honor_roll', { sem }) : { data: [] },
  ]);
  const good = new Set((honor.data || []).map((r) => r.user_id));
  const ids = new Set(members.map((u) => u.id));
  const secStats = (stats.data || []).filter((s) => ids.has(s.user_id));
  const rated = secStats.filter((s) => s.current_rate != null);
  // 組內平均：資料庫只給自己所在的組（幹部全部）；舊版資料庫沒有這個函式時，幹部改用個別出席率自己算
  const row = (secAvg.data || []).find((r) => r.section === sec);
  const avg = row ? (row.avg_rate == null ? null : Number(row.avg_rate)) : (p.officer && rated.length ? rated.reduce((a, b) => a + Number(b.current_rate), 0) / rated.length : null);
  const showAvg = !!row || p.officer;
  const statOf = new Map(secStats.map((s) => [s.user_id, s]));
  // 出席率：幹部看全部、組長看自己組；一般社員只看得到自己的（資料庫本來就只給這些）
  const canSeeAll = p.officer || (p.leader && mySecs().includes(sec));

  return `<section class="grp-hero sec-${esc(sec)}"><div>
      <h2>${esc(sec)}組</h2>
      <p class="small muted">${members.length} 位成員${leaders.length ? `・組長 ${leaders.map((u) => esc(nameOf(u.id))).join('、')}` : ''}</p></div>
      ${showAvg && !p.ringerOnly ? `<div class="grp-rate lv-${rateLevel(avg)}"><span>組內出席率</span><b class="mono">${avg == null ? '—' : Math.round(avg)}${avg == null ? '' : '<small>%</small>'}</b></div>` : ''}
    </section>
    <div class="grp-grid">
      <section class="card"><div class="card-head"><h2>分部課</h2><a class="link" href="#/events">行事曆</a></div>
        ${evs.data?.length ? `<div class="ev-list">${evs.data.map((e) => eventCard(e)).join('')}</div>` : '<p class="small muted">接下來沒有排定的分部課。</p>'}</section>
      <section class="card"><div class="card-head"><h2>組內公告</h2><a class="link" href="#/announcements">全部公告</a></div>
        ${anns.data?.length ? `<ul class="ann-mini">${anns.data.map((a) => `<li><a href="#/announcements">${esc(a.title)}</a><span class="muted small mono">${fmtDate(a.created_at)}</span></li>`).join('')}</ul>` : '<p class="small muted">還沒有發給這組的公告。</p>'}</section>
    </div>
    <section class="card"><div class="card-head"><h2>成員</h2>${canSeeAll && !p.ringerOnly ? '<span class="muted small">出席率為目前已點名的場次</span>' : ''}</div>
      ${members.length ? `<ul class="grp-people">${members.map((u) => {
        const st = statOf.get(u.id);
        return `<li class="${u.id === me() ? 'me' : ''}">${avatar(u.id, 36)}<div><b>${esc(nameOf(u.id))}</b>${u.roles.includes('leader') ? '<span class="chip gold">組長</span>' : ''}
          <span class="small muted">${esc(u.instruments || '')}</span>${good.has(u.id) ? '<span class="chip ok good-att">出席 80%↑</span>' : ''}</div>${(canSeeAll || u.id === me()) && !p.ringerOnly ? pct(st?.current_rate ?? null) : ''}</li>`;
      }).join('')}</ul>` : empty('這組還沒有成員', p.admin ? '到頭像選單的「成員」設定每個人的組別。' : '')}
    </section>`;
}

route('/groups', async () => {
  const tab = pickTab();
  const secs = visibleSecs();
  const tabs = [...SECTIONS, TEACH];
  // 先等這一組的資料載完，再綁定分頁的點擊（不然正式網站資料還在載入時就綁，會綁不到）
  const body = tab === TEACH ? `<p class="small muted grp-note">新生教學班與進度，帶課的人在這裡勾選學員的進度。</p>${await classesTab()}` : await sectionView(tab);
  setTimeout(() => $$('[data-grp]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('grp', b.dataset.grp); render(); })));
  return pageHead('各組', '各聲部的成員、分部課、組內公告與出席，以及新生教學班。') +
    `<div class="grp-tabs" role="tablist">${tabs.map((t) => { const ok = t === TEACH || secs.includes(t);
      return `<button role="tab" ${ok ? `data-grp="${t}"` : 'disabled title="只有這組的組員可以點進去"'} aria-selected="${t === tab}" class="${t === TEACH ? 'teach' : `sec-${t}`} ${ok ? '' : 'locked'} ${state.p.officer && mySecs().includes(t) ? 'is-mine' : ''}">${t}</button>`; }).join('')}</div>` +
    (!secs.length ? `<p class="small muted grp-note">你還沒有分組，幹部幫你設定組別後，這裡就會出現你的組。</p>` : '') +
    body;
});
