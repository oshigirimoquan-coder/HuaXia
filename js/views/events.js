import { secsOf, mySecs } from '../core.js';
import { sb, state, me, route, go, esc, run, toast, formDialog, armDelete, pageHead, empty, fmtDate, fmtTime, fmtRange, chipPerson, nameOf, sectionChip, render, $, $$, DEMO } from '../core.js';
import { shrink } from './announcements.js';
import { KIND_LABEL, LEAVE_LABEL, ATT_LABEL, SECTIONS, sectionsOf, isAttend, eventDefaults, kindsDefaults, kindsLabel, twParts, twWeekday, twToIso, daysFromToday, defaultRollStatus } from '../logic.js';

export async function invokeFn(name, body) {
  if (DEMO) return { ok: true };
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context?.json())?.error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}

// 分部課只給自己那組看；幹部在行事曆看得到全部（mine=true 時連幹部也只看自己組，用在首頁）
export function forMe(e, mine = false) {
  if (!(e.kinds || [e.kind]).includes('sectional') || !sectionsOf(e).length) return true;
  if (!mine && state.p.officer) return true;
  return sectionsOf(e).some((s) => mySecs().includes(s));
}

export function eventCard(e, { leave } = {}) {
  const d = daysFromToday(e.starts_at);
  const t = twParts(e.starts_at);
  const flag = leave ? `<span class="chip ${['leave', 'sick'].includes(leave.type) ? 'bad' : 'warn'}">已${LEAVE_LABEL[leave.type]}</span>`
    : d === 0 ? '<span class="chip warn">今天</span>' : d === 1 ? '<span class="chip">明天</span>' : '';
  return `<a class="ev-card kind-${e.kind} ${d < 0 ? 'past' : ''}" href="#/events/${e.id}">
    <div class="ev-date"><b>${t.month}/${t.day}</b><span>週${twWeekday(e.starts_at)}</span></div>
    <div class="ev-body">
      <div class="ev-top"><span class="kind">${kindsLabel(e)}</span>${sectionsOf(e).map(sectionChip).join('')}</div>
      <h3>${esc(e.title)}</h3>
      <p class="meta"><span class="mono">${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}</span>${e.location ? `　${esc(e.location)}` : ''}</p>
    </div>
    <div class="ev-side">${flag}</div></a>`;
}

async function pieceOptions() {
  const { data } = await sb.from('pieces').select('id,title').eq('archived', false).order('title');
  return (data || []).map((p) => [p.id, p.title]);
}

export async function editEvent(ev = null) {
  if (!state.semester) { toast('請管理員先到「設定」建立目前學期', 'bad'); return; }
  const [pieces, classes] = await Promise.all([pieceOptions(), sb.from('classes').select('id,name').then((r) => r.data || [])]);
  const cur = ev ? (await sb.from('event_pieces').select('piece_id').eq('event_id', ev.id)).data?.map((x) => x.piece_id) : [];
  const s = ev ? twParts(ev.starts_at) : null, e2 = ev ? twParts(ev.ends_at) : null;
  const v = await formDialog({
    title: ev ? '編輯行程' : '新增行程',
    danger: ev ? '刪除' : null,
    fields: [
      { name: 'kinds', label: '類型（可複選）', type: 'checks', full: true, value: ev?.kinds?.length ? ev.kinds : [ev?.kind || 'tutti'], options: Object.entries(KIND_LABEL), hint: '例：同一場有大團也有絲竹，就兩個都勾' },
      { name: 'title', label: '名稱', required: true, value: ev?.title, placeholder: '例：週二大團、11/14 吹管分部課' },
      { name: 'date', label: '日期', type: 'date', required: true, value: s?.date || twParts(new Date()).date },
      { name: 'start', label: '開始', type: 'time', required: true, value: s?.time || '19:30' },
      { name: 'end', label: '結束', type: 'time', required: true, value: e2?.time || '21:30' },
      { name: 'location', label: '地點', value: ev?.location, placeholder: '例：721、視聽館' },
      { name: 'sections', label: '分部課組別（可複選）', type: 'checks', full: true, value: sectionsOf(ev), options: SECTIONS.map((x) => [x, x]), hint: '有勾「分部課」時才需要。好幾組一起上就都勾，例如彈撥＋低音' },
      { name: 'class_id', label: '教學班', type: 'select', value: ev?.class_id || '', options: [['', '（不是教學班）'], ...classes.map((c) => [c.id, c.name])], hint: '有勾「教學班」時才需要' },
      { name: 'pieces', label: '這次練習的曲目', type: 'checks', value: cur, options: pieces, full: true, hint: '有勾選曲目時，沒被排到這些曲目的人自動算「無曲」，不計入出席率' },
      { name: 'note', label: '備註', type: 'textarea', value: ev?.note, full: true },
      { name: 'counts', label: '出席率', type: 'toggle', text: '這次計入出席率', value: ev ? ev.counts_attendance : true },
      { name: 'notify', label: '通知', type: 'toggle', text: '同步發送通知（DC）', value: !ev },
    ],
  });
  if (!v) return;
  if (v.__danger) { await deleteEvent(ev); return; }
  if (v.end <= v.start) { toast('結束時間要晚於開始時間', 'bad'); return; }
  if (!v.kinds.length) { toast('至少要選一個類型', 'bad'); return; }
  const has = (k) => v.kinds.includes(k);
  const defs = kindsDefaults(v.kinds, v.sections[0]);
  const row = {
    kinds: v.kinds, kind: defs.kind, title: v.title, location: v.location, note: v.note,
    starts_at: twToIso(v.date, v.start), ends_at: twToIso(v.date, v.end),
    section: has('sectional') ? v.sections[0] || null : null,
    sections: has('sectional') ? v.sections : [],
    class_id: has('class') ? v.class_id || null : null,
    calendar_key: defs.calendar_key, audience: defs.audience,
    counts_attendance: defs.counts ? v.counts : false,
    semester_id: ev?.semester_id || state.semester.id,
  };
  if (has('sectional') && !row.sections.length) { toast('有勾分部課，要選組別', 'bad'); return; }
  if (has('class') && !row.class_id) { toast('有勾教學班，要選是哪一班', 'bad'); return; }
  const saved = await run(() => ev ? sb.from('events').update(row).eq('id', ev.id).select().single() : sb.from('events').insert(row).select().single());
  if (!saved) return;
  const id = saved.data.id;
  await sb.from('event_pieces').delete().eq('event_id', id);
  if (v.pieces.length) await sb.from('event_pieces').insert(v.pieces.map((p) => ({ event_id: id, piece_id: p })));
  // 換了行事曆時，先刪掉舊的 Google 行程
  if (ev?.gcal_event_id && ev.calendar_key !== row.calendar_key) {
    await invokeFn('calendar-sync', { action: 'delete', calendar_key: ev.calendar_key, gcal_event_id: ev.gcal_event_id }).catch(() => {});
    await sb.from('events').update({ gcal_event_id: null }).eq('id', id);
  }
  const sync = await invokeFn('calendar-sync', { action: 'upsert', event_id: id }).then(() => true, (e) => { toast('已儲存，但同步 Google 行事曆失敗：' + e.message, 'bad'); return false; });
  if (v.notify) await invokeFn('notify', { type: 'event', id, change: ev ? 'updated' : 'created' }).catch(() => {});
  if (sync) toast(ev ? '行程已更新' : '行程已建立', 'ok');
  go(`/events/${id}`); render();
}

async function deleteEvent(ev) {
  const ok = await run(() => sb.from('events').delete().eq('id', ev.id), '已刪除行程');
  if (!ok) return;
  if (ev.gcal_event_id) await invokeFn('calendar-sync', { action: 'delete', calendar_key: ev.calendar_key, gcal_event_id: ev.gcal_event_id }).catch(() => {});
  await invokeFn('notify', { type: 'event', change: 'deleted', kind: ev.kind, kinds: ev.kinds, title: ev.title, starts_at: ev.starts_at, location: ev.location, section: ev.section }).catch(() => {});
  go('/events');
}

// 「出席」：事先確認會到；再按一次取消
export async function toggleAttend(evId, on) {
  if (on) await run(() => sb.from('leave_requests').upsert({ event_id: evId, user_id: me(), type: 'attend', reason: '' }), '已確認出席');
  else await run(() => sb.from('leave_requests').delete().eq('event_id', evId).eq('user_id', me()), '已取消確認');
  render();
}

// 晚到／早退要填時間：存在事由最前面，例如「【20:15 到】家教」，點名和紀錄上都看得到
const TIME_TAG = /^【(\d{1,2}:\d{2}) (到|走)】\s*/;
const PROOF = 'leave-proofs';
const proofHtml = (x) => !x ? '' : ` <span class="proof">${(x.proof_paths || []).map((p, i) => `<button class="link" data-proof="${esc(p)}">證明${(x.proof_paths.length > 1) ? i + 1 : ''}</button>`).join(' ')}${x.proof_dm ? '<span class="chip">已私訊團長</span>' : ''}</span>`;
// 病假證明：私人檔案，開啟時拿有時效的網址（Safari 不擋：先開分頁再導向）
export async function openProof(path) {
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from(PROOF).createSignedUrl(path, 600);
  if (error) { w?.close(); return toast('打不開證明：' + error.message, 'bad'); }
  if (w && !w.closed) w.location.href = data.signedUrl; else location.href = data.signedUrl;
}
export async function leaveDialog(ev, cur) {
  // 從出席明細打開時只帶了類型和事由，這裡重新讀一次，才拿得到病假證明
  if (cur) cur = (await sb.from('leave_requests').select('*').eq('event_id', ev.id).eq('user_id', me()).maybeSingle()).data || cur;
  const oldProofs = cur?.proof_paths || [];
  const signed = oldProofs.length ? ((await sb.storage.from(PROOF).createSignedUrls(oldProofs, 3600)).data || []) : [];
  const m = (cur?.reason || '').match(TIME_TAG);
  const v = await formDialog({
    title: `${cur ? '修改' : ''}請假：${ev.title}`,
    danger: cur ? '撤回' : null,
    submit: '送出',
    switchBy: 'type',
    fields: [
      { name: 'type', label: '類型', type: 'select', value: cur?.type || 'leave', options: Object.entries(LEAVE_LABEL), hint: '病假不列入出席率，但要附證明；事假依社團規定計算' },
      { name: 'at', label: '幾點到／幾點走', type: 'time', value: m?.[1] || '', only: ['late', 'early'], hint: '晚到填預計幾點到，早退填預計幾點走' },
      { name: 'proof', label: '病假證明（診斷證明、藥袋、掛號單的照片）', type: 'photos', full: true, only: ['sick'], value: oldProofs.map((path, i) => ({ path, url: signed[i]?.signedUrl || '' })) },
      { name: 'proof_dm', type: 'toggle', text: '不方便上傳，已私訊團長提供證明', value: cur?.proof_dm, only: ['sick'], full: true },
      { name: 'reason', label: '事由', type: 'textarea', value: (cur?.reason || '').replace(TIME_TAG, ''), required: true, rows: 3, full: true, placeholder: '例：期中考、家教卡到、發燒' },
    ],
    validate: (x) => {
      if ((x.type === 'late' || x.type === 'early') && !x.at) return x.type === 'late' ? '請填預計幾點到' : '請填預計幾點走';
      if (x.type === 'sick' && !x.proof_dm && !(x.proof.keep.length + x.proof.files.length)) return '病假要上傳證明照片，或勾選「已私訊團長」';
      return null;
    },
  });
  if (!v) return;
  if (v.__danger) {
    if (oldProofs.length) await sb.storage.from(PROOF).remove(oldProofs);
    await run(() => sb.from('leave_requests').delete().eq('event_id', ev.id).eq('user_id', me()), '已撤回');
    return render();
  }
  const reason = v.type === 'late' || v.type === 'early' ? `【${v.at} ${v.type === 'late' ? '到' : '走'}】${v.reason}` : v.reason;
  let proofs = [], dm = false;
  if (v.type === 'sick') {
    dm = v.proof_dm;
    proofs = [...v.proof.keep];
    for (const f of v.proof.files) {
      try {
        const blob = await shrink(f);
        const path = `${me()}/${ev.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
        const { error } = await sb.storage.from(PROOF).upload(path, blob, { contentType: 'image/jpeg' });
        if (error) throw error;
        proofs.push(path);
      } catch (e) { return toast('證明上傳失敗：' + (e.message || e), 'bad'); }
    }
  }
  const ok = await run(() => sb.from('leave_requests').upsert({ event_id: ev.id, user_id: me(), type: v.type, reason, proof_paths: proofs, proof_dm: dm }), '已送出');
  const drop = oldProofs.filter((p) => !proofs.includes(p));
  if (ok && drop.length) await sb.storage.from(PROOF).remove(drop);
  render();
}

// 月曆：一格一天，點日期看當天行程
function monthGrid(ym, evs, lv, pick) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = twParts(new Date()).date;
  const byDay = new Map();
  for (const e of evs) { const d = twParts(e.starts_at).date; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<span class="cal-cell blank"></span>');
  for (let d = 1; d <= days; d++) {
    const key = `${ym}-${String(d).padStart(2, '0')}`; const list = byDay.get(key) || [];
    cells.push(`<button class="cal-cell ${key === today ? 'today' : ''} ${key === pick ? 'pick' : ''} ${list.length ? 'has' : ''}" data-day="${key}" aria-label="${m}月${d}日${list.length ? `，${list.length} 個行程` : ''}">
      <b>${d}</b>${list.slice(0, 2).map((e) => `<span class="cal-ev kd-${e.kind} ${lv.get(e.id) ? 'off' : ''}">${esc(e.title)}</span>`).join('')}${list.length > 2 ? `<span class="cal-more">+${list.length - 2}</span>` : ''}</button>`);
  }
  return `<div class="cal-grid">${'日一二三四五六'.split('').map((w) => `<span class="cal-wk">${w}</span>`).join('')}${cells.join('')}</div>`;
}

route('/events', async () => {
  const p = state.p;
  const filter = sessionStorage.getItem('evf') || 'month';
  const today = twParts(new Date()).date;
  const ym = sessionStorage.getItem('evm') || today.slice(0, 7);
  const nowIso = new Date(Date.now() - 3 * 3600e3).toISOString();
  let q = sb.from('events').select('*').order('starts_at', { ascending: filter !== 'past' });
  if (filter === 'month') {
    const [y, m] = ym.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    q = q.gte('starts_at', twToIso(`${ym}-01`, '00:00')).lt('starts_at', twToIso(`${next}-01`, '00:00')).limit(200);
  } else q = filter === 'past' ? q.lt('starts_at', nowIso).limit(60) : q.gte('starts_at', nowIso).limit(80);
  const [{ data: evsAll }, { data: leaves }] = await Promise.all([q, sb.from('leave_requests').select('*').eq('user_id', me())]);
  const evs = (evsAll || []).filter((e) => forMe(e));
  const lv = new Map((leaves || []).filter((l) => !isAttend(l)).map((l) => [l.event_id, l]));
  // 預設選今天；今天沒行程就選這個月接下來第一個有行程的日子
  const from = ym === today.slice(0, 7) ? today : `${ym}-01`;
  const nextDay = (evs || []).map((e) => twParts(e.starts_at).date).filter((d) => d >= from).sort()[0];
  const pick = sessionStorage.getItem('evd') || nextDay || from;
  const shift = (n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  setTimeout(() => {
    $$('[data-evf]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('evf', b.dataset.evf); render(); }));
    $$('[data-evm]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('evm', b.dataset.evm); sessionStorage.removeItem('evd'); render(); }));
    $$('[data-day]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('evd', b.dataset.day); render(); }));
    $('#add-ev')?.addEventListener('click', () => editEvent());
  });
  const head = pageHead('行事曆', '練習、分部課、教學班與演出，會同步到你的 Google 行事曆。',
    `<div class="seg"><button data-evf="month" aria-pressed="${filter === 'month'}">月曆</button><button data-evf="upcoming" aria-pressed="${filter === 'upcoming'}">接下來</button><button data-evf="past" aria-pressed="${filter === 'past'}">已結束</button></div>
     ${p.officer ? '<button class="btn pri" id="add-ev">＋ 新增行程</button>' : ''}`);
  if (filter === 'month') {
    const dayList = (evs || []).filter((e) => twParts(e.starts_at).date === pick);
    const [, pm, pd] = pick.split('-').map(Number);
    return head + `<section class="card cal-card">
      <div class="cal-nav"><button class="icon-btn" data-evm="${shift(-1)}" aria-label="上個月">‹</button><h2>${+ym.slice(0, 4)} 年 ${+ym.slice(5)} 月</h2><button class="icon-btn" data-evm="${shift(1)}" aria-label="下個月">›</button>
        ${ym !== today.slice(0, 7) ? `<button class="btn sm ghost" data-evm="${today.slice(0, 7)}">回到本月</button>` : ''}</div>
      ${monthGrid(ym, evs || [], lv, pick)}</section>
      <section class="card"><div class="card-head"><h2>${pm}/${pd}（${twWeekday(twToIso(pick, '12:00'))}）</h2><span class="muted small">${dayList.length ? `${dayList.length} 個行程` : ''}</span></div>
      ${dayList.length ? `<div class="ev-list">${dayList.map((e) => eventCard(e, { leave: lv.get(e.id) })).join('')}</div>` : '<p class="muted small">這天沒有行程。</p>'}</section>`;
  }
  const groups = new Map();
  for (const e of evs || []) {
    const k = twParts(e.starts_at).date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return head +
    (groups.size ? [...groups].map(([m, list]) => `<section class="month"><h2 class="month-h">${+m.slice(5)} 月</h2><div class="ev-list">${list.map((e) => eventCard(e, { leave: lv.get(e.id) })).join('')}</div></section>`).join('')
      : empty(filter === 'past' ? '還沒有已結束的行程' : '接下來沒有行程', p.officer ? '按「新增行程」建立第一次練習，系統會自動同步到大家的行事曆。' : '幹部建立行程後會出現在這裡。'));
});

route('/events/:id', async ({ id }) => {
  const p = state.p;
  const { data: ev } = await sb.from('events').select('*').eq('id', id).maybeSingle();
  if (!ev) return empty('找不到這個行程', '可能已被刪除，或你沒有查看權限。', '<a class="btn" href="#/events">回行程</a>');
  const [{ data: eps }, { data: myRow }] = await Promise.all([
    sb.from('event_pieces').select('piece_id, pieces(id,title)').eq('event_id', id),
    sb.from('leave_requests').select('*').eq('event_id', id).eq('user_id', me()).maybeSingle(),
  ]);
  const past = daysFromToday(ev.starts_at) < 0;
  const confirmed = isAttend(myRow);
  const myLeave = confirmed ? null : myRow;
  const canRoll = p.officer || p.leader;
  const roster = (await sb.rpc('event_roster', { eid: id })).data || [];
  // 病假證明（只有幹部、組長讀得到別人的）
  const proofOf = new Map(canRoll && roster.some((r) => r.leave_type === 'sick')
    ? ((await sb.from('leave_requests').select('user_id, proof_paths, proof_dm').eq('event_id', id).eq('type', 'sick')).data || []).map((x) => [x.user_id, x]) : []);
  const mine = roster.find((r) => r.user_id === me());
  const expectedMe = mine?.expected;

  setTimeout(() => {
    $('#edit-ev')?.addEventListener('click', () => editEvent(ev));
    $$('[data-proof]').forEach((b) => (b.onclick = () => openProof(b.dataset.proof)));
    $('#leave-btn')?.addEventListener('click', () => leaveDialog(ev, myLeave));
    $('#attend-btn')?.addEventListener('click', () => toggleAttend(id, !confirmed));
    $('#all-present')?.addEventListener('click', async () => {
      const rows = roster.filter((r) => r.expected && !r.status).map((r) => ({ event_id: id, user_id: r.user_id, status: defaultRollStatus(r) || 'present' }));
      if (!rows.length) return toast('沒有未點名的人');
      await run(() => sb.from('attendance').upsert(rows), `已點名 ${rows.length} 人`); render();
    });
    $$('[data-roll]').forEach((sel) => (sel.onchange = async () => {
      const uid = sel.dataset.roll;
      if (!sel.value) await run(() => sb.from('attendance').delete().eq('event_id', id).eq('user_id', uid));
      else await run(() => sb.from('attendance').upsert({ event_id: id, user_id: uid, status: sel.value }));
      sel.closest('tr').dataset.st = sel.value;
    }));
  });

  const pieces = (eps || []).map((x) => x.pieces).filter(Boolean);
  const exp = roster.filter((r) => r.expected);
  const leaves = roster.filter((r) => r.leave_type && !isAttend(r));
  const yes = roster.filter((r) => isAttend(r)).length;
  const counts = Object.fromEntries(Object.keys(ATT_LABEL).map((k) => [k, roster.filter((r) => r.status === k).length]));
  const bySec = new Map();
  for (const r of roster) { const s = secsOf(state.people.get(r.user_id))[0] || '未分組'; if (!bySec.has(s)) bySec.set(s, []); bySec.get(s).push(r); }

  const secOrder = (s) => { const i = SECTIONS.indexOf(s); return i < 0 ? 99 : i; };
  const secs = [...bySec].sort((a, b) => secOrder(a[0]) - secOrder(b[0]));
  return `<a class="back" href="#/events">← 行程</a>` +
    pageHead(ev.title, `<span class="kind">${kindsLabel(ev)}</span> ${sectionsOf(ev).map(sectionChip).join(' ')} <span class="mono">${fmtRange(ev.starts_at, ev.ends_at)}</span>${ev.location ? ` · ${esc(ev.location)}` : ''}`,
      p.officer ? '<button class="btn" id="edit-ev">編輯</button>' : '') +
    `<div class="grid2">
      <section class="card">
        <h2>這次練習</h2>
        ${pieces.length ? `<div class="tags">${pieces.map((x) => `<a class="tag" href="#/pieces/${x.id}">${esc(x.title)}</a>`).join('')}</div>` : '<p class="muted">沒有指定曲目</p>'}
        ${ev.note ? `<p class="note">${esc(ev.note)}</p>` : ''}
        ${!ev.counts_attendance ? '<p class="muted small">這次不計入出席率</p>' : ''}
      </section>
      <section class="card">
        <h2>我的狀態</h2>
        ${mine?.status ? `<p><span class="att att-${mine.status}">${ATT_LABEL[mine.status]}</span></p>`
          : expectedMe === false ? '<p><span class="att att-na">無曲</span> 這次沒有排到你的曲目，不用到。</p>'
          : myLeave ? `<p><span class="chip ${['leave', 'sick'].includes(myLeave.type) ? 'bad' : 'warn'}">已${LEAVE_LABEL[myLeave.type]}</span> ${esc(myLeave.reason)}</p>`
          : confirmed ? '<p><span class="chip ok">已確認出席</span></p>'
          : '<p class="muted">預計出席・還沒確認</p>'}
        ${!past && expectedMe !== false && !mine?.status ? `<div class="row-start">${myLeave ? '' : `<button class="btn ${confirmed ? '' : 'pri'}" id="attend-btn">${confirmed ? '取消確認' : '出席'}</button>`}
          <button class="btn ${myLeave ? '' : 'ghost'}" id="leave-btn">${myLeave ? '修改請假' : '請假／晚到／早退'}</button></div>` : ''}
      </section>
    </div>` +
    (canRoll ? `<section class="card">
      <div class="card-head"><h2>點名 <span class="muted small">應到 ${exp.length} 人${yes ? `・已確認出席 ${yes} 人` : ''}</span></h2>
        <div class="actions"><span class="stat-line">${['present', 'late', 'early', 'excused', 'sick', 'absent'].map((k) => `${ATT_LABEL[k]} <b class="mono">${counts[k]}</b>`).join('　')}</span>
        <button class="btn sm" id="all-present">其餘標為出席</button></div></div>
      <p class="small muted" style="margin-bottom:10px">晚到、早退有事先在系統預告的算 1 次出席，沒預告的算 0.5 次。遲到但沒錯過自己的曲目，可以直接標「出席」。病假要附證明，沒附的可以改標「事假」。</p>
      ${leaves.length ? `<div class="leave-box"><b>請假與預告</b>${leaves.map((r) => `<div>${chipPerson(r.user_id)} <span class="chip ${['leave', 'sick'].includes(r.leave_type) ? 'bad' : 'warn'}">${LEAVE_LABEL[r.leave_type]}</span> ${esc(r.leave_reason || '')}${r.leave_type === 'sick' ? proofHtml(proofOf.get(r.user_id)) : ''}</div>`).join('')}</div>` : ''}
      ${roster.length ? `<div class="tbl-wrap"><table class="roll"><tbody>${secs.map(([s, rows]) => `<tr class="grp"><th colspan="2">${esc(s)}</th></tr>` + rows.map((r) => {
        const st = r.status || '';
        return `<tr data-st="${st}"><td>${chipPerson(r.user_id)}${r.expected ? '' : ' <span class="chip">非應到</span>'}${isAttend(r) ? ' <span class="chip ok">已確認</span>' : ''}</td>
          <td class="sel"><select data-roll="${r.user_id}" aria-label="${esc(nameOf(r.user_id))} 出席狀態"><option value="">未點名</option>${Object.entries(ATT_LABEL).map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`;
      }).join('')).join('')}</tbody></table></div>` : '<p class="muted">沒有應到的人。有勾選曲目時，只有排到這些曲目的人會出現在名單上。</p>'}
    </section>` : '');
});
