import { sb, state, me, route, esc, run, toast, formDialog, pageHead, empty, chipPerson, activePeople, nameOf, sectionChip, fmtDate, render, $, $$ } from '../core.js';
import { SECTIONS, progressPct } from '../logic.js';

const TABS = { classes: '教學班', resources: '教學資源', reports: '練習回報' };

async function editClass(c = null) {
  const people = activePeople();
  const opts = people.map((p) => [p.id, `${nameOf(p.id)}${p.roles.includes('newbie') ? '（新生）' : ''}`]);
  const [{ data: stu }, { data: ms }] = c ? await Promise.all([
    sb.from('class_students').select('user_id').eq('class_id', c.id),
    sb.from('class_milestones').select('*').eq('class_id', c.id).order('sort'),
  ]) : [{ data: [] }, { data: [] }];
  const v = await formDialog({
    title: c ? '編輯教學班' : '新增教學班', danger: c ? '刪除' : null,
    fields: [
      { name: 'name', label: '班名', required: true, value: c?.name, placeholder: '例：二胡入門班' },
      { name: 'instrument', label: '樂器', value: c?.instrument },
      { name: 'teachers', label: '帶課的人', type: 'checks', value: c?.teacher_ids || [], options: opts.filter(([id]) => !state.people.get(id)?.roles.includes('newbie')), full: true },
      { name: 'students', label: '學員', type: 'checks', value: (stu || []).map((x) => x.user_id), options: opts.filter(([id]) => state.people.get(id)?.roles.includes('newbie')), full: true, hint: '只列出有「新生」身分組的人' },
      { name: 'milestones', label: '進度清單（一行一項）', type: 'textarea', rows: 6, full: true, value: (ms || []).map((m) => m.title).join('\n'), placeholder: '會調音\n會基本指法\n能拉空弦長音\n能演奏第一首曲子' },
      { name: 'note', label: '備註', type: 'textarea', value: c?.note, full: true },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('classes').delete().eq('id', c.id), '已刪除'); return render(); }
  const row = { name: v.name, instrument: v.instrument, teacher_ids: v.teachers, note: v.note, semester_id: c?.semester_id || state.semester?.id || null };
  const r = await run(() => c ? sb.from('classes').update(row).eq('id', c.id).select().single() : sb.from('classes').insert(row).select().single());
  if (!r) return;
  const cid = r.data.id;
  await sb.from('class_students').delete().eq('class_id', cid);
  if (v.students.length) await sb.from('class_students').insert(v.students.map((u) => ({ class_id: cid, user_id: u })));
  // 進度清單：保留同名項目（不清掉已勾的進度），新增新的，刪除拿掉的
  const want = v.milestones.split('\n').map((s) => s.trim()).filter(Boolean);
  const have = ms || [];
  for (const m of have) if (!want.includes(m.title)) await sb.from('class_milestones').delete().eq('id', m.id);
  for (const [i, t] of want.entries()) {
    const ex = have.find((m) => m.title === t);
    if (ex) await sb.from('class_milestones').update({ sort: i }).eq('id', ex.id);
    else await sb.from('class_milestones').insert({ class_id: cid, title: t, sort: i });
  }
  toast('已儲存', 'ok'); render();
}

async function classesTab() {
  const p = state.p;
  const [{ data: classes }, { data: stu }, { data: ms }, { data: prog }] = await Promise.all([
    sb.from('classes').select('*').order('created_at'),
    sb.from('class_students').select('*'), sb.from('class_milestones').select('*').order('sort'), sb.from('class_progress').select('*'),
  ]);
  const done = new Set((prog || []).map((x) => `${x.milestone_id}|${x.user_id}`));
  setTimeout(() => {
    $('#add-class')?.addEventListener('click', () => editClass());
    $$('[data-class-edit]').forEach((b) => (b.onclick = () => editClass(classes.find((c) => c.id === b.dataset.classEdit))));
    $$('[data-prog]').forEach((cb) => (cb.onchange = async () => {
      const [mid, uid] = cb.dataset.prog.split('|');
      const r = cb.checked ? await run(() => sb.from('class_progress').upsert({ milestone_id: mid, user_id: uid }))
        : await run(() => sb.from('class_progress').delete().eq('milestone_id', mid).eq('user_id', uid));
      if (!r) cb.checked = !cb.checked;
    }));
  });
  const list = classes || [];
  return (p.officer ? '<div class="row-end"><button class="btn pri" id="add-class">＋ 新增教學班</button></div>' : '') +
    (list.length ? list.map((c) => {
      const students = (stu || []).filter((s) => s.class_id === c.id).map((s) => s.user_id);
      const miles = (ms || []).filter((m) => m.class_id === c.id);
      const canCheck = p.officer || c.teacher_ids.includes(me());
      const visible = canCheck ? students : students.filter((u) => u === me());
      return `<section class="card class-card"><div class="card-head"><div><h2>${esc(c.name)}</h2><p class="muted small">${esc(c.instrument || '')}${c.teacher_ids.length ? '・帶課：' + c.teacher_ids.map(nameOf).map(esc).join('、') : ''}・學員 ${students.length} 人</p></div>
        ${p.officer ? `<button class="btn sm" data-class-edit="${c.id}">編輯</button>` : ''}</div>
        ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
        ${miles.length && visible.length ? `<div class="tbl-wrap"><table class="prog"><thead><tr><th>學員</th>${miles.map((m) => `<th class="m">${esc(m.title)}</th>`).join('')}<th>進度</th></tr></thead><tbody>
          ${visible.map((u) => { const n = miles.filter((m) => done.has(`${m.id}|${u}`)).length; return `<tr><td>${chipPerson(u)}</td>${miles.map((m) => `<td class="c"><input type="checkbox" aria-label="${esc(nameOf(u))}：${esc(m.title)}" data-prog="${m.id}|${u}" ${done.has(`${m.id}|${u}`) ? 'checked' : ''} ${canCheck ? '' : 'disabled'}></td>`).join('')}
            <td><div class="mini-bar"><i style="width:${progressPct(n, miles.length)}%"></i></div><span class="mono small">${n}/${miles.length}</span></td></tr>`; }).join('')}</tbody></table></div>`
          : `<p class="muted small">${miles.length ? '還沒有學員' : '還沒有設定進度清單'}</p>`}
      </section>`;
    }).join('') : empty('還沒有教學班', p.officer ? '新增教學班，指定帶課的人和新生學員，並列出進度清單。' : ''));
}

async function resourcesTab() {
  const p = state.p;
  const { data } = await sb.from('resources').select('*').order('created_at', { ascending: false });
  const edit = async (r = null) => {
    const v = await formDialog({ title: r ? '編輯資源' : '新增教學資源', danger: r ? '刪除' : null, fields: [
      { name: 'title', label: '標題', required: true, value: r?.title, full: true, placeholder: '例：二胡調音教學、揚琴基本功' },
      { name: 'section', label: '組別', type: 'select', value: r?.section || '', options: [['', '通用'], ...SECTIONS.map((s) => [s, s])] },
      { name: 'instrument', label: '樂器', value: r?.instrument },
      { name: 'url', label: '連結', type: 'url', value: r?.url, full: true },
      { name: 'note', label: '說明', type: 'textarea', value: r?.note, full: true },
    ] });
    if (!v) return;
    if (v.__danger) { await run(() => sb.from('resources').delete().eq('id', r.id), '已刪除'); return render(); }
    const row = { ...v, section: v.section || null };
    await run(() => r ? sb.from('resources').update(row).eq('id', r.id) : sb.from('resources').insert(row), '已儲存'); render();
  };
  setTimeout(() => {
    $('#add-res')?.addEventListener('click', () => edit());
    $$('[data-res-edit]').forEach((b) => (b.onclick = () => edit(data.find((x) => x.id === b.dataset.resEdit))));
  });
  const groups = [['', '通用'], ...SECTIONS.map((s) => [s, s])].map(([k, l]) => [l, (data || []).filter((r) => (r.section || '') === k)]).filter(([, l]) => l.length);
  return (p.canTeach ? '<div class="row-end"><button class="btn pri" id="add-res">＋ 新增資源</button></div>' : '') +
    (groups.length ? groups.map(([l, list]) => `<section class="card"><h2>${l === '通用' ? '通用' : sectionChip(l)}</h2><ul class="res-list">${list.map((r) => `<li>
      <div><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title)}</b></a>${r.instrument ? ` <span class="chip">${esc(r.instrument)}</span>` : ''}${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ''}</div>
      ${p.canTeach ? `<button class="btn sm ghost" data-res-edit="${r.id}">編輯</button>` : ''}</li>`).join('')}</ul></section>`).join('')
      : empty('還沒有教學資源', p.canTeach ? '把調音、指法、基本功的影片或文件連結加進來，新生和學長姐都能用。' : '組長和指導老師新增後會出現在這裡。'));
}

async function reportsTab() {
  const [{ data }, { data: fb }, { data: pieces }] = await Promise.all([
    sb.from('practice_reports').select('*').order('created_at', { ascending: false }).limit(60),
    sb.from('report_feedback').select('*').order('created_at'),
    sb.from('pieces').select('id,title').eq('archived', false).order('title'),
  ]);
  const add = async () => {
    const v = await formDialog({ title: '新增練習回報', submit: '送出', fields: [
      { name: 'title', label: '標題', required: true, full: true, placeholder: '例：泰芙努特 B 段 慢速' },
      { name: 'piece_id', label: '曲目', type: 'select', options: [['', '（基本功／其他）'], ...(pieces || []).map((p) => [p.id, p.title])] },
      { name: 'url', label: '錄音或影片連結', type: 'url', required: true, full: true, placeholder: '雲端硬碟、YouTube（不公開）等' },
      { name: 'note', label: '想請教的地方', type: 'textarea', full: true },
    ] });
    if (!v) return;
    await run(() => sb.from('practice_reports').insert({ ...v, piece_id: v.piece_id || null }), '已送出，小老師和組長看得到'); render();
  };
  setTimeout(() => {
    $('#add-rep')?.addEventListener('click', add);
    $$('[data-fb]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault(); const inp = f.querySelector('input'); const body = inp.value.trim(); if (!body) return;
      if (await run(() => sb.from('report_feedback').insert({ report_id: f.dataset.fb, body }))) render();
    }));
  });
  const ptitle = (id) => (pieces || []).find((p) => p.id === id)?.title;
  return '<div class="row-end"><button class="btn pri" id="add-rep">＋ 新增練習回報</button></div>' +
    ((data || []).length ? (data || []).map((r) => `<article class="card report">
      <div class="card-head"><div>${chipPerson(r.user_id)} <span class="muted small mono">${fmtDate(r.created_at)}</span></div>${r.piece_id ? `<span class="chip">${esc(ptitle(r.piece_id) || '曲目')}</span>` : ''}</div>
      <h3><a href="${esc(r.url)}" target="_blank" rel="noopener">▶ ${esc(r.title)}</a></h3>${r.note ? `<p>${esc(r.note)}</p>` : ''}
      <div class="feedback">${(fb || []).filter((x) => x.report_id === r.id).map((x) => `<div class="fb"><b>${esc(nameOf(x.author))}</b> ${esc(x.body)}</div>`).join('')}
        <form class="fb-form" data-fb="${r.id}"><input type="text" placeholder="${r.user_id === me() ? '補充說明…' : '給回饋…'}" aria-label="回饋" maxlength="500"><button class="btn sm">送出</button></form></div></article>`).join('')
      : empty('還沒有練習回報', '錄一段練習貼上連結，小老師、組長或帶課的人會給你回饋。'));
}

route('/teaching', async () => {
  // 教學資源改發在公告的「資源」分類；練習回報暫停使用（資料保留）
  return pageHead('教學班', '新生教學班與進度。帶課的人在這裡勾選學員的進度。') + await classesTab();
});
