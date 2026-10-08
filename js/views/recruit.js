import { sb, state, route, esc, run, toast, formDialog, pageHead, empty, fmtDate, fmtTime, render, $, $$, loadShared } from '../core.js';
import { mark } from '../mark.js';
import { SECTIONS } from '../logic.js';

const EXP = { none: '沒學過', some: '學過一點', basic: '有基礎' };
const ST = { new: '新報名', contacted: '已聯絡', joined: '已加入', declined: '未加入' };

// ---------- 公開報名頁（不用登入）：網址 #/join ----------
export async function joinScreen() {
  const app = $('#app');
  const [{ data: open }, { data: team }] = await Promise.all([
    sb.from('settings').select('value').eq('key', 'recruit_open').maybeSingle(),
    sb.from('settings').select('value').eq('key', 'team_name').maybeSingle(),
  ]);
  const name = team?.value || '華夏國樂社';
  document.title = `加入${name}`;
  const head = `<div class="auth-mark">${mark(true)}<span class="seal big stamp-in">華</span></div>`;
  if (open?.value !== true) {
    app.innerHTML = `<div class="auth"><div class="auth-card">${head}<h1>目前沒有開放報名</h1>
      <p class="muted">招生期間會再開放，歡迎先到社團的 IG 或 DC 看看。</p></div></div>`;
    return;
  }
  app.innerHTML = `<div class="auth join"><div class="auth-card">${head}
    <h1>加入${esc(name)}</h1>
    <p class="muted">沒學過樂器也歡迎，社團有新生教學班。填完後幹部會主動聯絡你。</p>
    <form id="join-form" class="auth-box auth-form" novalidate>
      <label>姓名<input name="name" required maxlength="40" autocomplete="name"></label>
      <label>系級<input name="grade" required maxlength="40" placeholder="例：金融一"></label>
      <label>聯絡方式<input name="contact" required maxlength="120" placeholder="LINE ID、IG 或手機，擇一即可"></label>
      <label>學過樂器嗎<select name="experience">${Object.entries(EXP).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>學過的樂器（選填）<input name="instruments_played" maxlength="120" placeholder="例：鋼琴、小學學過笛子"></label>
      <fieldset class="checks-field"><legend>有興趣的樂器組（可複選）</legend><div class="checks">
        ${[...SECTIONS, '還不確定'].map((s) => `<label class="check"><input type="checkbox" name="interests" value="${s}"><span>${s}</span></label>`).join('')}</div></fieldset>
      <label class="check"><input type="checkbox" name="want_class"><span>想參加新生教學班</span></label>
      <label>想說的話（選填）<textarea name="message" rows="3" maxlength="1000"></textarea></label>
      <input name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
      <button class="btn pri" type="submit">送出報名</button>
    </form>
    <p class="small muted">資料只有社團幹部看得到，只用來聯絡你加入社團。</p>
  </div></div>`;
  $('#join-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('website')) return; // 機器人填的隱藏欄位
    const row = {
      name: f.get('name').trim(), grade: f.get('grade').trim(), contact: f.get('contact').trim(),
      experience: f.get('experience'), instruments_played: f.get('instruments_played').trim(),
      interests: f.getAll('interests'), want_class: f.get('want_class') === 'on', message: f.get('message').trim(),
    };
    if (!row.name || !row.grade || !row.contact) return toast('請填寫姓名、系級和聯絡方式', 'bad');
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
    const r = await sb.from('applications').insert(row);
    btn.disabled = false;
    if (r.error) return toast(/row-level security/i.test(r.error.message) ? '報名已經截止了。' : '送出失敗，請稍後再試。', 'bad');
    app.innerHTML = `<div class="auth"><div class="auth-card">${`<div class="auth-mark">${mark(false)}<span class="seal big">華</span></div>`}
      <h1>報名成功</h1><p class="muted">${esc(row.name)}，謝謝你！幹部會用「${esc(row.contact)}」跟你聯絡。</p></div></div>`;
  };
}

// ---------- 幹部的招生管理頁 ----------
async function editApp(a) {
  const v = await formDialog({
    title: `${a.name}・${a.grade}`, danger: '刪除', fields: [
      { name: 'status', label: '狀態', type: 'select', value: a.status, options: Object.entries(ST) },
      { name: 'officer_note', label: '幹部備註', type: 'textarea', value: a.officer_note, full: true, placeholder: '例：10/12 已傳 LINE，想學二胡' },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('applications').delete().eq('id', a.id), '已刪除'); return render(); }
  await run(() => sb.from('applications').update(v).eq('id', a.id), '已更新'); render();
}

route('/recruit', async () => {
  if (!state.p.officer) return empty('只有幹部可以看招生名單');
  const { data } = await sb.from('applications').select('*').order('created_at', { ascending: false });
  const list = data || [];
  const f = sessionStorage.getItem('rcf') || '';
  const shown = list.filter((a) => !f || a.status === f);
  const open = state.settings.recruit_open === true;
  const link = location.origin + location.pathname + '#/join';
  setTimeout(() => {
    $$('[data-rcf]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('rcf', b.dataset.rcf); render(); }));
    $$('[data-app]').forEach((tr) => (tr.onclick = () => editApp(list.find((x) => x.id === tr.dataset.app))));
    $('#copy-link')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); toast('已複製報名連結', 'ok'); } catch { $('#join-link').select(); }
    });
    $('#toggle-open')?.addEventListener('click', async () => {
      if (await run(() => sb.from('settings').upsert({ key: 'recruit_open', value: !open }), open ? '已關閉報名' : '已開放報名')) { await loadShared(); render(); }
    });
  });
  const n = (s) => list.filter((a) => a.status === s).length;
  return pageHead('招生', `報名表${open ? '<span class="chip ok">開放中</span>' : '<span class="chip">已關閉</span>'}・共 ${list.length} 人報名`,
    state.p.admin ? `<button class="btn ${open ? '' : 'pri'}" id="toggle-open">${open ? '關閉報名' : '開放報名'}</button>` : '') +
    `<section class="card"><div class="card-head"><h2>報名連結</h2><a class="link" href="#/join" target="_blank" rel="noopener">預覽報名頁</a></div>
      <div class="inline-form"><input id="join-link" value="${esc(link)}" readonly aria-label="報名連結"><button class="btn" id="copy-link">複製</button></div>
      <p class="small muted">貼到 IG、社博海報的 QR code 或 DC。報名的人不用註冊帳號。${state.p.admin ? '' : '開放或關閉報名由管理員操作。'}</p></section>` +
    `<div class="seg"><button data-rcf="" aria-pressed="${!f}">全部 ${list.length}</button>${Object.entries(ST).map(([k, l]) => `<button data-rcf="${k}" aria-pressed="${f === k}">${l} ${n(k)}</button>`).join('')}</div>` +
    (shown.length ? `<div class="tbl-wrap"><table class="click"><thead><tr><th>報名時間</th><th>姓名</th><th>系級</th><th>聯絡方式</th><th>經驗</th><th>有興趣</th><th>狀態</th></tr></thead><tbody>
      ${shown.map((a) => `<tr data-app="${a.id}"><td class="mono nowrap small">${fmtDate(a.created_at)} ${fmtTime(a.created_at)}</td>
        <td><b>${esc(a.name)}</b>${a.message ? `<div class="small muted">${esc(a.message)}</div>` : ''}${a.officer_note ? `<div class="small" style="color:var(--gold)">${esc(a.officer_note)}</div>` : ''}</td>
        <td>${esc(a.grade)}</td><td class="small">${esc(a.contact)}</td>
        <td class="small">${EXP[a.experience]}${a.instruments_played ? `<div class="muted">${esc(a.instruments_played)}</div>` : ''}</td>
        <td class="small">${esc(a.interests.join('、'))}${a.want_class ? '<div style="color:var(--accent)">想上教學班</div>' : ''}</td>
        <td><span class="chip ${a.status === 'joined' ? 'ok' : a.status === 'new' ? 'warn' : a.status === 'declined' ? '' : 'acc'}">${ST[a.status]}</span></td></tr>`).join('')}
    </tbody></table></div><p class="small muted">點一列可以改狀態、寫備註。報名的人加入後，請他用 Discord 或 Email 註冊網站帳號，再到「成員」核准。</p>`
      : empty(list.length ? '這個分類沒有人' : '還沒有人報名', open ? '把報名連結貼出去吧。' : '開放報名後，把連結貼到 IG 或 DC。'));
});
