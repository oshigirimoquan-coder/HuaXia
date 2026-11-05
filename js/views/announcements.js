import { sb, state, me, route, esc, run, formDialog, pageHead, empty, chipPerson, fmtDate, fmtTime, render, $, $$, toast, activePeople, nameOf } from '../core.js';
import { SECTIONS, twParts, twWeekday, twToIso } from '../logic.js';
import { invokeFn } from './events.js';
import { toolsBody, addToolBtn } from './tools.js';

// ---------- 公告照片（Storage「photos」，不公開，用有時效的網址顯示） ----------
const PHOTO_MAX = 9;

// ---------- 連結：一則可以放好幾個（一行一個），依網址標成「YouTube」「Google 雲端」等 ----------
const linksOf = (a) => String(a.link || '').split(/\s+/).filter((u) => /^https?:\/\/\S+$/i.test(u));
function linkLabel(u) {
  let h = ''; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch { return '連結'; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return 'YouTube';
  if (/^drive\.google\.com$|^docs\.google\.com$/.test(h)) return 'Google 雲端';
  if (/^photos\.google\.com$|^photos\.app\.goo\.gl$/.test(h)) return 'Google 相簿';
  if (/(^|\.)instagram\.com$/.test(h)) return 'Instagram';
  if (/(^|\.)facebook\.com$|^fb\.me$/.test(h)) return 'Facebook';
  return h;
}
const linksHtml = (list) => (list.length ? `<p class="ann-links">${list.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(linkLabel(u))} ↗</a>`).join('')}</p>` : '');

export async function photoUrls(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return new Map();
  const { data } = await sb.storage.from('photos').createSignedUrls(list, 3600);
  return new Map((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}
// 縮成最長邊 1600px 的 JPEG，省空間也比較快
export function shrink(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('照片轉檔失敗'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('這張照片讀不出來')); };
    img.src = url;
  });
}
async function uploadPhotos(files) {
  const done = [];
  for (const f of files) {
    try {
      const blob = await shrink(f);
      const path = `${me()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      done.push(path);
    } catch (e) {
      if (done.length) await sb.storage.from('photos').remove(done);
      toast('照片上傳失敗：' + (e.message || e), 'bad');
      return null;
    }
  }
  return done;
}
const photosHtml = (a) => (a.photos?.length ? `<div class="ann-photos n-${Math.min(a.photos.length, 4)}">${a.photos.map((p) => `<a class="ann-ph" data-ph="${esc(p)}" target="_blank" rel="noopener" aria-label="開啟照片"><img alt="" loading="lazy"></a>`).join('')}</div>` : '');
async function fillPhotos(root = document) {
  const els = [...root.querySelectorAll('[data-ph]')];
  if (!els.length) return;
  const urls = await photoUrls(els.map((e) => e.dataset.ph));
  els.forEach((e) => { const u = urls.get(e.dataset.ph); if (u) { e.href = u; e.querySelector('img').src = u; } else e.classList.add('missing'); });
}

// 公告分類（存在 announcements.channel）。open = 所有社員都能發（只能改自己的）
export const CATS = {
  performance: { label: '華夏演出' },
  tutti: { label: '大團' },
  sizhu: { label: '絲竹' },
  class: { label: '教學班' },
  alumni: { label: '校友團' },
  concerts: { label: '音樂會', open: true },
  resources: { label: '資源', open: true },
};
const catOf = (a) => (a.channel === 'main' ? ({ performance: 'performance', class: 'class' }[a.type] || 'tutti') : a.channel);
export const catLabel = (a) => CATS[catOf(a)]?.label || '公告';
// 不算「公告」的分享類（首頁最新公告、未讀紅點不算它們）
export const SHARE_CATS = Object.keys(CATS).filter((k) => CATS[k].open);

// 對象「絲竹」保留，但不再 @全體絲竹成員（mention_all 一律 false）
const AUDIENCE = { all: '全體（含槍手）', insiders: '全體社員', sizhu: '絲竹', section: '某一組', officers: '幹部', newbies: '教學班', ringers: '槍手' };
const DEFAULT_AUD = { performance: 'all', tutti: 'all', sizhu: 'sizhu', class: 'newbies', alumni: 'insiders' };

export async function sizhuRoster() {
  const { data } = await sb.from('ensemble_members').select('user_id').eq('ensemble', 'sizhu');
  return (data || []).map((r) => r.user_id);
}

let ROSTER = [];
const canEdit = (a) => state.p.officer || (CATS[catOf(a)]?.open && a?.author === me());
const postable = () => Object.keys(CATS).filter((k) => state.p.officer || (CATS[k].open && state.p.insider));

async function editAnn(a = null, preset = '') {
  const officer = state.p.officer;
  const cats = postable();
  const cat0 = a ? catOf(a) : (cats.includes(preset) ? preset : cats[0]);
  const roster = await sizhuRoster();
  const ev = a?.event_at ? twParts(a.event_at) : null;
  const people = activePeople().filter((p) => p.roles.some((r) => r !== 'ringer'))
    .sort((x, y) => roster.includes(y.id) - roster.includes(x.id) || nameOf(x.id).localeCompare(nameOf(y.id)));
  const officerOnly = Object.keys(CATS).filter((k) => !CATS[k].open);
  const oldUrls = await photoUrls(a?.photos || []);
  const fields = [
    { name: 'cat', label: '類型', type: 'select', value: cat0, options: cats.map((k) => [k, CATS[k].label]) },
  ];
  if (officer) fields.push(
    { name: 'audience', label: '對象', type: 'select', value: a?.audience || DEFAULT_AUD[cat0] || 'insiders', options: Object.entries(AUDIENCE), only: officerOnly },
    { name: 'section', label: '組別', type: 'select', value: a?.section || '', options: [['', '（對象選「某一組」時才需要）'], ...SECTIONS.map((s) => [s, s])], only: officerOnly },
  );
  fields.push(
    { name: 'title', label: '標題', required: true, value: a?.title, full: true },
    { name: 'date', label: '日期', type: 'date', value: ev?.date || '', only: ['concerts'] },
    { name: 'time', label: '開演時間', type: 'time', value: ev?.time || '19:30', only: ['concerts'] },
    { name: 'venue', label: '地點', value: a?.venue, placeholder: '例：國家音樂廳、中山堂', only: ['concerts'] },
    { name: 'link', label: '連結（選填，一行一個）', type: 'textarea', rows: 2, value: a?.link, placeholder: 'https://drive.google.com/…\nhttps://youtu.be/…', full: true, hint: '雲端相簿、練團影片、購票頁、樂譜都可以，一行放一個網址' },
    { name: 'body', label: '內容', type: 'textarea', rows: 5, value: a?.body, full: true },
    { name: 'photos', label: `照片／海報（最多 ${PHOTO_MAX} 張）`, type: 'photos', full: true, value: (a?.photos || []).map((path) => ({ path, url: oldUrls.get(path) || '' })) },
  );
  if (officer) fields.push(
    { name: 'mentions', label: '另外標記這些人（選填）', type: 'checks', full: true, value: a?.mentions || [], only: officerOnly,
      options: people.map((p) => [p.id, nameOf(p.id) + (roster.includes(p.id) ? '（絲竹）' : '')]), hint: '被標記的人會在首頁看到提醒，DC 通知也會 @ 他。' },
    { name: 'pinned', label: '置頂', type: 'toggle', text: '置頂', value: a?.pinned },
    { name: 'notify', label: '通知', type: 'toggle', text: '同步發送到 DC', value: !a },
  );
  const v = await formDialog({
    title: a ? '編輯' : '發布', danger: a ? '刪除' : null, submit: a ? '儲存' : '發布', fields, switchBy: 'cat',
    validate: (o) => {
      const aud = CATS[o.cat]?.open || !officer ? 'insiders' : o.audience;
      if (aud === 'section' && !o.section) return '對象是「某一組」時要選組別';
      if (o.cat === 'concerts' && !o.date) return '音樂會要填日期';
      const bad = (o.link || '').split(/\s+/).filter(Boolean).find((u) => !/^https?:\/\/\S+$/i.test(u));
      if (bad) return `連結要以 https:// 開頭：${bad.slice(0, 40)}`;
      if (o.photos && o.photos.keep.length + o.photos.files.length > PHOTO_MAX) return `一則最多 ${PHOTO_MAX} 張照片`;
      return null;
    },
    onChange: (name, value, d) => { if (name === 'cat' && DEFAULT_AUD[value] && d.querySelector('[name=audience]')) d.querySelector('[name=audience]').value = DEFAULT_AUD[value]; },
  });
  if (!v) return;
  if (v.__danger) {
    if (await run(() => sb.from('announcements').delete().eq('id', a.id), '已刪除') && a.photos?.length) await sb.storage.from('photos').remove(a.photos);
    return render();
  }
  const open = CATS[v.cat].open;
  const aud = open || !officer ? 'insiders' : v.audience;
  if (aud === 'section' && !v.section) return toast('對象是「某一組」時要選組別', 'bad');
  if (v.cat === 'concerts' && !v.date) return toast('音樂會要填日期', 'bad');
  const links = v.link.split(/\s+/).filter(Boolean);
  const badLink = links.find((u) => !/^https?:\/\/\S+$/i.test(u));
  if (badLink) return toast(`連結要以 https:// 開頭：${badLink.slice(0, 40)}`, 'bad');
  const row = {
    channel: v.cat, type: 'other', title: v.title, body: v.body, pinned: officer ? v.pinned : false,
    audience: aud, section: aud === 'section' ? v.section : null,
    mention_all: false, mentions: officer && !open ? v.mentions : [],
    link: links.join('\n'),
    venue: v.cat === 'concerts' ? v.venue : '', event_at: v.cat === 'concerts' ? twToIso(v.date, v.time || '00:00') : null,
  };
  if (v.photos.keep.length + v.photos.files.length > PHOTO_MAX) return toast(`一則最多 ${PHOTO_MAX} 張照片`, 'bad');
  const added = v.photos.files.length ? await uploadPhotos(v.photos.files) : [];
  if (!added) return;
  row.photos = [...v.photos.keep, ...added];
  const r = await run(() => a ? sb.from('announcements').update(row).eq('id', a.id).select().single() : sb.from('announcements').insert(row).select().single(), a ? '已更新' : '已發布');
  if (!r) { if (added.length) await sb.storage.from('photos').remove(added); return; }
  const removed = (a?.photos || []).filter((p) => !row.photos.includes(p));
  if (removed.length) await sb.storage.from('photos').remove(removed);
  if (r && officer && v.notify) await invokeFn('notify', { type: 'announcement', id: r.data.id }).catch((e) => toast('已發布，但通知沒送出：' + e.message, 'bad'));
  render();
}

function postItem(a, read) {
  const cat = catOf(a);
  const edit = canEdit(a) ? `<button class="btn sm ghost" data-edit-ann="${a.id}">編輯</button>` : '';
  if (cat === 'concerts') {
    const t = a.event_at ? twParts(a.event_at) : null;
    return `<article class="ann concert ${read.has(a.id) ? '' : 'unread'}">
      <div class="ev-date">${t ? `<b>${t.month}/${t.day}</b><span>週${twWeekday(a.event_at)}</span>` : '<b>—</b>'}</div>
      <div><div class="ann-head"><span class="atype c-concerts">音樂會</span>${a.pinned ? '<span class="chip gold">置頂</span>' : ''}${edit}</div>
        <h3>${esc(a.title)}</h3>
        <p class="meta-line">${t ? `<span class="mono">${t.time}</span>` : ''}${a.venue ? `　${esc(a.venue)}` : ''}${linksOf(a)[0] ? `　<a href="${esc(linksOf(a)[0])}" target="_blank" rel="noopener">購票／詳情 →</a>` : ''}</p>
        ${a.body ? `<p class="body">${esc(a.body)}</p>` : ''}
        ${linksHtml(linksOf(a).slice(1))}
        ${photosHtml(a)}
        <div class="meta">${a.author ? `<span class="small muted">分享者</span>${chipPerson(a.author)}` : ''}</div></div></article>`;
  }
  const tagged = (a.mentions || []).includes(me());
  const audChip = a.audience && !['insiders'].includes(a.audience) && !CATS[cat]?.open
    ? `<span class="chip">${a.audience === 'section' ? esc(a.section) + '組' : AUDIENCE[a.audience]}</span>` : '';
  return `<article class="ann c-${cat} ${read.has(a.id) ? '' : 'unread'} ${tagged ? 'tagged' : ''}">
    <div class="ann-head"><span class="atype c-${cat}">${catLabel(a)}</span>${a.pinned ? '<span class="chip gold">置頂</span>' : ''}${audChip}${edit}</div>
    <h3>${esc(a.title)}</h3>${a.body ? `<p class="body">${esc(a.body)}</p>` : ''}
    ${photosHtml(a)}
    ${linksHtml(linksOf(a))}
    ${mentionLine(a)}
    <div class="meta">${a.author ? chipPerson(a.author) : ''}<span class="mono small muted">${fmtDate(a.created_at)} ${fmtTime(a.created_at)}</span></div></article>`;
}

export function mentionLine(a) {
  const ids = a.mentions || [];
  if (!ids.length) return '';
  return `<p class="mentions">${ids.map((id) => `<span class="at ${id === me() ? 'me' : ''}">@${esc(nameOf(id))}</span>`).join('')}</p>`;
}

// 教學班與學員（目前學期）
async function classRoster() {
  let q = sb.from('classes').select('*').order('name');
  if (state.semester) q = q.eq('semester_id', state.semester.id);
  const [{ data: cs }, { data: st }] = await Promise.all([q, sb.from('class_students').select('*')]);
  return (cs || []).map((c) => ({ ...c, students: (st || []).filter((x) => x.class_id === c.id).map((x) => x.user_id) }));
}

async function annPage() {
  if (sessionStorage.getItem('af') === 'tools') sessionStorage.setItem('af', 'class');
  const f = CATS[sessionStorage.getItem('af')] ? sessionStorage.getItem('af') : '';
  ROSTER = await sizhuRoster();
  const [{ data }, { data: reads }, classes] = await Promise.all([
    sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('announcement_reads').select('ann_id').eq('user_id', me()),
    f === 'class' ? classRoster() : [],
  ]);
  const read = new Set((reads || []).map((r) => r.ann_id));
  let list = (data || []).filter((a) => !f || catOf(a) === f);
  const unread = list.filter((a) => !read.has(a.id));
  // 各分類有沒有還沒看過的（現在這個分類看了就算已讀，所以不標）
  const dots = new Set((data || []).filter((a) => !read.has(a.id) && catOf(a) !== f).map(catOf));
  // 只有點進某個分類才算看過那個分類；停在「全部」不清掉任何紅點
  if (f && unread.length) sb.from('announcement_reads').upsert(unread.map((a) => ({ ann_id: a.id, user_id: me() }))).then(() => document.dispatchEvent(new Event('unread-changed')));
  setTimeout(() => {
    $('#add-ann')?.addEventListener('click', () => editAnn(null, f));
    $$('[data-edit-ann]').forEach((b) => (b.onclick = () => editAnn(list.find((x) => x.id === b.dataset.editAnn))));
    $$('[data-af]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('af', b.dataset.af); render(); }));
    fillPhotos($('#main'));
    $('#edit-roster')?.addEventListener('click', editRoster);
    $('#go-teach')?.addEventListener('click', () => sessionStorage.setItem('grp', '教學班'));
    $('#past-toggle')?.addEventListener('click', () => { sessionStorage.setItem('cpast', sessionStorage.getItem('cpast') === '1' ? '0' : '1'); render(); });
  });
  const canAdd = postable().length > 0;
  const addLabel = state.p.officer ? '發布' : '分享音樂會或資源';
  const head = pageHead('公告', f === 'concerts' ? '看到不錯的音樂會、講座或比賽，分享給大家。' : f === 'resources' ? '好用的樂譜、影片、教學連結，大家都能分享。' : '',
    canAdd ? `<button class="btn pri" id="add-ann">＋ ${addLabel}</button>` : '');
  const seg = annSeg(f, dots);
  const listHtml = (l) => `<div class="ann-list">${l.map((a) => postItem(a, read)).join('')}</div>`;

  if (f === 'concerts') {
    const now = Date.now();
    const up = list.filter((a) => !a.event_at || new Date(a.event_at) >= now - 864e5).sort((a, b) => (b.pinned - a.pinned) || ((a.event_at || '9') > (b.event_at || '9') ? 1 : -1));
    const past = list.filter((a) => a.event_at && new Date(a.event_at) < now - 864e5).sort((a, b) => (a.event_at < b.event_at ? 1 : -1));
    const showPast = sessionStorage.getItem('cpast') === '1';
    return head + seg + (up.length ? listHtml(up) : empty('最近沒有人分享音樂會', '看到不錯的演出就按上面的按鈕，大家可以一起去。')) +
      (past.length ? `<div class="row-end" style="margin-top:16px"><button class="btn sm ghost" id="past-toggle">${showPast ? '收起' : '看'}已結束的 ${past.length} 場</button></div>${showPast ? listHtml(past) : ''}` : '');
  }
  list = list.sort((a, b) => (b.pinned - a.pinned) || (b.created_at > a.created_at ? 1 : -1));
  const sizhuTop = f === 'sizhu' ? `<section class="card"><div class="card-head"><h2>絲竹成員 <span class="muted small">${ROSTER.length} 人</span></h2>${state.p.officer ? '<button class="btn sm" id="edit-roster">編輯名單</button>' : ''}</div>
    ${ROSTER.length ? `<div class="tags people">${ROSTER.map((id) => chipPerson(id, id === me() ? 'me' : '')).join('')}</div>` : `<p class="small muted">${state.p.officer ? '按「編輯名單」勾選有參加絲竹的人，對象選「絲竹」時就會提醒他們。' : '幹部還沒設定絲竹名單。'}</p>`}</section>
` : '';
  const classTop = f === 'class' ? `<section class="card"><div class="card-head"><h2>教學班成員</h2>${state.p.canTeach ? '<a class="link" href="#/groups" id="go-teach">管理教學班</a>' : ''}</div>
    ${classes.length ? classes.map((c) => `<div class="class-roster"><h3>${esc(c.name)}${c.instrument ? ` <span class="muted small">${esc(c.instrument)}</span>` : ''}</h3>
      ${c.teacher_ids?.length ? `<p class="small"><span class="muted">帶課：</span>${c.teacher_ids.map((id) => chipPerson(id, id === me() ? 'me' : '')).join('')}</p>` : ''}
      <div class="tags people">${c.students.length ? c.students.map((id) => chipPerson(id, id === me() ? 'me' : '')).join('') : '<span class="small muted">還沒有學員</span>'}</div></div>`).join('')
      : `<p class="small muted">${state.p.canTeach ? '到「各組 › 教學班」新增教學班與學員。' : '幹部還沒建立教學班。'}</p>`}</section>` : '';
  const toolsTop = f === 'class' ? `<section class="card"><div class="card-head"><h2>練習工具</h2>${addToolBtn().replace('btn pri', 'btn sm')}</div>${toolsBody()}</section>` : '';
  return head + seg + sizhuTop + classTop + toolsTop + (list.length ? listHtml(list) : empty(f ? `目前沒有「${CATS[f].label}」的公告` : '目前沒有公告', canAdd ? '按右上角的按鈕發布。' : ''));
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

// 分類列
function annSeg(f, dots = new Set()) {
  return `<div class="seg wrap"><button data-af="" aria-pressed="${!f}">全部</button>${Object.entries(CATS).map(([k, c]) => `<button data-af="${k}" aria-pressed="${f === k}" class="${dots.has(k) ? 'has-new' : ''}">${c.label}${dots.has(k) ? '<i class="new-dot" aria-label="有新公告"></i>' : ''}</button>`).join('')}</div>`;
}

route('/announcements', annPage);
// 舊網址（DC 通知裡的連結）：直接打開對應分類
for (const k of ['sizhu', 'concerts', 'alumni', 'resources']) route('/' + k, () => { sessionStorage.setItem('af', k); return annPage(); });
