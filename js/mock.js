// 示範模式（網址加 ?demo）：不連資料庫，用假資料展示介面。資料都是虛構的。
const day = 864e5;
const at = (offsetDays, hhmm) => {
  const tw = new Date(Date.now() + 8 * 3600e3 + offsetDays * day).toISOString().slice(0, 10);
  return new Date(`${tw}T${hhmm}:00+08:00`).toISOString();
};
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = uid(1);

function fixtures() {
  const P = [
    [1, '林小華', '拉弦', '二胡', ['admin', 'member'], '社長'], [2, '陳柏宇', '吹管', '梆笛', ['officer', 'leader', 'member'], '副社'],
    [3, '王語彤', '彈撥', '琵琶', ['officer', 'member'], '總務'], [4, '張書維', '打擊', '定音鼓', ['leader', 'member'], ''],
    [5, '黃予安', '低音', '大提琴', ['leader', 'member'], ''], [6, '李若晴', '拉弦', '中胡', ['member'], ''],
    [7, '吳承恩', '彈撥', '中阮', ['member'], ''], [8, '周子芸', '吹管', '高笙', ['member'], ''],
    [9, '許芷涵', '拉弦', '二胡', ['member', 'newbie'], ''], [10, '鄭宇恆', '彈撥', '柳琴', ['member', 'newbie'], ''],
    [11, '蘇晏', null, '中阮', ['ringer'], ''], [12, '何老師', null, '指揮', ['teacher'], ''],
  ];
  const profiles = P.map(([n, name, section, ins, , title]) => ({ id: uid(n), display_name: name, real_name: name, section, instruments: ins, status: 'active', officer_title: title, avatar_url: null, school: n === 11 ? '師大' : '', grade: '', bio: '' }));
  profiles.push({ id: uid(13), display_name: '新朋友', real_name: '', section: null, instruments: '', status: 'pending', officer_title: '', school: '', grade: '', bio: '' });
  const user_roles = P.flatMap(([n, , , , roles]) => roles.map((role) => ({ user_id: uid(n), role })));
  const pieces = [['p1', '泰芙努特', '刁鵬', 6], ['p2', '神遊浯洲醉金城', '朱雲嵩', 10.5], ['p3', '春天組曲（一、三、四）', '顧冠仁', 12], ['p4', '留傘調新編', '', 5.5]]
    .map(([id, title, composer, duration_min]) => ({ id, title, composer, duration_min, notes: '', archived: false }));
  const parts = [
    ['pp1', 'p1', '二胡I', '2', 2, 1, 1], ['pp2', 'p1', '中胡', '1', 1, 2, null], ['pp3', 'p1', '琵琶', '2', 2, 3, 3], ['pp4', 'p1', '大提琴', '1', 1, 4, 5],
    ['pp5', 'p2', '梆笛', '1', 1, 1, 2], ['pp6', 'p2', '高笙', '1', 1, 2, null], ['pp7', 'p2', '中阮', '2', 2, 3, 7], ['pp8', 'p2', '定音鼓', '1', 1, 4, 4], ['pp9', 'p2', '二胡I', '2-3', 2, 5, 1],
    ['pp10', 'p3', '柳琴', '1-2', 1, 1, null], ['pp11', 'p3', '二胡II', '2', 2, 2, null], ['pp12', 'p4', '高胡', '1', 1, 1, null],
  ].map(([id, piece_id, name, needed, needed_min, sort, tutor]) => ({ id, piece_id, name, needed, needed_min, sort, tutor_id: tutor ? uid(tutor) : null, note: '' }));
  const A = [['pp1', 1], ['pp1', 9], ['pp2', 6], ['pp3', 3], ['pp4', 5], ['pp5', 2], ['pp6', 8], ['pp7', 7], ['pp8', 4], ['pp9', 1], ['pp9', 6], ['pp10', 10], ['pp11', 9], ['pp12', 1]];
  const part_assignments = A.map(([part_id, n], i) => ({ id: 'a' + i, part_id, user_id: uid(n), ringer_id: null }));
  part_assignments.push({ id: 'ar', part_id: 'pp7', user_id: uid(11), ringer_id: null });
  const events = [
    ['e1', 'tutti', '大團練習', -14, '19:30', '21:30', '721', null], ['e2', 'sizhu', '絲竹練習', -7, '19:30', '21:30', '721', null],
    ['e3', 'tutti', '大團練習', -1, '19:30', '21:30', '721', null], ['e4', 'sectional', '拉弦分部課', 1, '14:00', '15:30', '721', '拉弦'],
    ['e5', 'officer', '幹部會議', 2, '12:10', '13:00', '社辦', null], ['e6', 'tutti', '大團練習', 6, '19:30', '21:30', '721', null],
    ['e7', 'class', '二胡入門班', 4, '18:00', '19:00', '813', null], ['e8', 'dress', '公演總彩', 30, '14:00', '17:00', '視聽館', null],
    ['e9', 'concert', '期末公演', 33, '19:00', '21:30', '視聽館', null],
  ].map(([id, kind, title, d, s, e, loc, section]) => ({ id, semester_id: 's1', kind, title, starts_at: at(d, s), ends_at: at(d, e), location: loc, note: id === 'e6' ? '下半場練合奏，記得帶譜架。' : '', section, class_id: kind === 'class' ? 'c1' : null, audience: kind === 'officer' ? 'officers' : ['dress', 'concert'].includes(kind) ? 'all' : 'insiders', calendar_key: 'tutti', counts_attendance: kind !== 'officer', gcal_event_id: null }));
  const event_pieces = [['e2', 'p4'], ['e3', 'p1'], ['e3', 'p2'], ['e6', 'p2'], ['e6', 'p3'], ['e8', 'p1'], ['e8', 'p2'], ['e8', 'p3'], ['e8', 'p4']].map(([event_id, piece_id]) => ({ event_id, piece_id }));
  const att = [];
  const mark = (eid, map) => Object.entries(map).forEach(([n, status]) => att.push({ event_id: eid, user_id: uid(+n), status, note: '' }));
  mark('e1', { 1: 'present', 2: 'present', 3: 'late', 4: 'present', 5: 'present', 6: 'absent', 7: 'present', 8: 'early', 9: 'present', 10: 'present' });
  mark('e2', { 1: 'present' });
  mark('e3', { 1: 'present', 2: 'present', 3: 'present', 4: 'late', 5: 'present', 6: 'excused', 7: 'present', 8: 'present', 9: 'present' });
  return {
    profiles, user_roles,
    profile_private: profiles.map((p, i) => ({ user_id: p.id, email: `member${i + 1}@example.com`, google_email: null, phone: '' })),
    semesters: [{ id: 's1', name: '114-1', starts_on: '2026-09-01', ends_on: '2027-01-31', is_current: true }],
    settings: [{ key: 'team_name', value: '華夏國樂社' }, { key: 'attendance_rules', value: { late_weight: 1, early_weight: 1, unexcused_weight: 0.5, excused_mode: 'absent', count_ringers: false } }, { key: 'recruit_open', value: true }, { key: 'last_backup_at', value: '2026-07-20T10:00:00Z' }, { key: 'notify', value: { channel: 'discord' } }],
    private_settings: [],
    calendars: [['tutti', '華夏｜全團練習與演出', 'insiders', null], ['sec-bow', '華夏｜拉弦分部課', 'section', '拉弦'], ['sec-wind', '華夏｜吹管分部課', 'section', '吹管'], ['class', '華夏｜教學班', 'class', null], ['ringers', '華夏｜槍手行程', 'ringers', null], ['officers', '華夏｜幹部', 'officers', null]]
      .map(([key, name, audience, section], i) => ({ key, name, audience, section, gcal_id: `demo-${key}@group.calendar.google.com`, sort: i })),
    pieces, piece_parts: parts, part_assignments, events, event_pieces, attendance: att,
    leave_requests: [{ event_id: 'e3', user_id: uid(6), type: 'leave', reason: '期中考', created_at: at(-3, '10:00') }, { event_id: 'e6', user_id: uid(8), type: 'late', reason: '通識課 7 點下課，約 20 分鐘後到', created_at: at(0, '09:00') }],
    announcements: [
      { id: 'n1', channel: 'main', type: 'performance', audience: 'all', section: null, title: '期末公演總彩時間確定', body: '總彩在視聽館，14:00 集合搬樂器。槍手也請準時到。', pinned: true, author: uid(1), created_at: at(-2, '21:00') },
      { id: 'n2', channel: 'main', type: 'practice', audience: 'insiders', section: null, title: '下週二改在 621', body: '721 被借走，下週二大團改到 621。', pinned: false, author: uid(2), created_at: at(-1, '22:10') },
      { id: 'n3', channel: 'main', type: 'class', audience: 'newbies', section: null, title: '二胡入門班第一次上課', body: '請先把琴帶來，學長姐會教調音。', pinned: false, author: uid(1), created_at: at(-5, '20:00') },
      { id: 'n4', channel: 'sizhu', type: 'other', audience: 'insiders', section: null, mentions: [ME, uid(8)], mention_all: false, title: '絲竹本週練〈留傘調〉B 段', body: '請先聽示範錄音，揚琴與笛子對一下前奏。', pinned: false, author: uid(2), created_at: at(-1, '20:00') },
      { id: 'n5', channel: 'concerts', type: 'other', audience: 'insiders', section: null, title: '臺北市立國樂團 春季音樂會', body: '學生票 5 折，想去的可以揪。', venue: '中山堂', link: 'https://example.com', event_at: at(9, '19:30'), pinned: false, author: uid(6), created_at: at(-2, '22:00') },
      { id: 'n6', channel: 'concerts', type: 'other', audience: 'insiders', section: null, title: '北藝大國樂系 學期音樂會', body: '', venue: '北藝大音樂廳', link: '', event_at: at(18, '19:00'), pinned: false, author: ME, created_at: at(-1, '09:00') },
      { id: 'n7', channel: 'alumni', type: 'other', audience: 'insiders', section: null, title: '校友團年度音樂會招募團員', body: '12 月底演出，歡迎畢業學長姐回來。', pinned: true, author: uid(1), created_at: at(-4, '12:00') },
    ],
    announcement_reads: [{ ann_id: 'n3', user_id: ME }],
    tasks: [
      { id: 't1', title: '借視聽館（公演＋總彩）', description: '課外組表單', due: at(3, '12:00').slice(0, 10), status: 'doing', audience: 'officers', assignees: [uid(3)], created_by: ME },
      { id: 't2', title: '確認槍手名單', description: '', due: at(7, '12:00').slice(0, 10), status: 'todo', audience: 'officers', assignees: [uid(1), uid(2)], created_by: ME },
      { id: 't3', title: '印節目單', description: '', due: at(25, '12:00').slice(0, 10), status: 'todo', audience: 'officers', assignees: [uid(3)], created_by: ME },
      { id: 't4', title: '回填公演服裝尺寸', description: '表單在 DC 公告頻道', due: at(5, '12:00').slice(0, 10), status: 'todo', audience: 'insiders', assignees: [], created_by: ME },
      { id: 't5', title: '整理打擊樂器清單', description: '', due: at(-2, '12:00').slice(0, 10), status: 'todo', audience: 'assignees', assignees: [uid(4), ME], created_by: ME },
    ],
    classes: [{ id: 'c1', semester_id: 's1', name: '二胡入門班', instrument: '二胡', teacher_ids: [uid(6)], note: '每週四晚上，第 3 週開始練第一首曲子。' }],
    class_students: [{ class_id: 'c1', user_id: uid(9) }, { class_id: 'c1', user_id: uid(10) }],
    class_milestones: ['會調音', '持弓與空弦長音', '一把位音階', '能演奏〈茉莉花〉'].map((title, i) => ({ id: 'm' + i, class_id: 'c1', title, sort: i })),
    class_progress: [{ milestone_id: 'm0', user_id: uid(9) }, { milestone_id: 'm1', user_id: uid(9) }, { milestone_id: 'm0', user_id: uid(10) }],
    resources: [
      { id: 'r1', section: '拉弦', instrument: '二胡', title: '二胡調音與定弦', url: 'https://example.com', note: '新生第一週看', created_at: at(-10, '10:00') },
      { id: 'r2', section: '吹管', instrument: '笛子', title: '笛子換氣與長音練習', url: 'https://example.com', note: '', created_at: at(-9, '10:00') },
      { id: 'r3', section: null, instrument: '', title: '看指揮的基本手勢', url: 'https://example.com', note: '全團都適用', created_at: at(-8, '10:00') },
    ],
    practice_reports: [{ id: 'pr1', user_id: uid(9), piece_id: 'p1', part_id: 'pp1', title: '泰芙努特 B 段慢速', url: 'https://example.com', note: '換把的地方會滑音，想請教指法', created_at: at(-1, '23:00') }],
    report_feedback: [{ id: 'f1', report_id: 'pr1', author: uid(1), body: '換把前先停一下，手指提前到位，速度先放到 60。', created_at: at(0, '09:00') }],
    ringers: [
      { id: 'g1', name: '蘇晏', school: '師大', instruments: '中阮', contact_user_id: uid(7), contact_info: 'IG：@demo', status: 'accepted', note: '只有週末能來', user_id: uid(11), created_at: at(-20, '10:00') },
      { id: 'g2', name: '范以晴', school: '北科', instruments: '高笙', contact_user_id: uid(8), contact_info: '', status: 'contacting', note: '', user_id: null, created_at: at(-15, '10:00') },
      { id: 'g3', name: '游佳', school: '北藝', instruments: '揚琴', contact_user_id: uid(3), contact_info: '', status: 'declined', note: '公演那週有比賽', user_id: null, created_at: at(-12, '10:00') },
    ],
    ensemble_members: [1, 2, 6, 7, 8].map((n) => ({ ensemble: 'sizhu', user_id: uid(n) })),
    applications: [
      { id: 'ap1', name: '吳小芸', grade: '資管一', contact: 'IG：@xiaoyun', experience: 'none', instruments_played: '', interests: ['拉弦'], want_class: true, message: '想學二胡！', status: 'new', officer_note: '', created_at: at(-1, '21:30') },
      { id: 'ap2', name: '林子豪', grade: '經濟二', contact: 'LINE：tzuhao', experience: 'basic', instruments_played: '國中學過笛子', interests: ['吹管'], want_class: false, message: '', status: 'contacted', officer_note: '10/7 已傳 LINE', created_at: at(-3, '12:10') },
    ],
    scores: [{ id: 'sc1', piece_id: 'p1', part_id: 'pp1', title: '二胡I 分譜', file_path: 'demo.pdf', audio_url: 'https://example.com' }],
  };
}

const DB = fixtures();
const singular = (t) => t.replace(/ies$/, 'y').replace(/s$/, '');

function parseSelect(s) {
  const rels = []; let depth = 0, start = -1, name = '', buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') { if (depth === 0) { name = buf.trim().split(/[,\s]+/).pop(); start = i + 1; } depth++; }
    else if (c === ')') { depth--; if (depth === 0) { rels.push([name, s.slice(start, i)]); buf = ''; continue; } }
    else if (depth === 0) buf += c;
  }
  return rels;
}
function embed(table, row, sel) {
  const out = { ...row };
  for (const [rel, inner] of parseSelect(sel || '')) {
    const fk = singular(rel) + '_id';
    if (fk in row) { const r = (DB[rel] || []).find((x) => x.id === row[fk]); out[rel] = r ? embed(rel, r, inner) : null; }
    else { const back = singular(table) + '_id'; out[rel] = (DB[rel] || []).filter((x) => x[back] === row.id).map((x) => embed(rel, x, inner)); }
  }
  return out;
}

class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.sel = '*'; this.ord = null; this.lim = null; this.one = null; this.payload = null; this.ret = false; }
  select(s = '*') { if (this.op === 'select') this.sel = s; else this.ret = true; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  neq(k, v) { this.f.push((r) => r[k] !== v); return this; }
  in(k, v) { this.f.push((r) => v.includes(r[k])); return this; }
  gte(k, v) { this.f.push((r) => r[k] >= v); return this; }
  lte(k, v) { this.f.push((r) => r[k] <= v); return this; }
  lt(k, v) { this.f.push((r) => r[k] < v); return this; }
  contains(k, v) { this.f.push((r) => v.every((x) => (r[k] || [r.kind]).includes(x))); return this; }
  not(k, op, v) { this.f.push((r) => r[k] !== v && r[k] !== undefined); return this; }
  order(k, o = {}) { this.ord = [k, o.ascending !== false]; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  insert(rows) { this.op = 'insert'; this.payload = [].concat(rows); return this; }
  upsert(rows) { this.op = 'upsert'; this.payload = [].concat(rows); return this; }
  update(v) { this.op = 'update'; this.payload = v; return this; }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) { return Promise.resolve(this.exec()).then(res, rej); }
  exec() {
    const T = (DB[this.t] ||= []);
    let rows;
    if (this.op === 'insert' || this.op === 'upsert') {
      rows = this.payload.map((r) => ({ id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      T.push(...rows);
    } else if (this.op === 'update') {
      rows = T.filter((r) => this.f.every((fn) => fn(r))); rows.forEach((r) => Object.assign(r, this.payload));
    } else if (this.op === 'delete') {
      DB[this.t] = T.filter((r) => !this.f.every((fn) => fn(r))); return { data: null, error: null };
    } else {
      rows = T.filter((r) => this.f.every((fn) => fn(r))).map((r) => embed(this.t, r, this.sel));
      if (this.ord) { const [k, asc] = this.ord; rows.sort((a, b) => ((a[k] ?? '') > (b[k] ?? '') ? 1 : -1) * (asc ? 1 : -1)); }
      if (this.lim) rows = rows.slice(this.off || 0, (this.off || 0) + this.lim);
    }
    if (this.one) return { data: rows[0] ?? null, error: this.one === 'single' && !rows[0] ? { message: 'not found' } : null };
    return { data: rows, error: null };
  }
}

// ---------- RPC（簡化版的資料庫函式） ----------
const rolesOf = (id) => DB.user_roles.filter((r) => r.user_id === id).map((r) => r.role);
function expected(e, id) {
  const roles = rolesOf(id);
  if (!e.counts_attendance) return false;
  if (!roles.some((r) => ['admin', 'officer', 'leader', 'member', 'newbie'].includes(r))) return false;
  const p = DB.profiles.find((x) => x.id === id);
  if (e.kind === 'sectional') return p?.section === e.section;
  if (e.kind === 'class') return DB.class_students.some((s) => s.class_id === e.class_id && s.user_id === id);
  const eps = DB.event_pieces.filter((x) => x.event_id === e.id).map((x) => x.piece_id);
  if (!eps.length) return true;
  const parts = DB.piece_parts.filter((x) => eps.includes(x.piece_id)).map((x) => x.id);
  return DB.part_assignments.some((a) => parts.includes(a.part_id) && a.user_id === id);
}
function cell(e, id) {
  const a = DB.attendance.find((x) => x.event_id === e.id && x.user_id === id);
  const l = DB.leave_requests.find((x) => x.event_id === e.id && x.user_id === id);
  const marked = DB.attendance.some((x) => x.event_id === e.id);
  return { a, l, marked, status: a?.status ?? (marked && expected(e, id) ? (l?.type === 'leave' ? 'excused' : 'absent') : null) };
}
const RPC = {
  my_mentions() {
    const inSizhu = DB.ensemble_members.some((m) => m.user_id === ME);
    return DB.announcements.filter((a) => (a.mentions || []).includes(ME) || (a.mention_all && inSizhu));
  },
  event_roster({ eid }) {
    const e = DB.events.find((x) => x.id === eid);
    return DB.profiles.filter((p) => p.status === 'active').map((p) => { const c = cell(e, p.id); return { user_id: p.id, expected: expected(e, p.id), status: c.a?.status ?? null, note: '', leave_type: c.l?.type ?? null, leave_reason: c.l?.reason ?? null }; })
      .filter((r) => r.expected || r.status || r.leave_type);
  },
  attendance_detail({ uid: id }) {
    return DB.events.filter((e) => e.counts_attendance).sort((a, b) => (a.starts_at > b.starts_at ? 1 : -1)).map((e) => {
      const c = cell(e, id); return { event_id: e.id, starts_at: e.starts_at, kind: e.kind, title: e.title, expected: expected(e, id), marked: c.marked, status: c.status, note: '', leave_type: c.l?.type ?? null, leave_reason: c.l?.reason ?? null };
    });
  },
  attendance_stats() {
    return DB.profiles.filter((p) => p.status === 'active' && rolesOf(p.id).some((r) => ['admin', 'officer', 'leader', 'member', 'newbie'].includes(r))).map((p) => {
      const cells = DB.events.filter((e) => expected(e, p.id)).map((e) => cell(e, p.id)).filter((c) => c.status !== 'na');
      const n = (s) => cells.filter((c) => c.status === s).length;
      const wt = (c) => c.status === 'present' ? 1 : c.status === 'late' ? (c.l?.type === 'late' ? 1 : 0.5) : c.status === 'early' ? (c.l?.type === 'early' ? 1 : 0.5) : 0;
      const done = cells.filter((c) => c.marked).length, att = cells.reduce((s, c) => s + wt(c), 0);
      return { user_id: p.id, expected_total: cells.length, expected_so_far: done, attended: att, present: n('present'), late: n('late'), early: n('early'), excused: n('excused'), absent: n('absent'),
        current_rate: done ? Math.round((att / done) * 1000) / 10 : null, total_rate: cells.length ? Math.round((att / cells.length) * 1000) / 10 : null };
    });
  },
};

export function createMock() {
  const session = { user: { id: ME, email: 'demo@example.com' } };
  return {
    from: (t) => new Q(t),
    rpc: async (fn, args) => ({ data: RPC[fn] ? RPC[fn](args || {}) : null, error: null }),
    auth: {
      getSession: async () => ({ data: { session } }),
      getUserIdentities: async () => ({ data: { identities: [{ provider: 'email' }] } }),
      linkIdentity: async () => ({ error: { message: '示範模式不能連結帳號' } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { location.search = ''; },
      signInWithOAuth: async () => ({ error: null }), signInWithPassword: async () => ({ error: null }), signUp: async () => ({ error: null }),
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ error: { message: 'demo' } }), upload: async () => ({ error: { message: '示範模式不能上傳' } }), remove: async () => ({}) }) },
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  };
}
