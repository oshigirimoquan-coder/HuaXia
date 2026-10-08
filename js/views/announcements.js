import { sb, state, me, route, esc, run, formDialog, pageHead, empty, chipPerson, fmtDate, fmtTime, render, $, $$, toast, activePeople, nameOf } from '../core.js';
import { ANN_TYPE, ANN_AUDIENCE, SECTIONS, twParts, twWeekday, twToIso } from '../logic.js';
import { invokeFn, eventCard } from './events.js';

// 頻道：公告（幹部發）、絲竹（幹部發，附絲竹行程）、音樂會（社員都能分享）、校友團（幹部發）
export const CHANNELS = {
  main: { path: '/announcements', title: '公告', sub: '', add: '發布公告' },
  sizhu: { path: '/sizhu', title: '絲竹', sub: '絲竹的排練時間與公告，大家都看得到。', add: '發布絲竹公告' },
  concerts: { path: '/concerts', title: '音樂會', sub: '看到不錯的音樂會、講座或比賽，分享給大家。每個人都能發，只能修改自己發的。', add: '分享音樂會', open: true },
  alumni: { path: '/alumni', title: '校友團', sub: '校友團的演出與活動消息。', add: '發布校友團消息' },
};

export async function sizhuRoster() {
  const { data } = await sb.from('ensemble_members').select('user_id').eq('ensemble', 'sizhu');
  return (data || []).map((r) => r.user_id);
}

let ROSTER = [];
const canEdit = (ch, a) => state.p.officer || (CHANNELS[ch].open && a?.author === me());
const canPost = (ch) => state.p.officer || (CHANNELS[ch].open && state.p.insider);

async function editAnn(ch, a = null) {
  const officer = state.p.officer;
  const fields = [];
  const roster = ch === 'sizhu' ? await sizhuRoster() : [];
  if (ch === 'main') fields.push(
    { name: 'type', label: '類型', type: 'select', value: a?.type || 'practice', options: Object.entries(ANN_TYPE) },
    { name: 'audience', label: '對象', type: 'select', value: a?.audience || 'insiders', options: Object.entries(ANN_AUDIENCE) },
    { name: 'section', label: '組別', type: 'select', value: a?.section || '', options: [['', '（對象選「某一組」時才需要）'], ...SECTIONS.map((s) => [s, s])] },
  );
  const ev = a?.event_at ? twParts(a.event_at) : null;
  fields.push({ name: 'title', label: ch === 'concerts' ? '演出名稱' : '標題', required: true, value: a?.title, full: true });
  if (ch === 'concerts') fields.push(
    { name: 'date', label: '日期', type: 'date', required: true, value: ev?.date || '' },
    { name: 'time', label: '開演時間', type: 'time', value: ev?.time || '19:30' },
    { name: 'venue', label: '地點', value: a?.venue, placeholder: '例：國家音樂廳、中山堂' },
    { name: 'link', label: '購票／詳情連結', type: 'url', value: a?.link, placeholder: 'https://' },
  );
  fields.push({ name: 'body', label: ch === 'concerts' ? '介紹（選填）' : '內容', type: 'textarea', rows: ch === 'concerts' ? 3 : 6, value: a?.body, full: true });
  if (ch === 'sizhu') {
    const people = activePeople().filter((p) => p.roles.some((r) => r !== 'ringer'))
      .sort((x, y) => roster.includes(y.id) - roster.includes(x.id) || nameOf(x.id).localeCompare(nameOf(y.id)));
    fields.push(
      { name: 'mention_all', label: '標記', type: 'toggle', text: `@全體絲竹成員（${roster.length} 人）`, value: a?.mention_all },
      { name: 'mentions', label: '或只標記這些人', type: 'checks', full: true, value: a?.mentions || [],
        options: people.map((p) => [p.id, nameOf(p.id) + (roster.includes(p.id) ? '' : '（非絲竹）')]), hint: '被標記的人會在首頁看到提醒，DC 通知也會 @ 他。' },
    );
  }
  if (officer) fields.push(
    { name: 'pinned', label: '置頂', type: 'toggle', text: '置頂', value: a?.pinned },
    { name: 'notify', label: '通知', type: 'toggle', text: '同步發送到 DC', value: !a },
  );
  const v = await formDialog({ title: a ? '編輯' : CHANNELS[ch].add, danger: a ? '刪除' : null, submit: a ? '儲存' : '發布', fields });
  if (!v) return;
  if (v.__danger) { await run(() => sb.from('announcements').delete().eq('id', a.id), '已刪除'); return render(); }
  if (ch === 'main' && v.audience === 'section' && !v.section) return toast('對象是「某一組」時要選組別', 'bad');
  const row = { channel: ch, title: v.title, body: v.body, pinned: officer ? v.pinned : false,
    type: ch === 'main' ? v.type : 'other', audience: ch === 'main' ? v.audience : 'insiders',
    section: ch === 'main' && v.audience === 'section' ? v.section : null };
  if (ch === 'sizhu') Object.assign(row, { mention_all: v.mention_all, mentions: v.mentions });
  if (ch === 'concerts') Object.assign(row, { event_at: twToIso(v.date, v.time || '00:00'), venue: v.venue, link: v.link });
  const r = await run(() => a ? sb.from('announcements').update(row).eq('id', a.id).select().single() : sb.from('announcements').insert(row).select().single(), a ? '已更新' : '已發布');
  if (r && v.notify) await invokeFn('notify', { type: 'announcement', id: r.data.id }).catch((e) => toast('已發布，但通知沒送出：' + e.message, 'bad'));
  render();
}

function postItem(ch, a, read) {
  const edit = canEdit(ch, a) ? `<button class="btn sm ghost" data-edit-ann="${a.id}">編輯</button>` : '';
  if (ch === 'concerts') {
    const t = a.event_at ? twParts(a.event_at) : null;
    return `<article class="ann concert ${read.has(a.id) ? '' : 'unread'}">
      <div class="ev-date">${t ? `<b>${t.month}/${t.day}</b><span>週${twWeekday(a.event_at)}</span>` : '<b>—</b>'}</div>
      <div><div class="ann-head">${a.pinned ? '<span class="chip gold">置頂</span>' : ''}${edit}</div>
        <h3>${esc(a.title)}</h3>
        <p class="meta-line">${t ? `<span class="mono">${t.time}</span>` : ''}${a.venue ? `　${esc(a.venue)}` : ''}${a.link ? `　<a href="${esc(a.link)}" target="_blank" rel="noopener">購票／詳情 →</a>` : ''}</p>
        ${a.body ? `<p class="body">${esc(a.body)}</p>` : ''}
        <div class="meta">${a.author ? `<span class="small muted">分享者</span>${chipPerson(a.author)}` : ''}</div></div></article>`;
  }
  const tagged = (a.mentions || []).includes(me()) || (a.mention_all && ROSTER.includes(me()));
  return `<article class="ann t-${a.type} ${read.has(a.id) ? '' : 'unread'} ${tagged ? 'tagged' : ''}">
    <div class="ann-head">${ch === 'main' ? `<span class="atype t-${a.type}">${ANN_TYPE[a.type]}</span>` : ''}${a.pinned ? '<span class="chip gold">置頂</span>' : ''}
      ${ch === 'main' ? `<span class="chip">${a.audience === 'section' ? esc(a.section) + '組' : ANN_AUDIENCE[a.audience]}</span>` : ''}${edit}</div>
    <h3>${esc(a.title)}</h3>${a.body ? `<p class="body">${esc(a.body)}</p>` : ''}
    ${mentionLine(a)}
    <div class="meta">${a.author ? chipPerson(a.author) : ''}<span class="mono small muted">${fmtDate(a.created_at)} ${fmtTime(a.created_at)}</span></div></article>`;
}

export function mentionLine(a) {
  const ids = a.mentions || [];
  if (!a.mention_all && !ids.length) return '';
  return `<p class="mentions">${a.mention_all ? '<span class="at">@全體絲竹成員</span>' : ''}${ids.map((id) => `<span class="at ${id === me() ? 'me' : ''}">@${esc(nameOf(id))}</span>`).join('')}</p>`;
}

async function channelPage(ch) {
  const C = CHANNELS[ch];
  const f = ch === 'main' ? sessionStorage.getItem('af') || '' : '';
  const nowIso = new Date(Date.now() - 3 * 3600e3).toISOString();
  ROSTER = ch === 'sizhu' ? await sizhuRoster() : [];
  const [{ data }, { data: reads }, evs] = await Promise.all([
    sb.from('announcements').select('*').eq('channel', ch).order('created_at', { ascending: false }).limit(100),
    sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
    ch === 'sizhu' ? sb.from('events').select('*').contains('kinds', ['sizhu']).gte('starts_at', nowIso).order('starts_at').limit(6) : { data: [] },
  ]);
  const read = new Set((reads || []).map((r) => r.ann_id));
  let list = (data || []).filter((a) => !f || a.type === f);
  const unread = list.filter((a) => !read.has(a.id));
  if (unread.length) sb.from('announcement_reads').upsert(unread.map((a) => ({ ann_id: a.id, user_id: me() }))).then(() => document.dispatchEvent(new Event('unread-changed')));
  setTimeout(() => {
    $('#add-ann')?.addEventListener('click', () => editAnn(ch));
    $$('[data-edit-ann]').forEach((b) => (b.onclick = () => editAnn(ch, list.find((x) => x.id === b.dataset.editAnn))));
    $$('[data-af]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('af', b.dataset.af); render(); }));
    $('#edit-roster')?.addEventListener('click', editRoster);
    $('#past-toggle')?.addEventListener('click', () => { sessionStorage.setItem('cpast', sessionStorage.getItem('cpast') === '1' ? '0' : '1'); render(); });
  });
  const head = pageHead(C.title, C.sub, canPost(ch) ? `<button class="btn pri" id="add-ann">＋ ${C.add}</button>` : '');
  const listHtml = (l) => `<div class="ann-list">${l.map((a) => postItem(ch, a, read)).join('')}</div>`;

  if (ch === 'concerts') {
    const now = Date.now();
    const up = list.filter((a) => !a.event_at || new Date(a.event_at) >= now - 864e5).sort((a, b) => (b.pinned - a.pinned) || ((a.event_at || '9') > (b.event_at || '9') ? 1 : -1));
    const past = list.filter((a) => a.event_at && new Date(a.event_at) < now - 864e5).sort((a, b) => (a.event_at < b.event_at ? 1 : -1));
    const showPast = sessionStorage.getItem('cpast') === '1';
    return head + (up.length ? listHtml(up) : empty('最近沒有人分享音樂會', '看到不錯的演出就按「分享音樂會」，大家可以一起去。')) +
      (past.length ? `<div class="row-end" style="margin-top:16px"><button class="btn sm ghost" id="past-toggle">${showPast ? '收起' : '看'}已結束的 ${past.length} 場</button></div>${showPast ? listHtml(past) : ''}` : '');
  }
  list = list.sort((a, b) => (b.pinned - a.pinned) || (b.created_at > a.created_at ? 1 : -1));
  const seg = ch === 'main' ? `<div class="seg wrap"><button data-af="" aria-pressed="${!f}">全部</button>${Object.entries(ANN_TYPE).map(([k, l]) => `<button data-af="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>` : '';
  const rosterCard = ch === 'sizhu' ? `<section class="card"><div class="card-head"><h2>絲竹成員 <span class="muted small">${ROSTER.length} 人</span></h2>${state.p.officer ? '<button class="btn sm" id="edit-roster">編輯名單</button>' : ''}</div>
    ${ROSTER.length ? `<div class="tags people">${ROSTER.map((id) => chipPerson(id, id === me() ? 'me' : '')).join('')}</div>` : `<p class="small muted">${state.p.officer ? '按「編輯名單」勾選有參加絲竹的人，發公告時就能 @全體絲竹成員。' : '幹部還沒設定絲竹名單。'}</p>`}</section>` : '';
  const sizhuEvents = ch === 'sizhu' ? `<section class="card"><div class="card-head"><h2>接下來的絲竹排練</h2><a class="link" href="#/events">全部行程</a></div>
    ${evs.data?.length ? `<div class="ev-list">${evs.data.map((e) => eventCard(e)).join('')}</div>` : '<p class="small muted">目前沒有排定的絲竹排練。幹部在「行程」新增時類型選「絲竹」，就會出現在這裡。</p>'}</section><h2 class="section-h">絲竹公告</h2>` : '';
  return head + rosterCard + sizhuEvents + seg + (list.length ? listHtml(list) : empty(`目前沒有${ch === 'main' ? '公告' : C.title + '的消息'}`, state.p.officer ? `按「${C.add}」發布，大家就會看到。` : ''));
}

async function editRoster() {
  const people = activePeople().filter((p) => p.roles.some((r) => r !== 'ringer')).sort((x, y) => nameOf(x.id).localeCompare(nameOf(y.id)));
  const v = await formDialog({ title: '絲竹名單', fields: [{ name: 'ids', label: '勾選有參加絲竹的人', type: 'checks', full: true, value: ROSTER,
    options: people.map((p) => [p.id, `${nameOf(p.id)}${p.instruments ? `（${p.instruments}）` : ''}`]) }] });
  if (!v) return;
  const add = v.ids.filter((id) => !ROSTER.includes(id)), del = ROSTER.filter((id) => !v.ids.includes(id));
  if (add.length) await run(() => sb.from('ensemble_members').insert(add.map((user_id) => ({ ensemble: 'sizhu', user_id }))));
  if (del.length) await run(() => sb.from('ensemble_members').delete().eq('ensemble', 'sizhu').in('user_id', del));
  toast('已更新絲竹名單', 'ok'); render();
}

for (const [ch, C] of Object.entries(CHANNELS)) route(C.path, () => channelPage(ch));
