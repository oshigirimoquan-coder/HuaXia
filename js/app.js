import { sb, state, connect, loadMe, loadShared, render, esc, $, $$, toast, errText, me, DEMO, avatar, nameOf } from './core.js';
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

const NAV = [
  { path: '/', label: '首頁', icon: 'home', main: true },
  { path: '/events', label: '行程', icon: 'cal', main: true },
  { path: '/pieces', label: '曲目', icon: 'score', main: true },
  { path: '/announcements', label: '公告', icon: 'bell', main: true, badge: true },
  { path: '/attendance', label: '出席', icon: 'check', show: (p) => !p.ringerOnly },
  { path: '/tasks', label: '任務', icon: 'list', show: (p) => !p.ringerOnly },
  { path: '/teaching', label: '教學', icon: 'book', show: (p) => p.insider },
  { path: '/members', label: '成員', icon: 'people', show: (p) => p.insider },
  { path: '/ringers', label: '槍手', icon: 'guest', show: (p) => p.officer },
  { path: '/settings', label: '設定', icon: 'gear', show: (p) => p.admin },
  { path: '/me', label: '我的設定', icon: 'me' },
];
const ICON = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  cal: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  score: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  check: 'M4 12l5 5L20 6',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16',
  people: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5',
  guest: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6M19 4l2 2-2 2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;

function shell() {
  const p = state.p;
  const items = NAV.filter((n) => !n.show || n.show(p));
  const team = esc(state.settings.team_name || '華夏國樂社');
  document.title = state.settings.team_name || '華夏國樂社';
  $('#app').innerHTML = `
    <aside class="side" aria-label="主選單">
      <a class="brand" href="#/"><span class="seal">華</span><span><b>${team}</b><small>${esc(state.semester?.name || '')}</small></span></a>
      <nav>${items.map((n) => `<a href="#${n.path}" data-nav="${n.path}">${svg(n.icon)}<span>${n.label}</span>${n.badge ? '<i class="badge" hidden></i>' : ''}</a>`).join('')}</nav>
      <a class="side-me" href="#/me">${avatar(me(), 28)}<span>${esc(nameOf(me()))}</span></a>
    </aside>
    <header class="topbar"><a class="brand" href="#/"><span class="seal">華</span><b>${team}</b></a><a href="#/me" aria-label="我的設定">${avatar(me(), 30)}</a></header>
    <main id="main" tabindex="-1"></main>
    <nav class="bottom" aria-label="主選單">
      ${items.filter((n) => n.main).map((n) => `<a href="#${n.path}" data-nav="${n.path}">${svg(n.icon)}<span>${n.label}</span>${n.badge ? '<i class="badge" hidden></i>' : ''}</a>`).join('')}
      <button id="more-btn" aria-expanded="false" aria-controls="more">${svg('more')}<span>更多</span></button>
    </nav>
    <div id="more" class="more" hidden><div class="more-sheet">${items.filter((n) => !n.main).map((n) => `<a href="#${n.path}" data-nav="${n.path}">${svg(n.icon)}<span>${n.label}</span></a>`).join('')}</div></div>
    ${DEMO ? '<div class="demo-flag">示範模式・資料為範例</div>' : ''}`;
  const more = $('#more'), btn = $('#more-btn');
  btn.onclick = () => { more.hidden = !more.hidden; btn.setAttribute('aria-expanded', String(!more.hidden)); };
  more.onclick = (e) => { if (e.target === more || e.target.closest('a')) { more.hidden = true; btn.setAttribute('aria-expanded', 'false'); } };
}

async function refreshUnread() {
  const [{ data: anns }, { data: reads }] = await Promise.all([
    sb.from('announcements').select('id').limit(100), sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
  ]);
  const r = new Set((reads || []).map((x) => x.ann_id));
  const n = (anns || []).filter((a) => !r.has(a.id)).length;
  $$('.badge').forEach((b) => { b.hidden = !n; b.textContent = n > 9 ? '9+' : n; });
}

document.addEventListener('routed', (e) => {
  const path = e.detail;
  $$('[data-nav]').forEach((a) => {
    const n = a.dataset.nav;
    a.toggleAttribute('aria-current', n === '/' ? path === '/' : path.startsWith(n));
  });
  window.scrollTo(0, 0);
});
document.addEventListener('unread-changed', () => refreshUnread());

// ---------- 登入畫面 ----------
function authScreen(mode = 'login') {
  const team = esc(state.settings.team_name || '華夏國樂社');
  $('#app').innerHTML = `<div class="auth"><div class="auth-card">
    <div class="auth-mark"><span class="seal big">華</span><div class="pent" aria-hidden="true"><span>宮</span><span>商</span><span>角</span><span>徵</span><span>羽</span></div></div>
    <h1>${team}</h1><p class="muted">練習、出席、曲目、樂譜都在這裡。</p>
    <button class="btn discord" id="discord">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5.5A16 16 0 0 0 15 4.3l-.5 1a15 15 0 0 0-5 0l-.5-1A16 16 0 0 0 5 5.5C2.5 9.3 1.8 13 2.1 16.6A16 16 0 0 0 7 19l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.5 11.5 0 0 0 10.4 0l.4.3-1.6.8 1 1.6a16 16 0 0 0 4.9-2.4c.4-4.2-.6-7.9-2.9-11.1zM9 14.5c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2zm6 0c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2z"/></svg>'}用 Discord 登入</button>
    <div class="or"><span>或用 Email</span></div>
    <form id="auth-form" class="auth-form">
      ${mode === 'signup' ? '<label>姓名<input name="name" required maxlength="40" autocomplete="name"></label>' : ''}
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>密碼<input name="pw" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
      <button class="btn pri">${mode === 'signup' ? '註冊' : '登入'}</button>
    </form>
    <button class="link" id="switch">${mode === 'signup' ? '已經有帳號？登入' : '沒有 Discord？用 Email 註冊'}</button>
    <p class="small muted">外校槍手、指導老師可以用 Email 註冊。註冊後需要管理員核准。</p>
  </div></div>`;
  $('#discord').onclick = () => sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname } }).then((r) => r.error && toast(errText(r.error), 'bad'));
  $('#switch').onclick = () => authScreen(mode === 'signup' ? 'login' : 'signup');
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector('button'); b.disabled = true;
    const r = mode === 'signup'
      ? await sb.auth.signUp({ email: f.get('email'), password: f.get('pw'), options: { data: { full_name: f.get('name') } } })
      : await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('pw') });
    b.disabled = false;
    if (r.error) {
      const m = r.error.message;
      return toast(/Invalid login/i.test(m) ? 'Email 或密碼錯誤。' : /already/i.test(m) ? '這個 Email 已經註冊過，請直接登入。' : errText(r.error), 'bad');
    }
    if (!r.data.session) toast('請到信箱點確認信後再登入。');
  };
}

function waitingScreen() {
  const inactive = state.profile?.status === 'inactive';
  $('#app').innerHTML = `<div class="auth"><div class="auth-card"><span class="seal big">華</span>
    <h1>${inactive ? '帳號已停用' : '已送出加入申請'}</h1>
    <p class="muted">${inactive ? '如果這是誤會，請聯絡社長或管理員。' : `嗨 ${esc(state.profile?.display_name || '')}，管理員核准後就能使用。可以先到 DC 跟幹部說一聲。`}</p>
    <div class="row"><button class="btn" onclick="location.reload()">重新整理</button><button class="btn ghost" id="out">登出</button></div></div></div>`;
  $('#out').onclick = () => sb.auth.signOut();
}

function setupScreen() {
  $('#app').innerHTML = `<div class="auth"><div class="auth-card"><span class="seal big">華</span><h1>還差一步：連接資料庫</h1>
    <p class="muted">請依照 <code>docs/SETUP.md</code> 建立 Supabase 專案，並把網址與 publishable key 填進 <code>config.js</code>。</p>
    <p><a class="btn" href="?demo">先看示範模式</a></p></div></div>`;
}

// ---------- 啟動 ----------
async function boot() {
  if (!state.session) {
    const { data } = await sb.from('settings').select('*').eq('key', 'team_name').maybeSingle();
    if (data) state.settings.team_name = data.value;
    return authScreen();
  }
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
    window.addEventListener('hashchange', () => { if (state.profile?.status === 'active') render(); });
    await boot();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="auth"><div class="auth-card"><h1>載入失敗</h1><p class="muted">${esc(errText(e))}</p><button class="btn" onclick="location.reload()">重新整理</button></div></div>`;
  }
})();
