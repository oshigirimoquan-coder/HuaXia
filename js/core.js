// 核心：連線、登入狀態、共用介面元件、路由
import { perms, twParts, twWeekday, ROLE_LABEL } from './logic.js';

const cfg = window.HUAXIA_CONFIG || {};
export const DEMO = new URLSearchParams(location.search).has('demo') || window.HUAXIA_DEMO === true;

export let sb = null;
export async function connect() {
  if (DEMO) { sb = (await import('./mock.js')).createMock(); return true; }
  if (!cfg.url || !cfg.anonKey) return false;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(cfg.url, cfg.anonKey);
  return true;
}

// ---------- 狀態 ----------
export const state = {
  session: null, profile: null, roles: [], p: perms([]),
  semester: null, semesters: [], settings: {}, calendars: [], people: new Map(), unread: 0,
};

export async function loadMe() {
  const uid = state.session?.user?.id;
  const [{ data: profile }, { data: roles }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('user_roles').select('role').eq('user_id', uid),
  ]);
  state.profile = profile;
  state.roles = (roles || []).map((r) => r.role);
  state.p = perms(state.roles, profile?.status === 'active');
  // 用 Email 登入但綁過 Discord、還沒有頭像的人：自動換成 DC 頭像
  if (profile && !profile.avatar_url) {
    const url = await discordAvatar();
    if (url && !(await sb.from('profiles').update({ avatar_url: url }).eq('id', uid)).error) profile.avatar_url = url;
  }
}

// 已綁定的 Discord 帳號頭像網址；沒有綁就回傳 null
export async function discordAvatar() {
  const ids = (await sb.auth.getUserIdentities?.().catch(() => null))?.data?.identities || [];
  const d = ids.find((i) => i.provider === 'discord');
  return d?.identity_data?.avatar_url || null;
}

export async function loadShared() {
  const [sem, set, cal, people, roles] = await Promise.all([
    sb.from('semesters').select('*').order('starts_on', { ascending: false }),
    sb.from('settings').select('*'),
    sb.from('calendars').select('*').order('sort'),
    sb.from('profiles').select('id, display_name, real_name, section, instruments, avatar_url, status, officer_title, school, grade'),
    sb.from('user_roles').select('*'),
  ]);
  state.semesters = sem.data || [];
  state.semester = state.semesters.find((s) => s.is_current) || state.semesters[0] || null;
  state.settings = Object.fromEntries((set.data || []).map((r) => [r.key, r.value]));
  state.calendars = cal.data || [];
  state.people = new Map((people.data || []).map((p) => [p.id, { ...p, roles: [] }]));
  for (const r of roles.data || []) state.people.get(r.user_id)?.roles.push(r.role);
}

export const me = () => state.session?.user?.id;
export const person = (id) => state.people.get(id);
export const nameOf = (id) => { const p = person(id); return p ? (p.display_name || p.real_name || '成員') : '—'; };
export const activePeople = () => [...state.people.values()].filter((p) => p.status === 'active');

// ---------- 小工具 ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export function fmtDate(iso) { const t = twParts(iso); return `${t.month}/${t.day}（${twWeekday(iso)}）`; }
export function fmtTime(iso) { return twParts(iso).time; }
export function fmtRange(a, b) { return `${fmtDate(a)} ${fmtTime(a)}–${fmtTime(b)}`; }

export function avatar(id, size = 24) {
  const p = person(id); const n = nameOf(id);
  if (p?.avatar_url) return `<img class="av" style="width:${size}px;height:${size}px" src="${esc(p.avatar_url)}" alt="" referrerpolicy="no-referrer">`;
  return `<span class="av av-txt" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px">${esc(n.slice(-2))}</span>`;
}
export const chipPerson = (id, extra = '') => `<span class="person ${extra}">${avatar(id, 20)}${esc(nameOf(id))}</span>`;
export const sectionChip = (s) => s ? `<span class="sec sec-${esc(s)}">${esc(s)}</span>` : '';
export const roleChips = (roles) => roles.filter((r) => r !== 'member').map((r) => `<span class="chip role-${r}">${ROLE_LABEL[r]}</span>`).join('');

// ---------- 通知 ----------
export function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200);
}
export function errText(e) {
  const m = e?.message || String(e || '');
  if (/row-level security|permission|violates/i.test(m)) return '你沒有這個操作的權限。';
  if (/Failed to fetch|NetworkError/i.test(m)) return '連不上伺服器，請檢查網路後再試。';
  if (/duplicate key/i.test(m)) return '這筆資料已經存在。';
  return m || '操作沒有成功，請再試一次。';
}
// 執行一個資料庫動作；失敗就跳出提示並回傳 null
export async function run(fn, ok) {
  try {
    const r = await fn();
    if (r?.error) throw r.error;
    if (ok) toast(ok, 'ok');
    return r ?? true;
  } catch (e) { console.warn(e); toast(errText(e), 'bad'); return null; }
}

// ---------- 表單對話框 ----------
// fields: [{ name, label, type: text|textarea|date|time|number|select|checks|url|email|toggle, options, value, required, hint, full }]
// only：['concerts',...] → 這個欄位只在 switchBy 欄位選到這些值時顯示；onChange(name, value, dialog) 讓頁面依選擇調整其他欄位
export function formDialog({ title, fields, submit = '儲存', danger = null, switchBy = null, onChange = null }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    const field = (f) => {
      const id = `f-${f.name}`; const v = f.value ?? '';
      const req = f.required ? 'required' : '';
      let ctl;
      if (f.type === 'textarea') ctl = `<textarea id="${id}" name="${f.name}" ${req} rows="${f.rows || 4}">${esc(v)}</textarea>`;
      else if (f.type === 'select') ctl = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      else if (f.type === 'checks') ctl = `<div class="checks">${f.options.map(([k, l]) => `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(k)}" ${(v || []).includes(k) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('') || '<span class="muted">沒有可選的項目</span>'}</div>`;
      else if (f.type === 'toggle') ctl = `<label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}><span>${esc(f.text || '')}</span></label>`;
      else ctl = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req} ${f.min != null ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''} placeholder="${esc(f.placeholder || '')}">`;
      return `<div class="field ${f.full ? 'full' : ''}" ${f.only ? `data-only="${f.only.join(' ')}"` : ''}><label for="${id}">${esc(f.label)}</label>${ctl}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
    };
    d.innerHTML = `<form method="dialog" class="dlg-body">
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="關閉">✕</button></header>
      <div class="fields">${fields.map(field).join('')}</div>
      <footer>${danger ? `<button type="button" class="btn danger-ghost" data-danger>${esc(danger)}</button>` : ''}<span class="sp"></span>
        <button type="button" class="btn ghost" data-x>取消</button><button class="btn pri" type="submit">${esc(submit)}</button></footer></form>`;
    document.body.append(d);
    const close = (val) => { d.close(); d.remove(); resolve(val); };
    d.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => close(null)));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    let armed = false;
    d.querySelector('[data-danger]')?.addEventListener('click', (e) => {
      if (!armed) { armed = true; e.target.textContent = `確定${danger}？`; return; }
      close({ __danger: true });
    });
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        if (f.type === 'checks') out[f.name] = [...d.querySelectorAll(`input[name="${f.name}"]:checked`)].map((x) => x.value);
        else if (f.type === 'toggle') out[f.name] = d.querySelector(`[name="${f.name}"]`).checked;
        else { const val = d.querySelector(`[name="${f.name}"]`).value.trim(); out[f.name] = f.type === 'number' ? (val === '' ? null : Number(val)) : val; }
      }
      close(out);
    });
    const sync = () => {
      if (!switchBy) return;
      const cur = d.querySelector(`[name="${switchBy}"]`)?.value;
      d.querySelectorAll('[data-only]').forEach((el) => { el.hidden = !el.dataset.only.split(' ').includes(cur); });
    };
    d.addEventListener('change', (e) => { if (e.target.name) onChange?.(e.target.name, e.target.value, d); sync(); });
    sync();
    d.showModal();
    d.querySelector('input,textarea,select')?.focus();
  });
}

// 兩段式刪除按鈕：第一次按變成「確定？」
export function armDelete(btn, label = '確定刪除？') {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
  return false;
}

// ---------- 路由 ----------
const routes = [];
export function route(pattern, view) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), view }); }
export function go(path) { location.hash = '#' + path; }
export async function render() {
  const path = location.hash.replace(/^#/, '') || '/';
  const main = $('#main');
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    main.setAttribute('aria-busy', 'true');
    try {
      const html = await r.view(m.groups || {}, main);
      if (typeof html === 'string') main.innerHTML = html;
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="empty"><b>這頁載入失敗</b><p>${esc(errText(e))}</p><button class="btn" onclick="location.reload()">重新整理</button></div>`;
    }
    main.removeAttribute('aria-busy');
    document.dispatchEvent(new CustomEvent('routed', { detail: path }));
    return;
  }
  main.innerHTML = `<div class="empty"><b>找不到這一頁</b><p><a href="#/">回首頁</a></p></div>`;
}
export const rerender = () => render();

// 頁面標頭
export function pageHead(title, sub = '', actions = '') {
  return `<header class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</header>`;
}
export const empty = (title, body = '', action = '') => `<div class="empty"><b>${esc(title)}</b>${body ? `<p>${body}</p>` : ''}${action}</div>`;
