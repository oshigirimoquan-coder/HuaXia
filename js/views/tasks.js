import { sb, state, me, route, esc, run, formDialog, pageHead, empty, chipPerson, activePeople, nameOf, render, $, $$ } from '../core.js';
import { daysFromToday } from '../logic.js';

const STATUS = { todo: '待辦', doing: '進行中', done: '完成' };
const AUD = { officers: '只有幹部看得到', insiders: '全體社員看得到', assignees: '只有負責人看得到' };

function dueChip(t) {
  if (!t.due) return '';
  const d = daysFromToday(t.due + 'T12:00:00+08:00');
  const [, m, day] = t.due.split('-');
  if (t.status === 'done') return `<span class="chip mono">${+m}/${+day}</span>`;
  if (d < 0) return `<span class="chip bad mono">逾期 ${-d} 天</span>`;
  if (d === 0) return '<span class="chip warn">今天到期</span>';
  if (d <= 3) return `<span class="chip warn mono">${d} 天後</span>`;
  return `<span class="chip mono">${+m}/${+day}</span>`;
}

export function taskRow(t, compact = false) {
  return `<div class="task st-${t.status}" data-task="${t.id}">
    <button class="tick" data-tick="${t.id}" aria-label="切換狀態：目前${STATUS[t.status]}" title="${STATUS[t.status]}"></button>
    <div class="task-main"><b>${esc(t.title)}</b>
      ${!compact && t.description ? `<p class="small muted">${esc(t.description)}</p>` : ''}
      <div class="meta">${dueChip(t)}${t.audience === 'officers' ? '<span class="chip role-officer">幹部</span>' : ''}${(t.assignees || []).map((a) => chipPerson(a)).join('')}</div></div></div>`;
}

async function editTask(t = null) {
  const people = activePeople().map((p) => [p.id, nameOf(p.id)]);
  const v = await formDialog({
    title: t ? '編輯任務' : '新增任務', danger: t ? '刪除' : null,
    fields: [
      { name: 'title', label: '任務', required: true, value: t?.title, full: true, placeholder: '例：借視聽館、印節目單' },
      { name: 'description', label: '說明', type: 'textarea', value: t?.description, full: true },
      { name: 'due', label: '截止日', type: 'date', value: t?.due || '' },
      { name: 'audience', label: '誰看得到', type: 'select', value: t?.audience || 'officers', options: Object.entries(AUD) },
      { name: 'assignees', label: '負責人', type: 'checks', value: t?.assignees || [], options: people, full: true },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('tasks').delete().eq('id', t.id), '已刪除'); return render(); }
  const row = { title: v.title, description: v.description, due: v.due || null, audience: v.audience, assignees: v.assignees };
  await run(() => t ? sb.from('tasks').update(row).eq('id', t.id) : sb.from('tasks').insert(row), t ? '已更新' : '已建立');
  render();
}

export function bindTasks(list) {
  $$('[data-tick]').forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const t = list.find((x) => x.id === b.dataset.tick); if (!t) return;
    const next = t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo';
    await run(() => sb.from('tasks').update({ status: next }).eq('id', t.id)); render();
  }));
  if (state.p.officer) $$('[data-task]').forEach((el) => (el.onclick = () => editTask(list.find((x) => x.id === el.dataset.task))));
}

route('/tasks', async () => {
  const p = state.p;
  const f = sessionStorage.getItem('tf') || (p.officer ? 'all' : 'mine');
  const { data } = await sb.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false });
  let list = data || [];
  if (f === 'mine') list = list.filter((t) => (t.assignees || []).includes(me()));
  if (f === 'officers') list = list.filter((t) => t.audience === 'officers');
  setTimeout(() => {
    bindTasks(list);
    $('#add-task')?.addEventListener('click', () => editTask());
    $$('[data-tf]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('tf', b.dataset.tf); render(); }));
  });
  const cols = ['todo', 'doing', 'done'];
  return pageHead('任務', p.officer ? '點任務可以編輯；點左邊的圓圈切換狀態。幹部事項社員看不到。' : '點左邊的圓圈切換狀態。',
    `<div class="seg"><button data-tf="all" aria-pressed="${f === 'all'}">全部</button><button data-tf="mine" aria-pressed="${f === 'mine'}">我的</button>${p.officer ? `<button data-tf="officers" aria-pressed="${f === 'officers'}">幹部事項</button>` : ''}</div>
     ${p.officer ? '<button class="btn pri" id="add-task">＋ 新增任務</button>' : ''}`) +
    (list.length ? `<div class="board">${cols.map((c) => { const l = list.filter((t) => t.status === c); return `<section class="col"><h2>${STATUS[c]} <span class="mono muted">${l.length}</span></h2><div class="task-list">${l.map((t) => taskRow(t)).join('') || '<p class="muted small">—</p>'}</div></section>`; }).join('')}</div>`
      : empty('沒有任務', p.officer ? '按「新增任務」分派工作，可以設定只有幹部看得到。' : '有指派給你的任務時會出現在這裡。'));
});
