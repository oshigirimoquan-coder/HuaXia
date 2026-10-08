// 工具：連到外部網頁的小工具（開新分頁）；管理員可新增、修改
import { sb, state, route, esc, run, formDialog, pageHead, empty, render, $$, $, loadShared, toast } from '../core.js';

const tools = () => (Array.isArray(state.settings.tools) ? state.settings.tools : []);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

async function editTool(i = null) {
  const list = tools().slice(); const t = i == null ? null : list[i];
  const v = await formDialog({
    title: t ? '編輯工具' : '新增工具', danger: t ? '刪除' : null,
    fields: [
      { name: 'name', label: '名稱', required: true, value: t?.name, placeholder: '例：音準練習' },
      { name: 'url', label: '網址', type: 'url', required: true, value: t?.url, full: true, placeholder: 'https://…' },
      { name: 'desc', label: '說明（一句話）', value: t?.desc, full: true, placeholder: '例：對著麥克風拉，即時顯示音高' },
    ],
  });
  if (!v) return;
  if (v.__danger) list.splice(i, 1);
  else {
    if (!safeUrl(v.url)) return toast('網址要以 https:// 開頭', 'bad');
    const row = { name: v.name, url: v.url, desc: v.desc };
    if (t) list[i] = row; else list.push(row);
  }
  if (await run(() => sb.from('settings').upsert({ key: 'tools', value: list }), '已儲存')) { await loadShared(); render(); }
}

route('/tools', async () => {
  const p = state.p; const list = tools();
  setTimeout(() => {
    $('#add-tool')?.addEventListener('click', () => editTool());
    $$('[data-tool-edit]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); editTool(+b.dataset.toolEdit); }));
  });
  return pageHead('工具', '練習用的小工具，點了會開新分頁', p.admin ? '<button class="btn pri" id="add-tool">＋ 新增工具</button>' : '') +
    (list.length ? `<div class="tool-grid">${list.map((t, i) => safeUrl(t.url) ? `<a class="tool" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">
      <h3>${esc(t.name)}</h3>${t.desc ? `<p class="small muted">${esc(t.desc)}</p>` : ''}
      <span class="go">開啟 ↗</span>${p.admin ? `<button class="btn sm ghost" data-tool-edit="${i}">編輯</button>` : ''}</a>` : '').join('')}</div>`
      : empty('還沒有工具', p.admin ? '按「新增工具」放上常用的練習網頁。' : '管理員新增後會出現在這裡。'));
});
