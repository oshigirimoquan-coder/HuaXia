import { sb, state, route, esc, run, toast, formDialog, pageHead, empty, render, $, $$, loadShared } from '../core.js';
import { SECTIONS, toCSV, backupDue, twParts, ROLE_LABEL } from '../logic.js';
import { invokeFn } from './events.js';

const CH_LABEL = { performance: '華夏演出', tutti: '大團', sizhu: '絲竹', class: '教學班', alumni: '校友團', concerts: '音樂會', resources: '資源' };
// 備份：所有資料表（不含 Discord webhook 等私密設定）
const BACKUP_TABLES = ['profiles', 'profile_private', 'user_roles', 'semesters', 'settings', 'calendars', 'pieces', 'piece_parts',
  'ringers', 'part_assignments', 'scores', 'seating_charts', 'classes', 'class_students', 'class_milestones', 'class_progress', 'events', 'event_pieces',
  'leave_requests', 'attendance', 'announcements', 'tasks', 'resources', 'practice_reports', 'report_feedback', 'applications', 'ensemble_members'];
async function fetchAll(t) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(t).select('*').range(from, from + 999);
    if (error) throw new Error(`${t}：${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function backup(btn) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = '匯出中…';
  try {
    const data = {};
    for (const t of BACKUP_TABLES) data[t] = await fetchAll(t);
    const day = twParts(new Date()).date.replace(/-/g, '');
    download(`華夏備份-${day}.json`, JSON.stringify({ exported_at: new Date().toISOString(), tables: data }), 'application/json');
    const name = (id) => { const p = data.profiles.find((x) => x.id === id); return p ? (p.real_name || p.display_name) : ''; };
    if (state.semester) {
      const { data: st } = await sb.rpc('attendance_stats', { sem: state.semester.id });
      download(`華夏出席率-${state.semester.name}-${day}.csv`, toCSV([['姓名', '組別', '目前出席率%', '整學期出席率%', '出席', '晚到', '早退', '請假', '缺席'],
        ...(st || []).map((r) => [name(r.user_id), data.profiles.find((x) => x.id === r.user_id)?.section, r.current_rate, r.total_rate, r.present, r.late, r.early, r.excused, r.absent])]), 'text/csv');
    }
    download(`華夏名冊-${day}.csv`, toCSV([['姓名', '顯示名稱', '組別', '樂器', '身分組', '幹部職位', '狀態'],
      ...data.profiles.map((p) => [p.real_name, p.display_name, p.section, p.instruments, data.user_roles.filter((r) => r.user_id === p.id).map((r) => ROLE_LABEL[r.role]), p.officer_title, { active: '啟用', pending: '待核准', inactive: '停用' }[p.status]])]), 'text/csv');
    await sb.from('settings').upsert({ key: 'last_backup_at', value: new Date().toISOString() });
    await loadShared(); toast('已下載備份，請存到雲端硬碟', 'ok'); render();
  } catch (e) { toast('備份失敗：' + e.message, 'bad'); btn.disabled = false; btn.textContent = old; }
}

const setVal = (key, value) => run(() => sb.from('settings').upsert({ key, value }));

route('/settings', async () => {
  if (!state.p.admin) return empty('只有管理員可以進入設定');
  const { data: pd } = await sb.from('private_settings').select('*').eq('key', 'discord').maybeSingle();
  const hooks = pd?.value || {};
  const rules = state.settings.attendance_rules || {};

  setTimeout(() => {
    $('#team')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const v = $('#team-name').value.trim(); if (!v) return;
      if (await setVal('team_name', v)) { toast('已更新', 'ok'); await loadShared(); render(); }
    });
    $('#add-sem')?.addEventListener('click', async () => {
      const v = await formDialog({ title: '新增學期', fields: [
        { name: 'name', label: '名稱', required: true, placeholder: '例：114-2' },
        { name: 'starts_on', label: '開始', type: 'date', required: true },
        { name: 'ends_on', label: '結束', type: 'date', required: true },
        { name: 'current', label: '目前學期', type: 'toggle', text: '設為目前學期（舊學期自動封存）', value: true },
      ] });
      if (!v) return;
      if (v.current) await sb.from('semesters').update({ is_current: false }).eq('is_current', true);
      await run(() => sb.from('semesters').insert({ name: v.name, starts_on: v.starts_on, ends_on: v.ends_on, is_current: v.current }), '已新增學期');
      await loadShared(); render();
    });
    $$('[data-cur]').forEach((b) => (b.onclick = async () => {
      await sb.from('semesters').update({ is_current: false }).eq('is_current', true);
      await run(() => sb.from('semesters').update({ is_current: true }).eq('id', b.dataset.cur), '已切換目前學期');
      await loadShared(); render();
    }));
    $('#rules')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      const v = { late_weight: Number(f.get('late')), early_weight: Number(f.get('early')), unexcused_weight: Number(f.get('unexcused')), excused_mode: f.get('excused'), count_ringers: f.get('ringers') === 'on' };
      if (await setVal('attendance_rules', v)) { toast('出席規則已更新', 'ok'); await loadShared(); }
    });
    $('#notify')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      const value = { announce: f.get('announce').trim(), officers: f.get('officers').trim(), sections: Object.fromEntries(SECTIONS.map((s) => [s, f.get('s-' + s).trim()]).filter(([, u]) => u)),
        channels: Object.fromEntries(Object.keys(CH_LABEL).map((k) => [k, f.get('c-' + k).trim()]).filter(([, u]) => u)),
        roles: Object.fromEntries([['sizhu', f.get('r-sizhu').trim()]].filter(([, u]) => u)) };
      if (value.roles.sizhu && !/^\d{15,22}$/.test(value.roles.sizhu)) return toast('身分組 ID 應該是一串 17～20 位數字', 'bad');
      const bad = [value.announce, value.officers, ...Object.values(value.sections), ...Object.values(value.channels)].filter((u) => u && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(u));
      if (bad.length) return toast('Webhook 網址格式不對，應以 https://discord.com/api/webhooks/ 開頭', 'bad');
      const a = await run(() => sb.from('private_settings').upsert({ key: 'discord', value }));
      const b = await setVal('notify', { channel: 'discord' });
      if (a && b) { toast('通知設定已儲存', 'ok'); await loadShared(); }
    });
    $('#cal-setup')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = '建立中…';
      try { const r = await invokeFn('calendar-sync', { action: 'setup' }); toast(`已建立 ${r?.calendars?.length ?? ''} 本行事曆`, 'ok'); await loadShared(); render(); }
      catch (err) { toast('建立失敗：' + err.message, 'bad'); e.target.disabled = false; e.target.textContent = '建立／檢查行事曆'; }
    });
    $('#backup')?.addEventListener('click', (e) => backup(e.currentTarget));
    $('#cal-acl')?.addEventListener('click', async () => {
      try { const r = await invokeFn('calendar-sync', { action: 'acl' }); toast(`幹部行事曆已分享給 ${r?.readers ?? 0} 個信箱`, 'ok'); }
      catch (err) { toast('同步失敗：' + err.message, 'bad'); }
    });
  });

  return pageHead('設定', '只有管理員看得到這一頁。') +
    `<div class="settings">
    <section class="card"><h2>團隊名稱</h2>
      <form id="team" class="inline-form"><input id="team-name" value="${esc(state.settings.team_name || '')}" aria-label="團隊名稱"><button class="btn">儲存</button></form></section>

    <section class="card"><div class="card-head"><h2>學期</h2><button class="btn sm pri" id="add-sem">＋ 新增學期</button></div>
      <p class="small muted">行程、出席率、教學班都歸屬某個學期。換學期時新增一個並設為目前學期，舊學期資料會保留成紀錄。</p>
      ${state.semesters.length ? `<ul class="sem-list">${state.semesters.map((s) => `<li><b>${esc(s.name)}</b><span class="mono small muted">${s.starts_on} – ${s.ends_on}</span>${s.is_current ? '<span class="chip ok">目前學期</span>' : `<button class="btn sm ghost" data-cur="${s.id}">設為目前</button>`}</li>`).join('')}</ul>` : '<p class="callout">還沒有學期。先新增一個，才能建立行程。</p>'}</section>

    <section class="card"><h2>出席率規則</h2>
      <form id="rules" class="grid-form">
        <label>有事先預告的晚到，算幾次出席<input name="late" type="number" step="0.5" min="0" max="1" value="${rules.late_weight ?? 1}"></label>
        <label>有事先預告的早退，算幾次出席<input name="early" type="number" step="0.5" min="0" max="1" value="${rules.early_weight ?? 1}"></label>
        <label>沒預告的晚到或早退，算幾次出席<input name="unexcused" type="number" step="0.5" min="0" max="1" value="${rules.unexcused_weight ?? 0.5}"></label>
        <label>請假的場次<select name="excused"><option value="absent" ${rules.excused_mode !== 'exclude' ? 'selected' : ''}>算缺席（列入分母）</option><option value="exclude" ${rules.excused_mode === 'exclude' ? 'selected' : ''}>不列入計算</option></select></label>
        <label class="check"><input name="ringers" type="checkbox" ${rules.count_ringers ? 'checked' : ''}><span>槍手也計算出席率</span></label>
        <button class="btn">儲存規則</button>
      </form><p class="small muted">1 = 算一次完整出席，0.5 = 算半次，0 = 不算。「事先預告」指本人在行程頁用請假功能選了晚到或早退。沒排到當天曲目的人自動算無曲，不列入計算。修改後所有人的出席率會立刻重新計算。</p></section>

    <section class="card"><h2>Discord 通知</h2>
      <form id="notify" class="grid-form">
        <label class="full">公告頻道 Webhook<input name="announce" value="${esc(hooks.announce || '')}" placeholder="https://discord.com/api/webhooks/…"></label>
        <label class="full">幹部頻道 Webhook<input name="officers" value="${esc(hooks.officers || '')}" placeholder="https://discord.com/api/webhooks/…"></label>
        <label>絲竹 DC 身分組 ID（選填）<input name="r-sizhu" inputmode="numeric" value="${esc(hooks.roles?.sizhu || '')}" placeholder="填了才會 @全體絲竹成員"></label>
        ${Object.entries(CH_LABEL).map(([k, l]) => `<label>${l}頻道（選填）<input name="c-${k}" value="${esc(hooks.channels?.[k] || '')}" placeholder="沒填就發到公告頻道"></label>`).join('')}
        ${SECTIONS.map((s) => `<label>${s}組頻道（選填）<input name="s-${s}" value="${esc(hooks.sections?.[s] || '')}" placeholder="沒填就發到公告頻道"></label>`).join('')}
        <button class="btn">儲存通知設定</button>
      </form><p class="small muted">Webhook 在 Discord 頻道設定 → 整合 → Webhook 建立。身分組 ID：Discord 開啟「開發者模式」後，在伺服器設定 → 身分組，對絲竹身分組按右鍵 → 複製身分組 ID。這些網址只有管理員看得到。</p></section>

    <section class="card"><h2>Google 行事曆</h2>
      <p class="small muted">第一次設定好 Google 服務帳戶後，按「建立／檢查行事曆」，系統會建立 ${state.calendars.length} 本共用行事曆。之後新增的行程會自動同步。</p>
      <ul class="cal-admin">${state.calendars.map((c) => `<li><span>${esc(c.name)}</span>${c.gcal_id ? '<span class="chip ok">已建立</span>' : '<span class="chip">未建立</span>'}</li>`).join('')}</ul>
      <div class="actions"><button class="btn pri" id="cal-setup">建立／檢查行事曆</button><button class="btn" id="cal-acl">同步幹部行事曆權限</button></div>
      <p class="small muted">幹部行事曆只分享給幹部在「我的設定」填的 Google 信箱。調整幹部名單後會自動同步，也可以手動按上面的按鈕。</p></section>

    <section class="card"><h2>資料備份</h2>
      <p class="small">上次備份：${state.settings.last_backup_at ? `<b>${twParts(state.settings.last_backup_at).date}</b>（${Math.floor((Date.now() - new Date(state.settings.last_backup_at)) / 864e5)} 天前）` : '<b>還沒備份過</b>'}
        ${backupDue(state.settings.last_backup_at, state.semester?.starts_on) ? '<span class="chip bad">該備份了</span>' : ''}</p>
      <p class="small muted">會下載三個檔案：完整資料（.json，出事時可以還原）、出席率與名冊（.csv，Excel 打得開）。請存到社團的雲端硬碟。建議期中、期末各一次；超過 60 天沒備份，首頁會提醒管理員。Discord webhook 等私密設定不會包含在內。</p>
      <button class="btn pri" id="backup">匯出備份</button></section>

    <section class="card"><h2>交接</h2>
      <p class="small">換屆時：新增學期並設為目前學期 → 到「成員」調整幹部與組長身分組 → 把「管理員」交給下一任 → 依 HANDOVER.md 轉移 GitHub、Supabase、Google、Discord 帳號。</p>
      <p class="small muted">系統會阻止移除最後一位管理員，避免交接時沒有人能登入設定。</p></section>
    </div>`;
});
