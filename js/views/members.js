import { secsOf, leadSecsOf } from '../core.js';
import { sb, state, me, route, esc, run, toast, formDialog, pageHead, empty, avatar, nameOf, sectionChip, roleChips, render, $, $$, loadShared } from '../core.js';
import { SECTIONS, ROLE_LABEL } from '../logic.js';
import { invokeFn } from './events.js';

async function editMember(u, priv) {
  const p = state.p;
  // 自我介紹沒有放進共用名冊（太長），點開時才讀
  const bio = (await sb.from('profiles').select('bio').eq('id', u.id).maybeSingle()).data?.bio || '';
  const fields = [
    { type: 'info', empty: '他還沒填「我的資料」', rows: [['系級', u.grade], ['學校', u.school], ['手機', priv?.phone], ['Email', priv?.email], ['Google 帳號', priv?.google_email], ['自我介紹', bio]] },
    { name: 'display_name', label: '顯示名稱', value: u.display_name },
    { name: 'real_name', label: '本名', value: u.real_name },
    { name: 'sections', label: '組別（可複選）', type: 'checks', full: true, value: secsOf(u), options: SECTIONS.map((s) => [s, s]), hint: '同時在兩組就都勾，例如彈撥＋打擊' },
    { name: 'instruments', label: '樂器', value: u.instruments, placeholder: '例：二胡／中胡' },
  ];
  if (p.admin) fields.push(
    { name: 'roles', label: '身分組', type: 'checks', full: true, value: u.roles, options: Object.entries(ROLE_LABEL), hint: '可以多選。' },
    { name: 'leads', label: '組長負責的組別', type: 'checks', full: true, value: u.leads || [], options: SECTIONS.map((s) => [s, s]), hint: '有勾「組長」身分才有用。都不勾＝負責他所在的組別；例如同時在彈撥、打擊，但只當打擊組長，就只勾打擊。' },
    { name: 'officer_title', label: '幹部職位', value: u.officer_title, placeholder: '例：副社、總務、公關、器材、文書、教學' },
    { name: 'status', label: '帳號狀態', type: 'select', value: u.status, options: [['active', '啟用'], ['pending', '待核准'], ['inactive', '停用（已離團或畢業）']] },
  );
  const v = await formDialog({ title: nameOf(u.id), fields });
  if (!v) return;
  const sections = SECTIONS.filter((s) => v.sections.includes(s));
  const row = { display_name: v.display_name, real_name: v.real_name, sections, section: sections[0] || null, instruments: v.instruments };
  if (p.admin) Object.assign(row, { officer_title: v.officer_title, status: v.status, leads: SECTIONS.filter((s) => v.leads.includes(s)) });
  const ok = await run(() => sb.from('profiles').update(row).eq('id', u.id));
  if (!ok) return;
  if (p.admin) {
    const add = v.roles.filter((r) => !u.roles.includes(r)), del = u.roles.filter((r) => !v.roles.includes(r));
    if (add.length) await run(() => sb.from('user_roles').insert(add.map((r) => ({ user_id: u.id, role: r }))));
    for (const r of del) await run(() => sb.from('user_roles').delete().eq('user_id', u.id).eq('role', r));
    if (add.concat(del).some((r) => r === 'officer' || r === 'admin')) {
      await invokeFn('calendar-sync', { action: 'acl' }).catch(() => toast('身分已更新；幹部行事曆權限稍後請到設定頁重新同步', 'bad'));
    }
  }
  toast('已儲存', 'ok');
  await loadShared(); render();
}

async function approve(u, roles) {
  const ok = await run(() => sb.from('profiles').update({ status: 'active' }).eq('id', u.id));
  if (!ok) return;
  await run(() => sb.from('user_roles').insert(roles.map((r) => ({ user_id: u.id, role: r }))), '已核准');
  await loadShared(); render();
}

// 批次設定：一次選多人，加上或移除同樣的身分組（待核准的人一起核准）
const sel = new Set();
async function batchRoles(people) {
  const chosen = people.filter((u) => sel.has(u.id));
  if (!chosen.length) return toast('先勾選要設定的人', 'bad');
  const v = await formDialog({ title: `批次設定 ${chosen.length} 人`, submit: '套用', fields: [
    { name: 'mode', label: '動作', type: 'select', value: 'add', options: [['add', '加上這些身分組'], ['del', '移除這些身分組']] },
    { name: 'roles', label: '身分組', type: 'checks', full: true, value: [], options: Object.entries(ROLE_LABEL), hint: '原本有的其他身分組不會動。選到「待核准」的人，加上身分時會一起核准。' },
  ] });
  if (!v) return;
  if (!v.roles.length) return toast('至少選一個身分組', 'bad');
  const ids = chosen.map((u) => u.id);
  let ok = true;
  if (v.mode === 'add') {
    const rows = chosen.flatMap((u) => v.roles.filter((r) => !u.roles.includes(r)).map((r) => ({ user_id: u.id, role: r })));
    if (rows.length) ok = await run(() => sb.from('user_roles').insert(rows));
    const pend = chosen.filter((u) => u.status === 'pending').map((u) => u.id);
    if (ok && pend.length) ok = await run(() => sb.from('profiles').update({ status: 'active' }).in('id', pend));
  } else {
    for (const r of v.roles) if (ok) ok = await run(() => sb.from('user_roles').delete().in('user_id', ids).eq('role', r));
  }
  if (!ok) { await loadShared(); return render(); }
  if (v.roles.some((r) => r === 'officer' || r === 'admin')) {
    await invokeFn('calendar-sync', { action: 'acl' }).catch(() => toast('身分已更新；幹部行事曆權限稍後請到設定頁重新同步', 'bad'));
  }
  toast(`已更新 ${chosen.length} 人`, 'ok');
  sel.clear(); sessionStorage.setItem('mb', '0');
  await loadShared(); render();
}

route('/members', async () => {
  const p = state.p;
  if (!p.insider) return empty('只有社內成員可以看名冊');
  const people = [...state.people.values()];
  const priv = p.officer ? (await sb.from('profile_private').select('*')).data || [] : [];
  const privOf = (id) => priv.find((x) => x.user_id === id);
  const pending = people.filter((u) => u.status === 'pending');
  const f = sessionStorage.getItem('mf') || '';
  const showInactive = sessionStorage.getItem('mi') === '1';
  const batch = p.admin && sessionStorage.getItem('mb') === '1';
  if (!batch) sel.clear();
  const box = (id) => batch ? `<input type="checkbox" class="pick" data-pick="${id}" ${sel.has(id) ? 'checked' : ''} aria-label="選取">` : '';
  const list = people.filter((u) => u.status === 'active' || (showInactive && u.status === 'inactive'))
    .filter((u) => !f || (f === 'ringer' || f === 'alumni' ? u.roles.includes(f) : f === 'officer' ? u.roles.some((r) => r === 'officer' || r === 'admin') : secsOf(u).includes(f)))
    .sort((a, b) => SECTIONS.indexOf(secsOf(a)[0]) - SECTIONS.indexOf(secsOf(b)[0]) || nameOf(a.id).localeCompare(nameOf(b.id)));
  setTimeout(() => {
    $$('[data-mf]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('mf', b.dataset.mf); render(); }));
    $('#mi')?.addEventListener('click', () => { sessionStorage.setItem('mi', showInactive ? '0' : '1'); render(); });
    $$('[data-approve]').forEach((b) => (b.onclick = () => approve(people.find((u) => u.id === b.dataset.approve), b.dataset.roles.split(','))));
    $$('[data-info]').forEach((b) => (b.onclick = () => { const u = people.find((x) => x.id === b.dataset.info); editMember(u, privOf(u.id)); }));
    $$('[data-reject]').forEach((b) => (b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = '確定拒絕？'; return; }
      await run(() => sb.from('profiles').update({ status: 'inactive' }).eq('id', b.dataset.reject), '已拒絕'); await loadShared(); render();
    }));
    $('#mb')?.addEventListener('click', () => { sessionStorage.setItem('mb', batch ? '0' : '1'); render(); });
    const count = () => { const n = $('#sel-n'); if (n) n.textContent = sel.size; };
    $$('[data-pick]').forEach((c) => { c.onclick = (e) => e.stopPropagation(); c.onchange = () => { c.checked ? sel.add(c.dataset.pick) : sel.delete(c.dataset.pick); count(); }; });
    $('#sel-all')?.addEventListener('click', () => { const cs = $$('[data-pick]'); const all = cs.every((c) => c.checked); cs.forEach((c) => { c.checked = !all; c.checked ? sel.add(c.dataset.pick) : sel.delete(c.dataset.pick); }); count(); });
    $('#sel-apply')?.addEventListener('click', () => batchRoles(people));
    if (batch) $$('[data-member]').forEach((tr) => (tr.onclick = () => { const c = tr.querySelector('[data-pick]'); c.checked = !c.checked; c.onchange(); }));
    else if (p.officer) $$('[data-member]').forEach((tr) => (tr.onclick = () => { const u = people.find((x) => x.id === tr.dataset.member); editMember(u, privOf(u.id)); }));
  });
  return pageHead('成員', `${list.length} 人${p.officer ? '・點一列可以看手機、自我介紹，並編輯組別、樂器' + (p.admin ? '與身分組' : '') : ''}`,
    p.admin ? `<button class="btn ${batch ? 'pri' : 'line'} sm" id="mb">${batch ? '結束批次' : '批次設定身分'}</button><button class="btn ghost sm" id="mi">${showInactive ? '隱藏停用帳號' : '顯示停用帳號'}</button>` : '') +
    (batch ? `<div class="batch-bar"><span>已選 <b id="sel-n" class="mono">${sel.size}</b> 人</span><button class="btn sm ghost" id="sel-all">全選／取消</button><button class="btn sm pri" id="sel-apply">設定身分組</button></div>` : '') +
    (p.admin && pending.length ? `<section class="card pending"><h2>等待核准 <span class="dot-n">${pending.length}</span></h2>
      ${pending.map((u) => `<div class="pend-row"><div class="who">${box(u.id)}${avatar(u.id, 32)}<div><b>${esc(nameOf(u.id))}</b><span class="small muted">${esc([u.grade, privOf(u.id)?.email].filter(Boolean).join('・'))}</span></div></div>
        <div class="actions"><button class="btn sm ghost" data-info="${u.id}">看資料</button><button class="btn sm pri" data-approve="${u.id}" data-roles="member">核准為社員</button><button class="btn sm" data-approve="${u.id}" data-roles="member,newbie">新生</button><button class="btn sm" data-approve="${u.id}" data-roles="ringer">槍手</button><button class="btn sm" data-approve="${u.id}" data-roles="alumni">校友</button><button class="btn sm" data-approve="${u.id}" data-roles="teacher">指導老師</button><button class="btn sm ghost danger" data-reject="${u.id}">拒絕</button></div></div>`).join('')}
    </section>` : '') +
    `<div class="seg wrap"><button data-mf="" aria-pressed="${!f}">全部</button>${SECTIONS.map((s) => `<button data-mf="${s}" aria-pressed="${f === s}">${s}</button>`).join('')}<button data-mf="officer" aria-pressed="${f === 'officer'}">幹部</button><button data-mf="ringer" aria-pressed="${f === 'ringer'}">槍手</button><button data-mf="alumni" aria-pressed="${f === 'alumni'}">校友</button></div>` +
    (list.length ? `<div class="tbl-wrap"><table class="${p.officer || batch ? 'click' : ''}"><thead><tr><th>成員</th><th>組別</th><th>樂器</th><th>身分</th>${p.officer ? '<th>Email</th>' : ''}</tr></thead><tbody>
      ${list.map((u) => `<tr data-member="${u.id}" class="${u.status === 'inactive' ? 'inactive' : ''}"><td><span class="person">${box(u.id)}${avatar(u.id, 24)}<b>${esc(nameOf(u.id))}</b>${u.real_name && u.real_name !== u.display_name ? `<span class="muted small">${esc(u.real_name)}</span>` : ''}</span></td>
        <td><div class="chips">${secsOf(u).map(sectionChip).join('')}</div></td><td class="small">${esc(u.instruments)}</td><td><div class="chips">${roleChips(u.roles)}${u.roles.includes('leader') ? `<span class="muted small">（${leadSecsOf(u).join('、') || '未分組'}）</span>` : ''}${u.officer_title ? `<span class="chip gold">${esc(u.officer_title)}</span>` : ''}</div></td>
        ${p.officer ? `<td class="small muted">${esc(privOf(u.id)?.email || '')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : empty('這個分類沒有成員'));
});
