// 借教室：710、711、118。社內的人登記時段；同一間同時段只能一個人，有社團行程（地點寫了這間）的時段不能借（資料庫會檔）
import { sb, state, me, route, esc, run, toast, errText, formDialog, pageHead, empty, chipPerson, fmtDate, fmtTime, render, $$, armDelete } from '../core.js';
import { twParts, twToIso, twWeekday } from '../logic.js';

export const ROOMS = ['710', '711', '118'];
const DAYS = 14;  // 可以看兩週內
const today = () => twParts(new Date()).date;
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pickDay = () => { const s = sessionStorage.getItem('roomDay'); return s && s >= today() && s <= addDays(today(), DAYS - 1) ? s : today(); };
const hm = (iso) => fmtTime(iso);

const MAX_TIMES = 16;  // 重複最多 16 次（約一學期）

async function bookDialog(day, room = ROOMS[0]) {
  const v = await formDialog({
    title: '登記借教室',
    submit: '登記',
    switchBy: 'repeat',
    fields: [
      { name: 'room', label: '教室', type: 'select', value: room, options: ROOMS.map((r) => [r, r]) },
      { name: 'date', label: '日期', type: 'date', value: day, required: true },
      { name: 'from', label: '開始', type: 'time', value: '12:00', required: true },
      { name: 'to', label: '結束', type: 'time', value: '13:00', required: true },
      { name: 'repeat', label: '重複', type: 'select', value: '0', options: [['0', '不重複'], ['1', '每週'], ['2', '每兩週']] },
      { name: 'times', label: '共借幾次（含這次）', type: 'number', value: 4, min: 2, only: ['1', '2'] },
      { name: 'purpose', label: '用途（選填）', value: '', placeholder: '例：二胡個練、彈撥小組練', full: true },
    ],
    validate: (x) => x.to <= x.from ? '結束時間要比開始晚'
      : x.repeat !== '0' && !(x.times >= 2 && x.times <= MAX_TIMES) ? `重複次數請填 2 到 ${MAX_TIMES} 次` : null,
  });
  if (!v) return;
  const row = (date) => ({ room: v.room, user_id: me(), starts_at: twToIso(date, v.from), ends_at: twToIso(date, v.to), purpose: v.purpose.trim() });
  if (v.repeat === '0') {
    const ok = await run(() => sb.from('room_bookings').insert(row(v.date)), `已登記 ${v.room}`);
    if (ok) { sessionStorage.setItem('roomDay', v.date); render(); }
    return;
  }
  // 重複：一次一筆，撞到的那幾天跳過，最後告訴他哪幾天沒借到
  const dates = Array.from({ length: v.times }, (_, i) => addDays(v.date, i * 7 * Number(v.repeat)));
  const failed = [];
  for (const d of dates) {
    const { error } = await sb.from('room_bookings').insert(row(d));
    if (error) failed.push([`${+d.slice(5, 7)}/${+d.slice(8)}（週${twWeekday(d + 'T12:00:00+08:00')}）`, errText(error)]);
  }
  sessionStorage.setItem('roomDay', v.date);
  render();
  const got = dates.length - failed.length;
  if (!failed.length) return toast(`已登記 ${v.room}，共 ${got} 次`, 'ok');
  await formDialog({
    title: got ? `借到 ${got} 次，有 ${failed.length} 次沒借到` : '都沒有借到',
    submit: '知道了',
    fields: [{ name: 'x', type: 'info', rows: failed }],
  });
}

route('/rooms', async () => {
  const p = state.p;
  if (!p.insider) return pageHead('借教室') + empty('只有社員可以借教室');
  const day = pickDay();
  const from = twToIso(day, '00:00'), to = twToIso(addDays(day, 1), '00:00');
  const [{ data: bookings }, { data: events }, { data: mine }] = await Promise.all([
    sb.from('room_bookings').select('*').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('events').select('id, title, starts_at, ends_at, location').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('room_bookings').select('*').eq('user_id', me()).gte('ends_at', new Date().toISOString()).order('starts_at'),
  ]);
  setTimeout(() => {
    $$('[data-day]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('roomDay', b.dataset.day); render(); }));
    $$('[data-book]').forEach((b) => (b.onclick = () => bookDialog(day, b.dataset.book)));
    // 按兩下才取消（第一下變成「確定取消？」）
    $$('[data-cancel]').forEach((b) => (b.onclick = async () => {
      if (!armDelete(b, '確定取消？')) return;
      if (await run(() => sb.from('room_bookings').delete().eq('id', b.dataset.cancel), '已取消')) render();
    }));
  });
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today(), i));
  const canCancel = (b) => b.user_id === me() || p.officer;
  const item = (b) => `<li><span class="mono">${hm(b.starts_at)}–${hm(b.ends_at)}</span> ${chipPerson(b.user_id)}${b.purpose ? ` <span class="muted small">${esc(b.purpose)}</span>` : ''}
    ${canCancel(b) ? `<button class="btn sm ghost" data-cancel="${b.id}">取消</button>` : ''}</li>`;
  const evItem = (e) => `<li class="room-ev"><span class="mono">${hm(e.starts_at)}–${hm(e.ends_at)}</span> <a href="#/events/${e.id}">${esc(e.title)}</a> <span class="chip">社團行程</span></li>`;
  return pageHead('借教室', '710、711、118 只有社員能借。同一間同一時段只能一個人；有社團行程的時段不能借。',
      `<button class="btn pri" data-book="${ROOMS[0]}">＋ 登記借用</button>`) +
    `<div class="day-strip" role="tablist">${days.map((d) => `<button role="tab" data-day="${d}" aria-selected="${d === day}"><small>${d === today() ? '今天' : '週' + twWeekday(d + 'T12:00:00+08:00')}</small><b>${+d.slice(5, 7)}/${+d.slice(8)}</b></button>`).join('')}</div>` +
    `<div class="room-grid">${ROOMS.map((r) => {
      const bs = (bookings || []).filter((b) => b.room === r);
      const es = (events || []).filter((e) => (e.location || '').includes(r));
      const rows = [...es.map((e) => [e.starts_at, evItem(e)]), ...bs.map((b) => [b.starts_at, item(b)])].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map((x) => x[1]);
      return `<section class="card room"><div class="card-head"><h2>${r}</h2><button class="btn sm" data-book="${r}">借這間</button></div>
        ${rows.length ? `<ul class="room-list">${rows.join('')}</ul>` : '<p class="small muted">這天整天都可以借。</p>'}</section>`;
    }).join('')}</div>` +
    `<section class="card"><div class="card-head"><h2>我的借用</h2></div>${mine?.length
      ? `<ul class="room-list">${mine.map((b) => `<li><b>${b.room}</b> <span class="mono">${fmtDate(b.starts_at)} ${hm(b.starts_at)}–${hm(b.ends_at)}</span>${b.purpose ? ` <span class="muted small">${esc(b.purpose)}</span>` : ''}
          <button class="btn sm ghost" data-cancel="${b.id}">取消</button></li>`).join('')}</ul>`
      : '<p class="small muted">還沒有借用。</p>'}</section>`;
});
