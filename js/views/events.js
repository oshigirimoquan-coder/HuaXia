import { sb, state, me, route, go, esc, run, toast, formDialog, armDelete, pageHead, empty, fmtDate, fmtTime, fmtRange, chipPerson, nameOf, sectionChip, render, $, $$, DEMO } from '../core.js';
import { KIND_LABEL, LEAVE_LABEL, ATT_LABEL, SECTIONS, eventDefaults, twParts, twWeekday, twToIso, daysFromToday, defaultRollStatus } from '../logic.js';

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

export function eventCard(e, { leave } = {}) {
  const d = daysFromToday(e.starts_at);
  const t = twParts(e.starts_at);
  const flag = leave ? `<span class="chip ${leave.type === 'leave' ? 'bad' : 'warn'}">已${LEAVE_LABEL[leave.type]}</span>`
    : d === 0 ? '<span class="chip warn">今天</span>' : d === 1 ? '<span class="chip">明天</span>' : '';
  return `<a class="ev-card kind-${e.kind} ${d < 0 ? 'past' : ''}" href="#/events/${e.id}">
    <div class="ev-date"><b>${t.month}/${t.day}</b><span>週${twWeekday(e.starts_at)}</span></div>
    <div class="ev-body">
      <div class="ev-top"><span class="kind">${KIND_LABEL[e.kind]}</span>${e.section ? sectionChip(e.section) : ''}</div>
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
      { name: 'kind', label: '類型', type: 'select', value: ev?.kind || 'tutti', options: Object.entries(KIND_LABEL) },
      { name: 'title', label: '名稱', required: true, value: ev?.title, placeholder: '例：週二大團、11/14 吹管分部課' },
      { name: 'date', label: '日期', type: 'date', required: true, value: s?.date || twParts(new Date()).date },
      { name: 'start', label: '開始', type: 'time', required: true, value: s?.time || '19:30' },
      { name: 'end', label: '結束', type: 'time', required: true, value: e2?.time || '21:30' },
      { name: 'location', label: '地點', value: ev?.location, placeholder: '例：721、視聽館' },
      { name: 'section', label: '分部課組別', type: 'select', value: ev?.section || '', options: [['', '（不是分部課）'], ...SECTIONS.map((x) => [x, x])], hint: '類型選「分部課」時才需要' },
      { name: 'class_id', label: '教學班', type: 'select', value: ev?.class_id || '', options: [['', '（不是教學班）'], ...classes.map((c) => [c.id, c.name])], hint: '類型選「教學班」時才需要' },
      { name: 'pieces', label: '這次練習的曲目', type: 'checks', value: cur, options: pieces, full: true, hint: '有勾選曲目時，沒被排到這些曲目的人自動算「無曲」，不計入出席率' },
      { name: 'note', label: '備註', type: 'textarea', value: ev?.note, full: true },
      { name: 'counts', label: '出席率', type: 'toggle', text: '這次計入出席率', value: ev ? ev.counts_attendance : true },
      { name: 'notify', label: '通知', type: 'toggle', text: '同步發送通知（DC）', value: !ev },
    ],
  });
  if (!v) return;
  if (v.__danger) { await deleteEvent(ev); return; }
  if (v.end <= v.start) { toast('結束時間要晚於開始時間', 'bad'); return; }
  const defs = eventDefaults(v.kind, v.section);
  const row = {
    kind: v.kind, title: v.title, location: v.location, note: v.note,
    starts_at: twToIso(v.date, v.start), ends_at: twToIso(v.date, v.end),
    section: v.kind === 'sectional' ? v.section || null : null,
    class_id: v.kind === 'class' ? v.class_id || null : null,
    calendar_key: defs.calendar_key, audience: defs.audience,
    counts_attendance: v.kind === 'officer' ? false : v.counts,
    semester_id: ev?.semester_id || state.semester.id,
  };
  if (v.kind === 'sectional' && !row.section) { toast('分部課要選組別', 'bad'); return; }
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
  await invokeFn('notify', { type: 'event', change: 'deleted', kind: ev.kind, title: ev.title, starts_at: ev.starts_at, location: ev.location, section: ev.section }).catch(() => {});
  go('/events');
}

async function leaveDialog(ev, cur) {
  const v = await formDialog({
    title: `${cur ? '修改' : ''}請假：${ev.title}`,
    danger: cur ? '撤回' : null,
    submit: '送出',
    fields: [
      { name: 'type', label: '類型', type: 'select', value: cur?.type || 'leave', options: Object.entries(LEAVE_LABEL) },
      { name: 'reason', label: '事由', type: 'textarea', value: cur?.reason, required: true, rows: 3, placeholder: '例：期中考、家教卡到、會晚 30 分鐘' },
    ],
  });
  if (!v) return;
  if (v.__danger) await run(() => sb.from('leave_requests').delete().eq('event_id', ev.id).eq('user_id', me()), '已撤回');
  else await run(() => sb.from('leave_requests').upsert({ event_id: ev.id, user_id: me(), type: v.type, reason: v.reason }), '已送出');
  render();
}

route('/events', async () => {
  const p = state.p;
  const filter = sessionStorage.getItem('evf') || 'upcoming';
  let q = sb.from('events').select('*').order('starts_at', { ascending: filter !== 'past' });
  const nowIso = new Date(Date.now() - 3 * 3600e3).toISOString();
  q = filter === 'past' ? q.lt('starts_at', nowIso).limit(60) : q.gte('starts_at', nowIso).limit(80);
  const [{ data: evs }, { data: leaves }] = await Promise.all([q, sb.from('leave_requests').select('*').eq('user_id', me())]);
  const lv = new Map((leaves || []).map((l) => [l.event_id, l]));
  const groups = new Map();
  for (const e of evs || []) {
    const t = twParts(e.starts_at); const k = `${t.date.slice(0, 7)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  setTimeout(() => {
    $$('[data-evf]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('evf', b.dataset.evf); render(); }));
    $('#add-ev')?.addEventListener('click', () => editEvent());
  });
  return pageHead('行程', '練習、分部課、教學班與演出。行程會同步到你的 Google 行事曆。',
    `<div class="seg"><button data-evf="upcoming" aria-pressed="${filter !== 'past'}">接下來</button><button data-evf="past" aria-pressed="${filter === 'past'}">已結束</button></div>
     ${p.officer ? '<button class="btn pri" id="add-ev">＋ 新增行程</button>' : ''}`) +
    (groups.size ? [...groups].map(([m, list]) => `<section class="month"><h2 class="month-h">${+m.slice(5)} 月</h2><div class="ev-list">${list.map((e) => eventCard(e, { leave: lv.get(e.id) })).join('')}</div></section>`).join('')
      : empty(filter === 'past' ? '還沒有已結束的行程' : '接下來沒有行程', p.officer ? '按「新增行程」建立第一次練習，系統會自動同步到大家的行事曆。' : '幹部建立行程後會出現在這裡。'));
});

route('/events/:id', async ({ id }) => {
  const p = state.p;
  const { data: ev } = await sb.from('events').select('*').eq('id', id).maybeSingle();
  if (!ev) return empty('找不到這個行程', '可能已被刪除，或你沒有查看權限。', '<a class="btn" href="#/events">回行程</a>');
  const [{ data: eps }, { data: myLeave }] = await Promise.all([
    sb.from('event_pieces').select('piece_id, pieces(id,title)').eq('event_id', id),
    sb.from('leave_requests').select('*').eq('event_id', id).eq('user_id', me()).maybeSingle(),
  ]);
  const past = daysFromToday(ev.starts_at) < 0;
  const canRoll = p.officer || p.leader;
  const roster = (await sb.rpc('event_roster', { eid: id })).data || [];
  const mine = roster.find((r) => r.user_id === me());
  const expectedMe = mine?.expected;

  setTimeout(() => {
    $('#edit-ev')?.addEventListener('click', () => editEvent(ev));
    $('#leave-btn')?.addEventListener('click', () => leaveDialog(ev, myLeave));
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
  const leaves = roster.filter((r) => r.leave_type);
  const counts = Object.fromEntries(Object.keys(ATT_LABEL).map((k) => [k, roster.filter((r) => r.status === k).length]));
  const bySec = new Map();
  for (const r of roster) { const s = state.people.get(r.user_id)?.section || '未分組'; if (!bySec.has(s)) bySec.set(s, []); bySec.get(s).push(r); }

  const secOrder = (s) => { const i = SECTIONS.indexOf(s); return i < 0 ? 99 : i; };
  const secs = [...bySec].sort((a, b) => secOrder(a[0]) - secOrder(b[0]));
  return `<a class="back" href="#/events">← 行程</a>` +
    pageHead(ev.title, `<span class="kind">${KIND_LABEL[ev.kind]}</span> ${ev.section ? sectionChip(ev.section) : ''} <span class="mono">${fmtRange(ev.starts_at, ev.ends_at)}</span>${ev.location ? ` · ${esc(ev.location)}` : ''}`,
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
          : myLeave ? `<p><span class="chip ${myLeave.type === 'leave' ? 'bad' : 'warn'}">已${LEAVE_LABEL[myLeave.type]}</span> ${esc(myLeave.reason)}</p>`
          : '<p class="muted">預計出席</p>'}
        ${!past ? `<button class="btn" id="leave-btn">${myLeave ? '修改請假' : '請假／晚到／早退'}</button>` : ''}
      </section>
    </div>` +
    (canRoll ? `<section class="card">
      <div class="card-head"><h2>點名 <span class="muted small">應到 ${exp.length} 人</span></h2>
        <div class="actions"><span class="stat-line">${['present', 'late', 'early', 'excused', 'absent'].map((k) => `${ATT_LABEL[k]} <b class="mono">${counts[k]}</b>`).join('　')}</span>
        <button class="btn sm" id="all-present">其餘標為出席</button></div></div>
      <p class="small muted" style="margin-bottom:10px">晚到、早退有事先在系統預告的算 1 次出席，沒預告的算 0.5 次。遲到但沒錯過自己的曲目，可以直接標「出席」。</p>
      ${leaves.length ? `<div class="leave-box"><b>請假與預告</b>${leaves.map((r) => `<div>${chipPerson(r.user_id)} <span class="chip ${r.leave_type === 'leave' ? 'bad' : 'warn'}">${LEAVE_LABEL[r.leave_type]}</span> ${esc(r.leave_reason || '')}</div>`).join('')}</div>` : ''}
      ${roster.length ? `<div class="tbl-wrap"><table class="roll"><tbody>${secs.map(([s, rows]) => `<tr class="grp"><th colspan="2">${esc(s)}</th></tr>` + rows.map((r) => {
        const st = r.status || '';
        return `<tr data-st="${st}"><td>${chipPerson(r.user_id)}${r.expected ? '' : ' <span class="chip">非應到</span>'}</td>
          <td class="sel"><select data-roll="${r.user_id}" aria-label="${esc(nameOf(r.user_id))} 出席狀態"><option value="">未點名</option>${Object.entries(ATT_LABEL).map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`;
      }).join('')).join('')}</tbody></table></div>` : '<p class="muted">沒有應到的人。有勾選曲目時，只有排到這些曲目的人會出現在名單上。</p>'}
    </section>` : '');
});
