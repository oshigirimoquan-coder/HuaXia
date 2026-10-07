import { sb, state, me, route, esc, run, formDialog, pageHead, empty, chipPerson, fmtDate, fmtTime, render, $, $$, toast } from '../core.js';
import { ANN_TYPE, ANN_AUDIENCE, SECTIONS } from '../logic.js';
import { invokeFn } from './events.js';

async function editAnn(a = null) {
  const v = await formDialog({
    title: a ? '編輯公告' : '發布公告', danger: a ? '刪除' : null, submit: a ? '儲存' : '發布',
    fields: [
      { name: 'type', label: '類型', type: 'select', value: a?.type || 'practice', options: Object.entries(ANN_TYPE) },
      { name: 'audience', label: '對象', type: 'select', value: a?.audience || 'insiders', options: Object.entries(ANN_AUDIENCE) },
      { name: 'section', label: '組別', type: 'select', value: a?.section || '', options: [['', '（對象選「某一組」時才需要）'], ...SECTIONS.map((s) => [s, s])] },
      { name: 'title', label: '標題', required: true, value: a?.title, full: true },
      { name: 'body', label: '內容', type: 'textarea', rows: 6, value: a?.body, full: true },
      { name: 'pinned', label: '置頂', type: 'toggle', text: '置頂這則公告', value: a?.pinned },
      { name: 'notify', label: '通知', type: 'toggle', text: '同步發送到 DC', value: !a },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('announcements').delete().eq('id', a.id), '已刪除'); return render(); }
  if (v.audience === 'section' && !v.section) return toast('對象是「某一組」時要選組別', 'bad');
  const row = { type: v.type, audience: v.audience, section: v.audience === 'section' ? v.section : null, title: v.title, body: v.body, pinned: v.pinned };
  const r = await run(() => a ? sb.from('announcements').update(row).eq('id', a.id).select().single() : sb.from('announcements').insert(row).select().single(), a ? '已更新' : '已發布');
  if (r && v.notify) await invokeFn('notify', { type: 'announcement', id: r.data.id }).catch((e) => toast('公告已發布，但通知沒送出：' + e.message, 'bad'));
  render();
}

route('/announcements', async () => {
  const p = state.p;
  const f = sessionStorage.getItem('af') || '';
  const [{ data }, { data: reads }] = await Promise.all([
    sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(100),
    sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
  ]);
  const read = new Set((reads || []).map((r) => r.ann_id));
  const list = (data || []).filter((a) => !f || a.type === f).sort((a, b) => (b.pinned - a.pinned) || (b.created_at > a.created_at ? 1 : -1));
  const unread = list.filter((a) => !read.has(a.id));
  if (unread.length) sb.from('announcement_reads').upsert(unread.map((a) => ({ ann_id: a.id, user_id: me() }))).then(() => document.dispatchEvent(new Event('unread-changed')));
  setTimeout(() => {
    $('#add-ann')?.addEventListener('click', () => editAnn());
    $$('[data-edit-ann]').forEach((b) => (b.onclick = () => editAnn(list.find((x) => x.id === b.dataset.editAnn))));
    $$('[data-af]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('af', b.dataset.af); render(); }));
  });
  return pageHead('公告', '', p.officer ? '<button class="btn pri" id="add-ann">＋ 發布公告</button>' : '') +
    `<div class="seg wrap"><button data-af="" aria-pressed="${!f}">全部</button>${Object.entries(ANN_TYPE).map(([k, l]) => `<button data-af="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>` +
    (list.length ? `<div class="ann-list">${list.map((a) => `<article class="ann t-${a.type} ${read.has(a.id) ? '' : 'unread'}">
      <div class="ann-top"><span class="atype t-${a.type}">${ANN_TYPE[a.type]}</span>${a.pinned ? '<span class="chip gold">置頂</span>' : ''}
        <span class="chip">${a.audience === 'section' ? esc(a.section) + '組' : ANN_AUDIENCE[a.audience]}</span>
        ${p.officer ? `<button class="btn sm ghost" data-edit-ann="${a.id}">編輯</button>` : ''}</div>
      <h3>${esc(a.title)}</h3>${a.body ? `<p class="body">${esc(a.body)}</p>` : ''}
      <div class="meta">${a.author ? chipPerson(a.author) : ''}<span class="mono small muted">${fmtDate(a.created_at)} ${fmtTime(a.created_at)}</span></div></article>`).join('')}</div>`
      : empty('目前沒有公告', p.officer ? '按「發布公告」，選好類型和對象，大家就會收到。' : ''));
});
