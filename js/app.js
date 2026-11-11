import { sb, state, connect, loadMe, loadShared, render, esc, $, $$, toast, errText, me, DEMO, DEMO_ROLES, demoAs, avatar, nameOf, linkError, authError, mySecs } from './core.js';
import './views/home.js';
import './views/events.js';
import './views/attendance.js';
import './views/announcements.js';
import './views/tasks.js';
import './views/pieces.js';
import './views/teaching.js';
import './views/ringers.js';
import './views/members.js';
import './views/settings.js';
import './views/me.js';
import './views/tools.js';
import './views/seating.js';
import { joinScreen } from './views/recruit.js';
import { SHARE_CATS } from './views/announcements.js';

import './views/groups.js';
import './views/rooms.js';

// 2026-10 改版：主分頁五格（手機在底部、電腦在上方）；其他功能收進右上角頭像選單
const ICON = {
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  ann: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  groups: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 19c0-2 1.5-3.5 4-3.5"/>',
  score: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
};
const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const TABS = [
  { path: '/', label: '首頁', icon: 'home', also: ['/attendance'] },
  { path: '/announcements', label: '公告', icon: 'ann', badge: 'main', also: ['/sizhu', '/concerts', '/alumni', '/resources', '/tools'] },
  { path: '/events', label: '行事曆', icon: 'cal', also: ['/rooms'] },
  { path: '/groups', label: '各組', icon: 'groups', also: ['/teaching'] },
  { path: '/pieces', label: '樂譜與編制', icon: 'score' },
];
const MENU = [
  { path: '/me', label: '我的設定', group: '個人' },
  { path: '/attendance', label: '出席明細', group: '個人', show: (p) => !p.ringerOnly },
  { path: '/members', label: '成員', group: '社團', show: (p) => p.insider },
  { path: '/rooms', label: '借教室', group: '社團', show: (p) => p.insider },
  { path: '/attendance/all', label: '出席率總表', group: '幹部', show: (p) => p.viewAll || p.leader },
  { path: '/ringers', label: '槍手', group: '幹部', show: (p) => p.viewAll },
  { path: '/recruit', label: '招生', group: '幹部', show: (p) => p.viewAll },
  { path: '/settings', label: '系統設定', group: '幹部', show: (p) => p.admin },
];
const tabOf = (path) => TABS.find((t) => t.path === '/' ? path === '/' || t.also.some((a) => path.startsWith(a)) : path.startsWith(t.path) || (t.also || []).some((a) => path.startsWith(a)));

document.addEventListener('click', (e) => { const d = document.querySelector('.me-menu[open]'); if (d && (!d.contains(e.target) || e.target.closest('a'))) d.open = false; });

// 標誌動畫每次開啟網站只播一次
function firstVisit() {
  try { if (sessionStorage.getItem('hx-written')) return false; sessionStorage.setItem('hx-written', '1'); } catch { }
  return true;
}

function shell() {
  const p = state.p;
  const menu = MENU.filter((n) => !n.show || n.show(p));
  const groups = [...new Set(menu.map((n) => n.group))];
  const name = state.settings.team_name || '華夏國樂社';
  document.title = name;
  const animate = firstVisit();
  const tab = (t) => `<a href="#${t.path}" data-tab="${t.path}">${icon(t.icon)}<span>${t.label}</span>${t.badge ? `<i class="badge" data-b="${t.badge}" hidden></i>` : ''}</a>`;
  $('#app').innerHTML = `
    <header class="top"><div class="top-in">
      <a class="brand" href="#/" aria-label="${esc(name)} 首頁"><img class="logo" src="img/logo-192.png" alt="" width="34" height="34"><span class="brand-t">${esc(name)}</span></a>
      <nav class="tabs" aria-label="主選單">${TABS.map(tab).join('')}</nav>
      <details class="me-menu"><summary aria-label="我的選單">${avatar(me(), 32)}</summary>
        <div class="me-sheet"><div class="me-who">${avatar(me(), 40)}<div><b>${esc(nameOf(me()))}</b><span class="small muted">${esc(mySecs().join('・'))}${state.profile?.officer_title ? `・${esc(state.profile.officer_title)}` : ''}</span></div></div>
        ${groups.map((g) => `<div class="me-g"><span>${g}</span>${menu.filter((n) => n.group === g).map((n) => `<a href="#${n.path}" data-nav="${n.path}">${n.label}</a>`).join('')}</div>`).join('')}
        ${DEMO ? `<div class="me-g demo-as"><span>示範：用誰的身分看</span>${Object.entries(DEMO_ROLES).map(([k, r]) => `<button data-demo-as="${k}" aria-pressed="${demoAs() === k}">${r.label}</button>`).join('')}</div>` : ''}
        <button class="me-out" id="sign-out">登出</button></div></details>
    </div></header>
    <main id="main" tabindex="-1"></main>
    <nav class="bottom" aria-label="主選單">${TABS.map(tab).join('')}</nav>
    ${DEMO ? `<div class="demo-flag">示範模式・${esc(DEMO_ROLES[demoAs()]?.label || '')}</div>` : ''}`;
  $('#sign-out').onclick = () => sb.auth.signOut();
  $$('[data-demo-as]').forEach((b) => (b.onclick = () => { try { sessionStorage.setItem('demo-as', b.dataset.demoAs); } catch { } location.hash = '#/'; location.reload(); }));
}

async function refreshUnread() {
  const [{ data: anns }, { data: reads }] = await Promise.all([
    sb.from('announcements').select('id').not('channel', 'in', `(${SHARE_CATS.join(',')})`).limit(100), sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
  ]);
  const r = new Set((reads || []).map((x) => x.ann_id));
  const counts = { main: (anns || []).filter((a) => !r.has(a.id)).length };
  $$('.badge').forEach((b) => { const n = counts[b.dataset.b] || 0; b.hidden = !n; b.textContent = n > 9 ? '9+' : n; });
}

document.addEventListener('routed', (e) => {
  const path = e.detail; const cur = tabOf(path)?.path;
  $$('[data-tab]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === cur));
  $$('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', path.startsWith(a.dataset.nav)));
  $('.me-menu')?.classList.toggle('on', !cur);
  window.scrollTo(0, 0);
});
document.addEventListener('unread-changed', () => refreshUnread());

// ---------- 登入畫面 ----------
const DISCORD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5.5A16 16 0 0 0 15 4.3l-.5 1a15 15 0 0 0-5 0l-.5-1A16 16 0 0 0 5 5.5C2.5 9.3 1.8 13 2.1 16.6A16 16 0 0 0 7 19l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.5 11.5 0 0 0 10.4 0l.4.3-1.6.8 1 1.6a16 16 0 0 0 4.9-2.4c.4-4.2-.6-7.9-2.9-11.1zM9 14.5c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2zm6 0c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2z"/></svg>';
function authHead(animate) {
  return `<div class="auth-logo ${animate ? 'in' : ''}"><img src="img/logo-320.png" alt="華夏國樂社" width="140" height="140"></div>`;
}
// 社員用 Discord 登入；Email 登入／註冊只給指導老師、校外槍手（和還沒連結 Discord 的舊帳號）
function authScreen(mode = 'login', animate = true) {
  const email = mode === 'email' || mode === 'signup', signup = mode === 'signup';
  $('#app').innerHTML = `<div class="auth"><div class="auth-card">
    ${authHead(animate)}
    <p class="auth-sub">練習・出席・曲目・樂譜</p>
    <div class="auth-box">
      ${authError ? `<p class="auth-err" role="alert">${esc(authError)}</p>` : ''}
      <button class="btn discord" id="discord">${DISCORD_SVG}使用 Discord 登入</button>
      ${email ? `<div class="or"><span>${signup ? '用 Email 註冊' : '用 Email 登入'}（限指導老師、校外槍手）</span></div>
      <form id="auth-form" class="auth-form">
        ${signup ? '<label>姓名<input name="name" required maxlength="40" autocomplete="name"></label>' : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>密碼<input name="pw" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        <button class="btn pri">${signup ? '註冊' : '登入'}</button>
      </form>
      <button class="link" id="switch">${signup ? '已經有帳號？用 Email 登入' : '還沒有帳號？用 Email 註冊'}</button>`
      : '<button class="link small" id="to-email">使用 Email 登入（限指導老師、校外槍手，社員請用 Discord 登入）</button>'}
    </div>
    <p class="small muted">註冊後需要管理員核准。</p>
  </div></div>`;
  $('#discord').onclick = () => sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname } }).then((r) => r.error && toast(errText(r.error), 'bad'));
  $('#to-email')?.addEventListener('click', () => authScreen('email', false));
  $('#switch')?.addEventListener('click', () => authScreen(signup ? 'email' : 'signup', false));
  $('#auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector('button'); b.disabled = true;
    const r = signup
      ? await sb.auth.signUp({ email: f.get('email'), password: f.get('pw'), options: { data: { full_name: f.get('name') } } })
      : await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('pw') });
    b.disabled = false;
    if (r.error) {
      const m = r.error.message;
      return toast(/Invalid login/i.test(m) ? 'Email 或密碼錯誤。' : /already/i.test(m) ? '這個 Email 已經註冊過，請直接登入。' : errText(r.error), 'bad');
    }
    if (!r.data.session) toast('請到信箱點確認信後再登入。');
  });
}

function waitingScreen() {
  const inactive = state.profile?.status === 'inactive';
  const u = state.profile || {};
  // 等待核准時先填基本資料：管理員核准前就認得出是誰
  $('#app').innerHTML = `<div class="auth${inactive ? '' : ' join'}"><div class="auth-card">${authHead(false)}
    <h1>${inactive ? '帳號已停用' : '已送出加入申請'}</h1>
    <p class="muted">${inactive ? '如果這是誤會，請聯絡社長或管理員。' : '管理員核准後就能使用。先填一下你的名字和資料，幹部比較認得出你。'}</p>
    ${inactive ? '' : `<form id="wait-form" class="auth-box auth-form">
      <label>顯示名稱（大家在網站上看到的名字）<input name="display_name" required maxlength="40" value="${esc(u.display_name || '')}"></label>
      <label>本名<input name="real_name" maxlength="40" value="${esc(u.real_name || '')}" placeholder="例：王小明"></label>
      <label>系級<input name="grade" maxlength="40" value="${esc(u.grade || '')}" placeholder="例：金融一"></label>
      <label>樂器<input name="instruments" maxlength="60" value="${esc(u.instruments || '')}" placeholder="例：二胡、琵琶；還沒學過也可以寫想學的"></label>
      <label>學校（外校才填）<input name="school" maxlength="40" value="${esc(u.school || '')}"></label>
      <label>手機（只有幹部看得到）<input name="phone" maxlength="30" inputmode="tel"></label>
      <label>自我介紹（選填）<textarea name="bio" rows="3" maxlength="500">${esc(u.bio || '')}</textarea></label>
      <button class="btn pri">儲存</button>
    </form>`}
    <div class="row"><button class="btn" onclick="location.reload()">重新整理</button><button class="btn ghost" id="out">登出</button></div></div></div>`;
  $('#out').onclick = () => sb.auth.signOut();
  const f = $('#wait-form');
  if (!f) return;
  sb.from('profile_private').select('phone').eq('user_id', me()).maybeSingle().then(({ data }) => { if (data?.phone) f.phone.value = data.phone; });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    if (!v.display_name.trim()) return toast('請填顯示名稱', 'bad');
    const row = { display_name: v.display_name.trim(), real_name: v.real_name.trim(), grade: v.grade.trim(), instruments: v.instruments.trim(), school: v.school.trim(), bio: v.bio.trim() };
    const a = await sb.from('profiles').update(row).eq('id', me());
    const b = await sb.from('profile_private').update({ phone: v.phone.trim() }).eq('user_id', me());
    if (a.error || b.error) return toast(errText(a.error || b.error), 'bad');
    state.profile = { ...state.profile, ...row };
    toast('已儲存，管理員核准時看得到', 'ok');
  };
}

function setupScreen() {
  $('#app').innerHTML = `<div class="auth"><div class="auth-card">${authHead(false)}<h1>還差一步：連接資料庫</h1>
    <p class="muted">請依照 <code>docs/SETUP.md</code> 建立 Supabase 專案，並把網址與 publishable key 填進 <code>config.js</code>。</p></div></div>`;
}

// ---------- 啟動 ----------
const isJoin = () => location.hash.startsWith('#/join');
async function boot() {
  if (isJoin()) return joinScreen();
  if (!state.session) {
    const { data } = await sb.from('settings').select('*').eq('key', 'team_name').maybeSingle();
    if (data) state.settings.team_name = data.value;
    // 記住原本要去的頁面（例如 Discord「確定會去」按鈕），登入後再帶回去
    if (/^#\/\w/.test(location.hash)) try { sessionStorage.setItem('afterLogin', location.hash); } catch {}
    return authScreen('login', firstVisit());
  }
  try { const to = sessionStorage.getItem('afterLogin'); if (to) { sessionStorage.removeItem('afterLogin'); history.replaceState(null, '', to); } } catch {}
  await loadMe();
  if (!state.profile || state.profile.status !== 'active') return waitingScreen();
  await loadShared();
  shell();
  await render();
  refreshUnread();
}

(async () => {
  try {
    if (!(await connect())) return setupScreen();
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    sb.auth.onAuthStateChange((_e, s) => {
      const before = state.session?.user?.id, after = s?.user?.id;
      state.session = s;
      if (before !== after) boot();
    });
    window.addEventListener('hashchange', () => { if (isJoin()) return joinScreen(); if (!$('#main')) return boot(); if (state.profile?.status === 'active') render(); });
    await boot();
    if (linkError) toast(linkError, 'bad');
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="auth"><div class="auth-card"><h1>載入失敗</h1><p class="muted">${esc(errText(e))}</p><button class="btn" onclick="location.reload()">重新整理</button></div></div>`;
  }
})();
