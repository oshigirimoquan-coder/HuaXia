import { sb, state, me, route, go, esc, run, toast, formDialog, pageHead, empty, chipPerson, activePeople, nameOf, render, $, $$, DEMO } from '../core.js';
import { partShortage } from '../logic.js';

async function loadAll(pieceId = null) {
  let pq = sb.from('pieces').select('*').order('title');
  if (pieceId) pq = pq.eq('id', pieceId);
  const [pieces, parts, asg, ringers] = await Promise.all([
    pq, sb.from('piece_parts').select('*').order('sort'), sb.from('part_assignments').select('*'),
    state.p.officer ? sb.from('ringers').select('id,name,school,status,user_id') : { data: [] },
  ]);
  return { pieces: pieces.data || [], parts: parts.data || [], asg: asg.data || [], ringers: ringers.data || [] };
}
const ringerName = (rs, id) => rs.find((r) => r.id === id)?.name || '槍手';
const who = (a, rs) => a.user_id ? chipPerson(a.user_id) : `<span class="person ringer">${esc(ringerName(rs, a.ringer_id))}<small>槍手</small></span>`;

async function editPiece(pc = null) {
  const v = await formDialog({
    title: pc ? '編輯曲目' : '新增曲目', danger: pc ? '刪除' : null,
    fields: [
      { name: 'title', label: '曲名', required: true, value: pc?.title, full: true },
      { name: 'composer', label: '作曲／編曲', value: pc?.composer },
      { name: 'duration_min', label: '時長（分鐘）', type: 'number', step: '0.5', min: 0, value: pc?.duration_min },
      { name: 'notes', label: '備註', type: 'textarea', value: pc?.notes, full: true },
      { name: 'archived', label: '封存', type: 'toggle', text: '不在本學期曲目中（封存）', value: pc?.archived },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('pieces').delete().eq('id', pc.id), '已刪除'); return go('/pieces'); }
  const r = await run(() => pc ? sb.from('pieces').update(v).eq('id', pc.id).select().single() : sb.from('pieces').insert(v).select().single(), '已儲存');
  if (r) { go(`/pieces/${r.data.id}`); render(); }
}

async function editPart(pieceId, part = null) {
  const people = activePeople().map((p) => [p.id, nameOf(p.id)]);
  const v = await formDialog({
    title: part ? `編輯聲部：${part.name}` : '新增聲部', danger: part ? '刪除' : null,
    fields: [
      { name: 'name', label: '聲部', required: true, value: part?.name, placeholder: '例：二胡I、打擊1、高笙' },
      { name: 'needed', label: '需要人數（顯示用）', value: part?.needed ?? '1', placeholder: '例：2、2-3、1↑' },
      { name: 'needed_min', label: '至少幾人（判斷缺人）', type: 'number', min: 0, value: part?.needed_min ?? 1 },
      { name: 'sort', label: '排序', type: 'number', value: part?.sort ?? 0, hint: '數字小的排前面' },
      { name: 'tutor_id', label: '小老師', type: 'select', value: part?.tutor_id || '', options: [['', '（無）'], ...people] },
      { name: 'note', label: '備註', value: part?.note, full: true, placeholder: '例：前面有 solo、需要八度達人' },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('piece_parts').delete().eq('id', part.id), '已刪除聲部'); return render(); }
  const row = { ...v, tutor_id: v.tutor_id || null, needed_min: v.needed_min ?? 0, sort: v.sort ?? 0 };
  await run(() => part ? sb.from('piece_parts').update(row).eq('id', part.id) : sb.from('piece_parts').insert({ ...row, piece_id: pieceId }), '已儲存');
  render();
}

async function assign(part, asg, ringers) {
  const cur = asg.filter((a) => a.part_id === part.id);
  const people = activePeople().filter((p) => p.roles.some((r) => r !== 'teacher')).map((p) => [p.id, `${nameOf(p.id)}${p.section ? `（${p.section}）` : ''}`]);
  const rs = ringers.filter((r) => r.status === 'accepted' && !r.user_id).map((r) => ['r:' + r.id, `${r.name}（槍手${r.school ? '・' + r.school : ''}）`]);
  const v = await formDialog({
    title: `排人：${part.name}`, submit: '儲存',
    fields: [{ name: 'who', label: `需要 ${part.needed} 人`, type: 'checks', full: true,
      value: cur.map((a) => a.user_id || 'r:' + a.ringer_id), options: [...people, ...rs],
      hint: '槍手註冊帳號後會出現在上面的成員裡；還沒註冊的槍手列在最後。' }],
  });
  if (!v) return;
  await run(async () => {
    const d = await sb.from('part_assignments').delete().eq('part_id', part.id); if (d.error) return d;
    const rows = v.who.map((x) => x.startsWith('r:') ? { part_id: part.id, ringer_id: x.slice(2) } : { part_id: part.id, user_id: x });
    return rows.length ? sb.from('part_assignments').insert(rows) : d;
  }, '已更新編制');
  render();
}

async function openScore(s) {
  if (!s.file_path) return;
  if (DEMO) return toast('示範模式不提供下載');
  const { data, error } = await sb.storage.from('scores').createSignedUrl(s.file_path, 3600);
  if (error) return toast('無法開啟樂譜：你可能沒有這個聲部的權限', 'bad');
  window.open(data.signedUrl, '_blank', 'noopener');
}

function uploadScore(piece, partId) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,image/*';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) return toast('檔案超過 20MB，請先壓縮', 'bad');
    const safe = f.name.replace(/[^\w.\-]+/g, '_');
    const path = `${piece.id}/${partId || 'full'}/${Date.now()}_${safe}`;
    toast('上傳中…');
    const up = await run(() => sb.storage.from('scores').upload(path, f, { contentType: f.type }));
    if (!up) return;
    await run(() => sb.from('scores').insert({ piece_id: piece.id, part_id: partId, title: f.name.replace(/\.[^.]+$/, ''), file_path: path }), '已上傳');
    render();
  };
  inp.click();
}

async function editScore(s) {
  const v = await formDialog({ title: '樂譜資訊', danger: '刪除', fields: [
    { name: 'title', label: '名稱', value: s.title, full: true },
    { name: 'audio_url', label: '示範錄音連結', type: 'url', value: s.audio_url, full: true, placeholder: 'YouTube、雲端硬碟等連結' },
  ] });
  if (!v) return;
  if (v.__danger) {
    if (s.file_path) await sb.storage.from('scores').remove([s.file_path]);
    await run(() => sb.from('scores').delete().eq('id', s.id), '已刪除'); return render();
  }
  await run(() => sb.from('scores').update(v).eq('id', s.id), '已儲存'); render();
}

route('/pieces', async () => {
  const p = state.p;
  const { pieces, parts, asg } = await loadAll();
  const showArch = sessionStorage.getItem('arch') === '1';
  const mineParts = new Set(asg.filter((a) => a.user_id === me()).map((a) => a.part_id));
  const myPieces = pieces.filter((pc) => parts.some((pt) => pt.piece_id === pc.id && mineParts.has(pt.id)));
  const list = pieces.filter((pc) => showArch || !pc.archived);
  const card = (pc) => {
    const pts = parts.filter((x) => x.piece_id === pc.id);
    const short = pts.reduce((n, pt) => n + partShortage(pt, asg.filter((a) => a.part_id === pt.id).length), 0);
    const my = pts.filter((pt) => mineParts.has(pt.id)).map((pt) => pt.name);
    return `<a class="piece-card ${pc.archived ? 'arch' : ''}" href="#/pieces/${pc.id}">
      <h3>${esc(pc.title)}</h3><p class="muted small">${esc(pc.composer || '')}${pc.duration_min ? ` · <span class="mono">${pc.duration_min}′</span>` : ''}</p>
      <div class="meta">${my.length ? `<span class="chip acc">我：${esc(my.join('、'))}</span>` : ''}${p.insider ? (short ? `<span class="chip bad">缺 ${short} 人</span>` : pts.length ? '<span class="chip ok">編制齊全</span>' : '<span class="chip">尚未設定編制</span>') : ''}</div></a>`;
  };
  setTimeout(() => {
    $('#add-piece')?.addEventListener('click', () => editPiece());
    $('#arch')?.addEventListener('click', () => { sessionStorage.setItem('arch', showArch ? '0' : '1'); render(); });
  });
  const total = list.filter((x) => !x.archived).reduce((n, x) => n + (Number(x.duration_min) || 0), 0);
  return pageHead('曲目與編制', `${p.insider ? `本學期 ${list.filter((x) => !x.archived).length} 首・總長約 <span class="mono">${Math.round(total)}</span> 分鐘` : '你參與演出的曲目'}`,
    `${p.officer ? `<button class="btn ghost sm" id="arch">${showArch ? '隱藏封存' : '顯示封存'}</button><button class="btn pri" id="add-piece">＋ 新增曲目</button>` : ''}`) +
    (myPieces.length && p.insider ? `<h2 class="section-h">我的曲目</h2><div class="piece-grid">${myPieces.map(card).join('')}</div><h2 class="section-h">全部曲目</h2>` : '') +
    (list.length ? `<div class="piece-grid">${list.map(card).join('')}</div>` : empty('還沒有曲目', p.officer ? '按「新增曲目」，再為每首曲子設定聲部和排人。' : '幹部建立曲目與編制後會出現在這裡。'));
});

route('/pieces/:id', async ({ id }) => {
  const p = state.p;
  const { pieces, parts, asg, ringers } = await loadAll(id);
  const pc = pieces[0];
  if (!pc) return empty('找不到這首曲目', '可能已刪除，或你沒有參與這首曲目。', '<a class="btn" href="#/pieces">回曲目</a>');
  const pts = parts.filter((x) => x.piece_id === id);
  const { data: scores } = await sb.from('scores').select('*').eq('piece_id', id).order('created_at');
  const mine = new Set(asg.filter((a) => a.user_id === me()).map((a) => a.part_id));
  setTimeout(() => {
    $('#edit-piece')?.addEventListener('click', () => editPiece(pc));
    $('#add-part')?.addEventListener('click', () => editPart(id));
    $('#up-full')?.addEventListener('click', () => uploadScore(pc, null));
    $$('[data-part-edit]').forEach((b) => (b.onclick = () => editPart(id, pts.find((x) => x.id === b.dataset.partEdit))));
    $$('[data-assign]').forEach((b) => (b.onclick = () => assign(pts.find((x) => x.id === b.dataset.assign), asg, ringers)));
    $$('[data-up]').forEach((b) => (b.onclick = () => uploadScore(pc, b.dataset.up)));
    $$('[data-score]').forEach((b) => (b.onclick = () => openScore((scores || []).find((s) => s.id === b.dataset.score))));
    $$('[data-score-edit]').forEach((b) => (b.onclick = () => editScore((scores || []).find((s) => s.id === b.dataset.scoreEdit))));
  });
  const scoreLinks = (partId) => (scores || []).filter((s) => s.part_id === partId).map((s) =>
    `<span class="score"><button class="link" data-score="${s.id}">📄 ${esc(s.title || '樂譜')}</button>${s.audio_url ? `<a class="link" href="${esc(s.audio_url)}" target="_blank" rel="noopener">▶ 示範</a>` : ''}${p.officer ? `<button class="icon-btn" data-score-edit="${s.id}" aria-label="編輯樂譜">⋯</button>` : ''}</span>`).join('');
  const full = (scores || []).filter((s) => !s.part_id);
  return `<a class="back" href="#/pieces">← 曲目</a>` +
    pageHead(pc.title, `${esc(pc.composer || '')}${pc.duration_min ? ` · <span class="mono">${pc.duration_min} 分鐘</span>` : ''}`, p.officer ? '<button class="btn" id="edit-piece">編輯曲目</button>' : '') +
    (pc.notes ? `<p class="note">${esc(pc.notes)}</p>` : '') +
    ((p.staff || full.length) ? `<section class="card"><div class="card-head"><h2>總譜</h2>${p.officer ? '<button class="btn sm" id="up-full">上傳總譜</button>' : ''}</div>${full.length ? `<div class="scores">${scoreLinks(null)}</div>` : '<p class="muted small">尚未上傳</p>'}</section>` : '') +
    `<section class="card"><div class="card-head"><h2>編制</h2>${p.officer ? '<button class="btn sm pri" id="add-part">＋ 聲部</button>' : ''}</div>
     ${pts.length ? `<div class="parts">${pts.map((pt) => {
      const a = asg.filter((x) => x.part_id === pt.id); const short = partShortage(pt, a.length);
      return `<div class="part ${mine.has(pt.id) ? 'mine' : ''} ${short ? 'short' : ''}">
        <div class="part-name"><b>${esc(pt.name)}</b><span class="mono muted small">${esc(pt.needed)}</span>${short ? `<span class="chip bad">缺 ${short}</span>` : ''}</div>
        <div class="part-who">${a.map((x) => who(x, ringers)).join('') || '<span class="muted small">尚未排人</span>'}</div>
        <div class="part-meta">${pt.tutor_id ? `<span class="small muted">小老師</span> ${chipPerson(pt.tutor_id)}` : ''}${pt.note ? `<span class="small muted">${esc(pt.note)}</span>` : ''}</div>
        <div class="part-scores">${scoreLinks(pt.id)}</div>
        ${p.officer ? `<div class="part-act"><button class="btn sm" data-assign="${pt.id}">排人</button><button class="btn sm ghost" data-up="${pt.id}">上傳分譜</button><button class="btn sm ghost" data-part-edit="${pt.id}">編輯</button></div>` : ''}
      </div>`; }).join('')}</div>` : '<p class="muted">還沒有設定聲部。</p>'}
     ${!p.staff ? '<p class="small muted">樂譜只顯示你負責的聲部。</p>' : ''}</section>`;
});
