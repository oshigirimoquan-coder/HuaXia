import { secsOf } from '../core.js';
import { sb, state, me, route, esc, pageHead, empty, fmtDate, chipPerson, nameOf, sectionChip, render, $, $$ } from '../core.js';
import { ATT_LABEL, KIND_LABEL, SECTIONS, rateLevel, replyLine, leaveText, replyTag } from '../logic.js';
import { rateRing } from './home.js';
import { toggleAttend, leaveDialog } from './events.js';

const pct = (r) => r == null ? '<span class="muted">—</span>' : `<span class="rate rate-${rateLevel(r)} mono">${Math.round(r)}%</span>`;

async function detail(uid) {
  if (!state.semester) return empty('還沒有設定學期');
  const { data } = await sb.rpc('attendance_detail', { sem: state.semester.id, uid });
  const rows = (data || []).filter((r) => r.expected || r.status);
  if (!rows.length) return '<p class="muted">這學期還沒有需要出席的行程。</p>';
  // 自己的明細：還沒點名、還沒開始（或剛開始）的場次，可以直接回覆出席或請假
  const mine = uid === me(), soon = Date.now() - 3 * 3600e3;
  const canReply = (r) => mine && r.expected && !r.marked && !r.status && new Date(r.starts_at).getTime() >= soon;
  const leaving = (r) => r.leave_type && r.leave_type !== 'attend';
  const reply = (r) => {
    if (!canReply(r)) return '';
    const dat = `data-ev="${r.event_id}" data-title="${esc(r.title)}"`;
    if (leaving(r)) return `<div class="rsvp"><span class="reply-tag">${replyTag(r.leave_type)}</span><button class="btn sm ghost" data-rsvp-leave ${dat} data-type="${r.leave_type}" data-reason="${esc(r.leave_reason || '')}">修改</button></div>`;
    if (r.leave_type === 'attend') return `<div class="rsvp"><span class="reply-tag">✓ 會出席</span><button class="btn sm ghost" data-rsvp-go="" ${dat}>取消</button><button class="btn sm ghost" data-rsvp-leave ${dat}>改請假／晚到</button></div>`;
    return `<div class="rsvp"><button class="btn sm line" data-rsvp-go="1" ${dat}>出席</button><button class="btn sm ghost" data-rsvp-leave ${dat}>請假／晚到</button></div>`;
  };
  const status = (r) => r.status ? `<span class="att att-${r.status}">${ATT_LABEL[r.status]}</span>` : r.marked ? '' : '<span class="muted small">尚未點名</span>';
  return `<div class="tbl-wrap"><table class="att-tbl att-detail"><thead><tr><th>日期</th><th>行程</th>${mine ? '<th>我的回覆</th>' : ''}<th>狀態</th><th>事由</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="mono nowrap c-date">${fmtDate(r.starts_at)}</td><td class="c-title"><a href="#/events/${r.event_id}">${esc(r.title)}</a> <span class="muted small c-kind">${KIND_LABEL[r.kind]}</span></td>${mine ? `<td class="c-reply">${reply(r)}</td>` : ''}
      <td class="c-st">${status(r)}</td>
      <td class="small c-why">${leaving(r) ? esc(leaveText(r.leave_type, r.leave_reason)) : esc(r.note || '')}</td></tr>`).join('')}
  </tbody></table></div>`;
}

async function attPage(all) {
  const p = state.p;
  if (all && !p.viewAll && !p.leader) return pageHead('出席率總表') + empty('只有幹部、指導老師和組長看得到');
  if (!state.semester) return pageHead('出席') + empty('還沒有設定學期', '管理員到「設定」建立學期後，出席率才會開始計算。');
  const { data } = await sb.rpc('attendance_stats', { sem: state.semester.id });
  const stats = data || [];
  const mine = stats.find((s) => s.user_id === me());
  // 出席明細頁：自己的已經在最上面，表格只列別人；出席率總表：連自己一起列
  const others = all ? stats : stats.filter((s) => s.user_id !== me());
  const secF = sessionStorage.getItem('attSec') || '';
  const shown = others.filter((s) => !secF || secsOf(state.people.get(s.user_id)).includes(secF))
    .sort((a, b) => (a.current_rate ?? 999) - (b.current_rate ?? 999));
  const bySec = SECTIONS.map((s) => {
    const l = stats.filter((x) => secsOf(state.people.get(x.user_id)).includes(s) && x.current_rate != null);
    return [s, l.length ? l.reduce((a, b) => a + Number(b.current_rate), 0) / l.length : null, l.length];
  });
  const myDetail = all ? '' : await detail(me());
  // 出席率 80% 以上的名單：社內的人都看得到名字（看不到數字）
  const honor = all || !p.insider ? [] : ((await sb.rpc('attendance_honor_roll', { sem: state.semester.id })).data || []).map((r) => r.user_id)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'zh-Hant'));  // 先載完自己的明細，再綁定按鈕（不然正式網站會綁不到）
  // 每場出席率要在綁定按鈕之前載完（不然正式網站會綁不到）
  const evRates = all && p.viewAll ? ((await sb.rpc('event_rates', { sem: state.semester.id })).data || []) : [];
  setTimeout(() => {
    $$('[data-ev-go]').forEach((tr) => (tr.onclick = () => { location.hash = '#/events/' + tr.dataset.evGo; }));
    $$('[data-rsvp-go]').forEach((b) => (b.onclick = () => toggleAttend(b.dataset.ev, !!b.dataset.rsvpGo)));
    $$('[data-rsvp-leave]').forEach((b) => (b.onclick = () => leaveDialog({ id: b.dataset.ev, title: b.dataset.title }, b.dataset.type ? { type: b.dataset.type, reason: b.dataset.reason } : null)));
    $$('[data-sec]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('attSec', b.dataset.sec); render(); }));
    $$('[data-who]').forEach((tr) => (tr.onclick = async () => {
      const box = $('#who-detail'); box.innerHTML = `<h2>${esc(nameOf(tr.dataset.who))} 的出席明細</h2>` + await detail(tr.dataset.who); box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  });
  const rules = state.settings.attendance_rules || {};
  const head = all ? pageHead(p.viewAll ? '全團出席率' : '組員出席率', `${esc(state.semester.name)}・點一列看那個人的每一場紀錄。「目前」只算已點名的場次，「整學期」連同之後的場次一起算。`)
    : pageHead('出席', `${esc(state.semester.name)}・「目前」只算已點名的場次，「整學期」連同之後的場次一起算。沒排到曲目的場次算無曲，不列入。`) +
    `<section class="card me-att"><div class="rings bign">${rateRing(mine?.current_rate ?? null, '目前')}${rateRing(mine?.total_rate ?? null, '整學期')}</div>
      <div class="me-att-detail"><h2>我的紀錄</h2>${myDetail}</div></section>` +
    (honor.length ? `<section class="card honor"><div class="card-head"><h2>出席率 80% 以上</h2><span class="muted small">${honor.length} 人・依目前已點名的場次</span></div>
      <div class="chips">${honor.map((id) => chipPerson(id)).join('')}</div></section>` : '');
  // 每一場的出席（幹部）：事先回覆的狀況、點名後的出席率
  const evCard = evRates.length ? `<section class="card"><div class="card-head"><h2>每場出席率</h2><span class="muted small">點一列到那場的點名頁</span></div>
    <div class="tbl-wrap"><table class="att-tbl click"><thead><tr><th>日期</th><th>行程</th><th>應到</th><th>事先回覆</th><th>出席率</th></tr></thead><tbody>
    ${evRates.map((r) => `<tr data-ev-go="${r.event_id}"><td class="mono nowrap">${fmtDate(r.starts_at)}</td><td>${esc(r.title)}</td><td class="mono">${r.expected}</td>
      <td class="small">${replyLine(r)}</td><td>${r.marked ? pct(r.rate) : '<span class="muted small">未點名</span>'}</td></tr>`).join('')}
    </tbody></table></div><p class="small muted">應到不含病假、公假、無曲；出席率依出席率規則折算晚到早退。</p></section>` : '';
  if (all && !others.length) return head + evCard + empty('還沒有可以顯示的出席率');
  return head + evCard +
    (others.length ? `<section class="card">
      <div class="card-head"><h2>${p.viewAll ? '全團' : '組員'}出席率</h2><span class="muted small">晚到／早退有預告算 ${rules.late_weight ?? 1} 次、沒預告算 ${rules.unexcused_weight ?? 0.5} 次・事假${rules.excused_mode === 'exclude' ? '不列入分母' : '算缺席'}・病假、公假不列入</span></div>
      ${p.viewAll ? `<div class="sec-bars">${bySec.map(([s, r, n]) => `<div class="sec-bar"><span>${sectionChip(s)}</span><div class="bar"><i class="rate-${rateLevel(r)}" style="width:${r ?? 0}%"></i></div><span class="mono small">${r == null ? '—' : Math.round(r) + '%'}</span></div>`).join('')}</div>
      <div class="seg wrap"><button data-sec="" aria-pressed="${!secF}">全部</button>${SECTIONS.map((s) => `<button data-sec="${s}" aria-pressed="${secF === s}">${s}</button>`).join('')}</div>` : ''}
      <div class="tbl-wrap"><table class="att-tbl click"><thead><tr><th>成員</th><th>目前</th><th>整學期</th><th>出席</th><th>晚到</th><th>早退</th><th>請假</th><th>缺席</th></tr></thead><tbody>
      ${shown.map((s) => `<tr data-who="${s.user_id}" class="${s.user_id === me() ? 'me' : ''}"><td>${chipPerson(s.user_id)}${s.user_id === me() ? ' <span class="muted small">（我）</span>' : ''}</td><td>${pct(s.current_rate)}</td><td>${pct(s.total_rate)}</td>
        <td class="mono">${s.present}</td><td class="mono">${s.late || ''}</td><td class="mono">${s.early || ''}</td><td class="mono">${s.excused || ''}</td><td class="mono">${s.absent || ''}</td></tr>`).join('')}
      </tbody></table></div><p class="small muted">點一列看那個人的明細。依目前出席率由低到高排序。</p></section>
      <section class="card" id="who-detail" hidden></section>` : '');
}
route('/attendance', () => attPage(false));
route('/attendance/all', () => attPage(true));

