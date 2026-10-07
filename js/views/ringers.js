import { sb, state, route, esc, run, formDialog, pageHead, empty, chipPerson, activePeople, nameOf, render, $, $$ } from '../core.js';

const ST = { contacting: '洽詢中', accepted: '已答應', declined: '婉拒' };

async function edit(r = null) {
  const people = activePeople().map((p) => [p.id, nameOf(p.id)]);
  const ringerAccounts = activePeople().filter((p) => p.roles.includes('ringer')).map((p) => [p.id, nameOf(p.id)]);
  const v = await formDialog({
    title: r ? '編輯槍手' : '新增槍手', danger: r ? '刪除' : null,
    fields: [
      { name: 'name', label: '姓名', required: true, value: r?.name },
      { name: 'school', label: '學校', value: r?.school, placeholder: '例：師大、北科' },
      { name: 'instruments', label: '樂器', value: r?.instruments, placeholder: '例：中阮、柳琴' },
      { name: 'status', label: '狀態', type: 'select', value: r?.status || 'contacting', options: Object.entries(ST) },
      { name: 'contact_user_id', label: '負責聯絡的社員', type: 'select', value: r?.contact_user_id || '', options: [['', '（未指定）'], ...people] },
      { name: 'contact_info', label: '聯絡方式', value: r?.contact_info, placeholder: 'IG、LINE ID…' },
      { name: 'user_id', label: '對應的網站帳號', type: 'select', value: r?.user_id || '', options: [['', '（尚未註冊）'], ...ringerAccounts], hint: '槍手註冊並被核准為「槍手」後，在這裡連結，他就能看到自己的曲目與樂譜' },
      { name: 'note', label: '備註', type: 'textarea', value: r?.note, full: true, placeholder: '例：他愛吃牛肉麵、公演那天才有空' },
    ],
  });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('ringers').delete().eq('id', r.id), '已刪除'); return render(); }
  const row = { ...v, contact_user_id: v.contact_user_id || null, user_id: v.user_id || null };
  await run(() => r ? sb.from('ringers').update(row).eq('id', r.id) : sb.from('ringers').insert(row), '已儲存');
  render();
}

route('/ringers', async () => {
  if (!state.p.officer) return empty('只有幹部可以管理槍手');
  const [{ data }, { data: asg }, { data: parts }] = await Promise.all([
    sb.from('ringers').select('*').order('created_at'),
    sb.from('part_assignments').select('*').not('ringer_id', 'is', null),
    sb.from('piece_parts').select('id, name, pieces(title)'),
  ]);
  const { data: asgUser } = await sb.from('part_assignments').select('*').not('user_id', 'is', null);
  const partsOf = (r) => [...(asg || []).filter((a) => a.ringer_id === r.id), ...(r.user_id ? (asgUser || []).filter((a) => a.user_id === r.user_id) : [])]
    .map((a) => (parts || []).find((p) => p.id === a.part_id)).filter(Boolean).map((p) => `${p.pieces?.title}・${p.name}`);
  const f = sessionStorage.getItem('rf') || '';
  const list = (data || []).filter((r) => !f || r.status === f);
  setTimeout(() => {
    $('#add-ringer')?.addEventListener('click', () => edit());
    $$('[data-ringer]').forEach((el) => (el.onclick = () => edit(data.find((x) => x.id === el.dataset.ringer))));
    $$('[data-rf]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('rf', b.dataset.rf); render(); }));
  });
  const n = (s) => (data || []).filter((r) => r.status === s).length;
  return pageHead('槍手', '外校來支援演出的人。答應之後到「曲目」的編制裡排進聲部。', '<button class="btn pri" id="add-ringer">＋ 新增槍手</button>') +
    `<div class="seg"><button data-rf="" aria-pressed="${!f}">全部 ${data?.length || 0}</button>${Object.entries(ST).map(([k, l]) => `<button data-rf="${k}" aria-pressed="${f === k}">${l} ${n(k)}</button>`).join('')}</div>` +
    (list.length ? `<div class="tbl-wrap"><table class="click"><thead><tr><th>姓名</th><th>學校</th><th>樂器</th><th>狀態</th><th>負責聯絡</th><th>排到的聲部</th><th>帳號</th></tr></thead><tbody>
      ${list.map((r) => `<tr data-ringer="${r.id}"><td><b>${esc(r.name)}</b>${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${esc(r.school)}</td><td>${esc(r.instruments)}</td>
        <td><span class="chip st-${r.status}">${ST[r.status]}</span></td><td>${r.contact_user_id ? chipPerson(r.contact_user_id) : '<span class="muted">—</span>'}</td>
        <td class="small">${partsOf(r).map(esc).join('<br>') || '<span class="muted">—</span>'}</td><td>${r.user_id ? '<span class="chip ok">已連結</span>' : '<span class="muted small">未註冊</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : empty('還沒有槍手名單', '把可以找的外校朋友加進來，記下誰負責聯絡、目前狀態。'));
});
