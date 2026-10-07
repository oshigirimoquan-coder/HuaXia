import { sb, state, me, route, esc, pageHead, empty, fmtDate, chipPerson, nameOf, sectionChip, render, $, $$ } from '../core.js';
import { ATT_LABEL, KIND_LABEL, LEAVE_LABEL, SECTIONS, rateLevel } from '../logic.js';
import { rateRing } from './home.js';

const pct = (r) => r == null ? '<span class="muted">—</span>' : `<span class="rate rate-${rateLevel(r)} mono">${Math.round(r)}%</span>`;

async function detail(uid) {
  if (!state.semester) return empty('還沒有設定學期');
  const { data } = await sb.rpc('attendance_detail', { sem: state.semester.id, uid });
  const rows = (data || []).filter((r) => r.expected || r.status);
  if (!rows.length) return '<p class="muted">這學期還沒有需要出席的行程。</p>';
  return `<div class="tbl-wrap"><table class="att-tbl"><thead><tr><th>日期</th><th>行程</th><th>狀態</th><th>事由</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="mono nowrap">${fmtDate(r.starts_at)}</td><td><a href="#/events/${r.event_id}">${esc(r.title)}</a> <span class="muted small">${KIND_LABEL[r.kind]}</span></td>
      <td>${r.status ? `<span class="att att-${r.status}">${ATT_LABEL[r.status]}</span>` : r.marked ? '' : '<span class="muted small">尚未點名</span>'}</td>
      <td class="small">${r.leave_type ? `<span class="muted">${LEAVE_LABEL[r.leave_type]}：</span>${esc(r.leave_reason || '')}` : esc(r.note || '')}</td></tr>`).join('')}
  </tbody></table></div>`;
}

route('/attendance', async () => {
  const p = state.p;
  if (!state.semester) return pageHead('出席') + empty('還沒有設定學期', '管理員到「設定」建立學期後，出席率才會開始計算。');
  const { data } = await sb.rpc('attendance_stats', { sem: state.semester.id });
  const stats = data || [];
  const mine = stats.find((s) => s.user_id === me());
  const others = stats.filter((s) => s.user_id !== me());
  const secF = sessionStorage.getItem('attSec') || '';
  const shown = others.filter((s) => !secF || state.people.get(s.user_id)?.section === secF)
    .sort((a, b) => (a.current_rate ?? 999) - (b.current_rate ?? 999));
  const bySec = SECTIONS.map((s) => {
    const l = stats.filter((x) => state.people.get(x.user_id)?.section === s && x.current_rate != null);
    return [s, l.length ? l.reduce((a, b) => a + Number(b.current_rate), 0) / l.length : null, l.length];
  });
  setTimeout(() => {
    $$('[data-sec]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('attSec', b.dataset.sec); render(); }));
    $$('[data-who]').forEach((tr) => (tr.onclick = async () => {
      const box = $('#who-detail'); box.innerHTML = `<h2>${esc(nameOf(tr.dataset.who))} 的出席明細</h2>` + await detail(tr.dataset.who); box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  });
  const rules = state.settings.attendance_rules || {};
  return pageHead('出席', `${esc(state.semester.name)}・「目前」只算已點名的場次，「整學期」連同之後的場次一起算。沒排到曲目的場次算無曲，不列入。`) +
    `<section class="card me-att"><div class="rings bign">${rateRing(mine?.current_rate ?? null, '目前')}${rateRing(mine?.total_rate ?? null, '整學期')}</div>
      <div class="me-att-detail"><h2>我的紀錄</h2>${await detail(me())}</div></section>` +
    (others.length ? `<section class="card">
      <div class="card-head"><h2>${p.officer ? '全團' : '組員'}出席率</h2><span class="muted small">晚到算 ${rules.late_weight ?? 1} 次、早退算 ${rules.early_weight ?? 1} 次・請假${rules.excused_mode === 'exclude' ? '不列入分母' : '算缺席'}</span></div>
      ${p.officer ? `<div class="sec-bars">${bySec.map(([s, r, n]) => `<div class="sec-bar"><span>${sectionChip(s)}</span><div class="bar"><i class="rate-${rateLevel(r)}" style="width:${r ?? 0}%"></i></div><span class="mono small">${r == null ? '—' : Math.round(r) + '%'}</span></div>`).join('')}</div>
      <div class="seg wrap"><button data-sec="" aria-pressed="${!secF}">全部</button>${SECTIONS.map((s) => `<button data-sec="${s}" aria-pressed="${secF === s}">${s}</button>`).join('')}</div>` : ''}
      <div class="tbl-wrap"><table class="att-tbl click"><thead><tr><th>成員</th><th>目前</th><th>整學期</th><th>出席</th><th>晚到</th><th>早退</th><th>請假</th><th>缺席</th></tr></thead><tbody>
      ${shown.map((s) => `<tr data-who="${s.user_id}"><td>${chipPerson(s.user_id)}</td><td>${pct(s.current_rate)}</td><td>${pct(s.total_rate)}</td>
        <td class="mono">${s.present}</td><td class="mono">${s.late || ''}</td><td class="mono">${s.early || ''}</td><td class="mono">${s.excused || ''}</td><td class="mono">${s.absent || ''}</td></tr>`).join('')}
      </tbody></table></div><p class="small muted">點一列看那個人的明細。依目前出席率由低到高排序。</p></section>
      <section class="card" id="who-detail" hidden></section>` : '');
});
