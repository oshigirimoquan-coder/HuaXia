// 純邏輯（沒有畫面、沒有網路），可以單獨測試
export const TZ = 'Asia/Taipei';
export const SECTIONS = ['吹管', '拉弦', '彈撥', '打擊', '低音'];
export const ROLE_LABEL = {
  admin: '管理員', officer: '幹部', leader: '組長', member: '社員', newbie: '教學班', ringer: '槍手', teacher: '指導老師', alumni: '校友',
};
// 組長併進幹部：身分組不再提供「組長」，改在幹部職位勾「X組長」
export const ROLE_CHOICES = Object.entries(ROLE_LABEL).filter(([k]) => k !== 'leader');  // 組長併進幹部
export const POSITIONS = ['團長', '學生指揮', '譜務', '社長', '副社長', '總務', '活動', '場器', '美宣', '吹管組長', '拉弦組長', '彈撥組長', '打擊組長', '低音組長'];
// 每場出席的事先回覆：出席／請假（事假、病假、公假）／晚到早退／沒回覆
export const replyLine = (r) => [`出席 ${r.said_yes}`, `請假 ${r.said_off}`, `晚到早退 ${r.said_late}`, r.no_reply ? `<b class="warn-t">沒回覆 ${r.no_reply}</b>` : '沒回覆 0'].join('・');
export const splitTitle = (t) => String(t || '').split(/[、,，/／\s]+/).map((x) => x.trim()).filter(Boolean);
export const KIND_LABEL = {
  tutti: '大團', sizhu: '絲竹', extra: '加練', sectional: '分部課', class: '教學班',
  dress: '總彩', concert: '公演', officer: '幹部會議', other: '活動',
};
export const ATT_LABEL = { present: '出席', late: '晚到', early: '早退', absent: '缺席', excused: '事假', sick: '病假', official: '公假', na: '無曲' };
// 請假分事假、病假、公假：病假、公假不列入出席率
export const LEAVE_LABEL = { leave: '事假', sick: '病假', official: '公假', late: '晚到', early: '早退' };
// 請假事由給人看的寫法：「【17:06 到】家教」→「晚到 17:06・家教」；其他假別 →「事假・原因」
export function leaveText(type, reason) {
  const label = LEAVE_LABEL[type] || '';
  const m = String(reason || '').match(/^【(\d{1,2}:\d{2}) (到|走)】\s*/);
  const rest = m ? String(reason).slice(m[0].length).trim() : String(reason || '').trim();
  const head = m ? `${label} ${m[1]}` : label;
  return rest ? `${head}・${rest}` : head;
}
// 已回覆的標籤文字：會出席／已晚到／已早退／已請事假（時間和原因另外顯示在下面）
export function replyTag(type) {
  if (type === 'attend') return '會出席';
  if (type === 'late' || type === 'early') return `已${LEAVE_LABEL[type]}`;
  return `已請${LEAVE_LABEL[type] || '假'}`;
}
// 事先按「出席」確認會到（存在請假表，type = 'attend'）
export const isAttend = (l) => l?.type === 'attend' || l?.leave_type === 'attend';
export const ANN_TYPE = { practice: '練習異動', performance: '演出', admin: '行政', class: '教學班', urgent: '緊急', other: '公告' };
export const ANN_AUDIENCE = { all: '全體（含槍手）', insiders: '全體社員', section: '某一組', officers: '幹部', newbies: '教學班', ringers: '槍手' };

// 依身分組判斷權限（與資料庫規則一致，資料庫才是最終把關）
export function perms(roles, active = true) {
  const r = new Set(active ? roles : []);
  const admin = r.has('admin');
  const officer = admin || r.has('officer');
  const insider = ['admin', 'officer', 'leader', 'member', 'newbie', 'teacher', 'alumni'].some((x) => r.has(x));
  return {
    admin, officer, insider,
    staff: officer || r.has('teacher'),
    viewAll: officer || r.has('teacher'),  // 看得到全團出席、請假、點名、槍手名單（指導老師只能看、不能改）
    leader: r.has('leader'),
    newbie: r.has('newbie'),
    ringerOnly: r.has('ringer') && !insider,
    canTeach: officer || r.has('teacher') || r.has('leader'),
  };
}

// 行程類型 → 預設行事曆與對象
export function eventDefaults(kind, section) {
  if (kind === 'sectional') {
    const key = { 吹管: 'sec-wind', 拉弦: 'sec-bow', 彈撥: 'sec-pluck', 打擊: 'sec-perc', 低音: 'sec-bass' }[section] || 'tutti';
    return { calendar_key: key, audience: 'insiders' };
  }
  if (kind === 'class') return { calendar_key: 'class', audience: 'insiders' };
  if (kind === 'officer') return { calendar_key: 'officers', audience: 'officers', counts_attendance: false };
  if (kind === 'dress' || kind === 'concert') return { calendar_key: 'tutti', audience: 'all' };
  return { calendar_key: 'tutti', audience: 'insiders' };
}

// 某人該加哪幾本行事曆
export function calendarsFor(calendars, p, section) {
  return calendars.filter((c) => {
    if (!c.gcal_id) return false;
    if (c.audience === 'officers') return p.officer;
    if (c.audience === 'ringers') return p.ringerOnly;
    if (p.ringerOnly) return false;
    if (c.audience === 'section') return p.officer || (Array.isArray(section) ? section : [section]).includes(c.section);
    if (c.audience === 'class') return p.newbie || p.canTeach;
    return true;
  });
}

// 編制缺額：needed_min 減去已排人數
export function partShortage(part, assignedCount) {
  return Math.max(0, (part.needed_min ?? 1) - assignedCount);
}

// ---------- 分部：聲部（parent_id 為空）底下可以有分部（parent_id 指向聲部），只分兩層 ----------
// 排人的那個人：社員看 user_id，還沒註冊的槍手看 ringer_id
const personKey = (a) => (a.user_id ? 'u:' + a.user_id : 'r:' + a.ringer_id);
export const divisiOf = (partId, parts) => parts.filter((x) => x.parent_id === partId);
// 排在這個聲部（含它所有分部）的不同人數
function peopleIn(part, parts, asg) {
  const ids = new Set([part.id, ...divisiOf(part.id, parts).map((x) => x.id)]);
  return new Set(asg.filter((a) => ids.has(a.part_id)).map(personKey)).size;
}
// 缺幾人：分部與沒分部的聲部看自己排到的人；有分部的聲部看所有分部排到幾個不同的人（一人排在好幾個分部只算一人）
export function shortageOf(part, parts, asg) {
  return partShortage(part, peopleIn(part, parts, asg));
}
// 刪聲部會一起刪掉的分部數與排人（幾個不同的人）；資料庫刪聲部連分部與排人一起刪
export function deleteCounts(part, parts, asg) {
  return { divisi: divisiOf(part.id, parts).length, people: peopleIn(part, parts, asg) };
}
// 聲部表單的「所屬聲部」：parts 是這首曲目的聲部，part 是正在編輯的（新增時是 null）
// 只列本身不是分部的聲部；自己有分部、或有分譜時不能收成分部（資料庫也會擋），blocked 寫原因
export function parentChoices(part, parts, scores) {
  if (part && divisiOf(part.id, parts).length) return { options: [], blocked: `「${part.name}」有分部，不能再收成別的聲部的分部` };
  if (part && scores.some((s) => s.part_id === part.id)) return { options: [], blocked: `「${part.name}」有分譜，分部不能有樂譜：要先刪掉或移走它的分譜` };
  return { options: parts.filter((x) => !x.parent_id && x.id !== part?.id).map((x) => [x.id, x.name]), blocked: null };
}
// 替排了人的聲部加第一個分部：聲部上的排人要移到分部（有分部的聲部不能排人）。
// childId 是那個分部（新建的還沒有編號時給 null）；分部已經排了同一人的，那筆刪掉不移。
// 寫入順序要照資料庫的觸發器：先刪 drop、再把 move 的 part_id 改成分部，最後才設分部的 parent_id
export function divisiMovePlan(parentId, childId, asg) {
  const onChild = new Set(asg.filter((a) => childId && a.part_id === childId).map(personKey));
  const onParent = asg.filter((a) => a.part_id === parentId);
  return {
    people: onParent.length,
    drop: onParent.filter((a) => onChild.has(personKey(a))).map((a) => a.id),
    move: onParent.filter((a) => !onChild.has(personKey(a))).map((a) => a.id),
  };
}
// 整首曲目缺幾人（曲目卡片用）：每個聲部取聲部缺的人與分部缺的位置加總較多的一邊，兩層不重複算
export function pieceShortage(parts, asg) {
  return parts.filter((x) => !x.parent_id).reduce((n, pt) => {
    const kids = divisiOf(pt.id, parts).reduce((m, d) => m + shortageOf(d, parts, asg), 0);
    return n + Math.max(shortageOf(pt, parts, asg), kids);
  }, 0);
}

// 出席率顯示等級
export function rateLevel(rate) {
  if (rate == null) return 'none';
  if (rate >= 80) return 'ok';
  if (rate >= 50) return 'warn';
  return 'bad';
}

// 把 Date 轉成台北時區的 yyyy-mm-dd 與 HH:MM
export function twParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const o = Object.fromEntries(f.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour === '24' ? '00' : o.hour}:${o.minute}`, month: +o.month, day: +o.day };
}
const WK = '日一二三四五六';
export function twWeekday(d) {
  const { date } = twParts(d);
  return WK[new Date(date + 'T12:00:00Z').getUTCDay()];
}
// 台北時間的日期＋時間 → ISO（UTC）
export function twToIso(date, time) {
  return new Date(`${date}T${time || '00:00'}:00+08:00`).toISOString();
}
// 距今天幾天（台北日期）
export function daysFromToday(d, now = new Date()) {
  const a = new Date(twParts(d).date + 'T00:00:00Z');
  const b = new Date(twParts(now).date + 'T00:00:00Z');
  return Math.round((a - b) / 864e5);
}

// 點名時的預設狀態：有請假就帶入請假類型
export function defaultRollStatus(row) {
  if (row.status) return row.status;
  if (row.leave_type === 'leave') return 'excused';
  if (row.leave_type === 'sick') return 'sick';
  if (row.leave_type === 'official') return 'official';
  if (row.leave_type === 'late') return 'late';
  if (row.leave_type === 'early') return 'early';
  if (row.leave_type === 'attend') return 'present';
  return null;
}

// 教學班進度百分比
export function progressPct(doneCount, total) {
  if (!total) return 0;
  return Math.round((doneCount / total) * 100);
}

// 備份提醒：上次備份超過 60 天；從沒備份過的話，學期開始滿 30 天才提醒
export function backupDue(lastIso, semesterStart, now = new Date()) {
  const days = (d) => (now - new Date(d)) / 864e5;
  if (lastIso) return days(lastIso) > 60;
  if (!semesterStart) return false;
  return days(semesterStart + 'T00:00:00+08:00') >= 30;
}

// 轉成 Excel 打得開的 CSV（開頭加 BOM，中文才不會亂碼）
export function toCSV(rows) {
  const cell = (v) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join('、') : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

// 行程類型顯示文字（可複選，例：大團・絲竹）
// 分部課的組別（可能好幾組一起上）
export function sectionsOf(e) { return e?.sections?.length ? e.sections : e?.section ? [e.section] : []; }

export function kindsLabel(e) {
  const ks = e.kinds?.length ? e.kinds : [e.kind];
  return ks.map((k) => KIND_LABEL[k] || k).join('・');
}

// 複選類型 → 主要類型（照 KIND_LABEL 的順序取第一個）、行事曆、可見對象、預設是否計出席
export function kindsDefaults(kinds, section) {
  const order = Object.keys(KIND_LABEL);
  const ks = [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const kind = ks[0];
  const onlyOfficer = ks.every((k) => k === 'officer');
  return {
    kind,
    calendar_key: eventDefaults(kind, section).calendar_key,
    audience: onlyOfficer ? 'officers' : ks.some((k) => k === 'dress' || k === 'concert') ? 'all' : 'insiders',
    counts: !onlyOfficer,
  };
}

// 依檔名／聲部名稱猜組別（批次上傳樂譜用）；回傳 '總譜'、組別名稱或 null（猜不到）
const SECTION_KEYS = [
  ['吹管', ['笛', '笙', '嗩吶', '唢呐', '管子', '簫', '箫', '巴烏', '葫蘆絲', 'dizi', 'sheng', 'suona', 'flute']],
  ['低音', ['大提', '低音提', '倍大提', '低音大提', '革胡', '貝斯', 'cello', 'bass']],
  ['拉弦', ['胡', 'huqin', 'erhu', 'gaohu', 'zhonghu']],
  ['彈撥', ['琵琶', '阮', '柳琴', '揚琴', '扬琴', '箏', '筝', '三弦', '箜篌', 'pipa', 'ruan', 'liuqin', 'yangqin', 'guzheng']],
  ['打擊', ['打擊', '打击', '鼓', '鑼', '锣', '鈸', '钹', '木魚', '定音', '鐘琴', '鐵琴', '木琴', '鈴', '梆子', '板', 'perc', 'timp', 'drum']],
];
export function guessSection(name, pieceTitle = '') {
  let s = String(name || '').replace(/\.[^.]+$/, '');
  if (pieceTitle) s = s.split(pieceTitle).join(' ');
  const low = s.toLowerCase();
  if (/總譜|总谱|full\s*score|\bscore\b|\bfull\b/.test(low)) return '總譜';
  for (const [sec, keys] of SECTION_KEYS) {
    if (keys.some((k) => (/^[a-z]+$/.test(k) ? new RegExp(`(^|[^a-z])${k}`).test(low) : low.includes(k)))) return sec;
  }
  return null;
}

// ---------- 座位表 ----------
// 座標單位：公尺；舞台前緣（靠觀眾）中央為 (0,0)，x 往右、y 往舞台深處
export const STAGES = {
  room: { label: '社課教室', w: 8, d: 6 },
  hall: { label: '演講廳', w: 12, d: 8 },
  concert: { label: '音樂廳', w: 16, d: 10 },
  custom: { label: '自訂大小', w: 12, d: 8 },
};
export const SEAT_STYLES = { arc: '半圓弧形（標準）', rows: '直排（教室）' };
const SEAT_GAP = 0.95, CONDUCTOR_Y = 1.0;
const r2 = (n) => Math.round(n * 100) / 100;

// 依編制產生座位：拉弦在左前、彈撥在右前（低音接在彈撥後面，落在右後方）、吹管在後排中央、打擊最後一排
export function autoSeat(parts, asg, stage = {}) {
  const w = stage.w || 12, d = stage.d || 8, style = stage.style || 'arc';
  const L = [], R = [], B = [], P = [];
  const sorted = [...parts].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  for (const zone of [['拉弦', L], ['彈撥', R], ['低音', R], ['吹管', B], ['打擊', P], [null, B]]) {
    for (const pt of sorted) {
      const sec = pt.section || guessSection(pt.name);
      const known = ['拉弦', '彈撥', '低音', '吹管', '打擊'].includes(sec);
      if (zone[0] ? sec !== zone[0] : known) continue;
      for (const a of asg.filter((x) => x.part_id === pt.id)) zone[1].push({ k: a.user_id ? 'u:' + a.user_id : 'r:' + a.ringer_id, part: pt.id });
    }
  }
  const seats = [];
  const put = (who, x, y) => seats.push({ ...who, x, y });
  if (style === 'rows') {
    const half = Math.max(1, Math.floor((w / 2 - 0.5) / SEAT_GAP));
    let row = 0;
    const fillHalf = (q, side) => { let i = 0, r = 0; while (i < q.length) { for (let c = 0; c < half && i < q.length; c++, i++) put(q[i], side * (w / 2 - 0.5 - c * SEAT_GAP), 1.6 + r * 1.0); r++; } return r; };
    row = Math.max(fillHalf(L, -1), fillHalf(R, 1));
    const full = (q) => { const per = Math.max(1, Math.floor((w - 1) / SEAT_GAP) + 1); for (let i = 0; i < q.length; i += per) { const n = Math.min(per, q.length - i); for (let c = 0; c < n; c++) put(q[i + c], (c - (n - 1) / 2) * SEAT_GAP, 1.6 + row * 1.0); row++; } };
    full(B); full(P);
  } else {
    const rad = (deg) => (deg * Math.PI) / 180;
    const R0 = 1.6, DR = 1.0, A0 = 12, A1 = 168;
    const radius = (i) => R0 + i * DR;
    const at = (r, deg) => [Math.cos(rad(deg)) * r, CONDUCTOR_Y + Math.sin(rad(deg)) * r];
    // 半邊：從外側（A1 或 A0）往中央 90° 排
    const fillHalf = (q, left) => {
      let i = 0, row = 0;
      while (i < q.length) {
        const r = radius(row), step = (SEAT_GAP / r) * 180 / Math.PI;
        for (let a = left ? A1 : A0; left ? a > 90 + step / 3 : a < 90 - step / 3; a += left ? -step : step) { if (i >= q.length) break; put(q[i++], ...at(r, a)); }
        row++;
      }
      return row;
    };
    let row = Math.max(fillHalf(L, true), fillHalf(R, false));
    let i = 0;
    while (i < B.length) {
      const r = radius(row), step = (SEAT_GAP / r) * 180 / Math.PI;
      const per = Math.max(1, Math.floor((A1 - A0) / step) + 1), n = Math.min(per, B.length - i);
      for (let c = 0; c < n; c++) put(B[i++], ...at(r, 90 + ((n - 1) / 2 - c) * step));
      row++;
    }
    const backY = CONDUCTOR_Y + radius(row) - 0.3;
    const per = Math.max(1, Math.floor((w - 1) / SEAT_GAP) + 1);
    for (let j = 0; j < P.length; j += per) {
      const n = Math.min(per, P.length - j);
      for (let c = 0; c < n; c++) put(P[j + c], (c - (n - 1) / 2) * SEAT_GAP, backY + (j / per) * 1.0);
    }
  }
  // 超出舞台就以指揮為中心等比縮小
  const maxY = Math.max(CONDUCTOR_Y, ...seats.map((s) => s.y)), maxX = Math.max(0.1, ...seats.map((s) => Math.abs(s.x)));
  const f = Math.min(1, (d - 0.5 - CONDUCTOR_Y) / Math.max(0.1, maxY - CONDUCTOR_Y), (w / 2 - 0.45) / maxX);
  return seats.map((s) => ({ ...s, x: r2(s.x * f), y: r2(CONDUCTOR_Y + (s.y - CONDUCTOR_Y) * f) }));
}
export const conductorAt = () => ({ x: 0, y: r2(CONDUCTOR_Y - 0.55) });

// 已存的座位表與目前編制對齊：還在編制的人保留位置；不在的移除；新加入的回傳在 missing
export function reconcileSeats(saved, parts, asg) {
  const partIds = new Set(parts.map((p) => p.id));
  const cur = asg.filter((a) => partIds.has(a.part_id)).map((a) => ({ k: a.user_id ? 'u:' + a.user_id : 'r:' + a.ringer_id, part: a.part_id }));
  const keyOf = (x) => x.k + '|' + x.part;
  const have = new Map((saved || []).map((s) => [keyOf(s), s]));
  const seats = cur.filter((c) => have.has(keyOf(c))).map((c) => have.get(keyOf(c)));
  const missing = cur.filter((c) => !have.has(keyOf(c)));
  return { seats, missing };
}

// 「需要人數」文字 → 至少幾人：'2' → 2、'2-3' → 2、'1↑' → 1、空白 → 1
export function parseNeeded(s) {
  const m = String(s ?? '').match(/\d+/);
  return m ? Number(m[0]) : 1;
}

// 聲部名稱正規化：去掉符號空白，Ⅰ/I/1/一 視為同一個數字
function normPart(s) {
  let t = String(s || '').toLowerCase().replace(/[\s_\-–—.,，、()（）【】\[\]「」]/g, '');
  const rom = [['iii', '3'], ['ii', '2'], ['iv', '4'], ['i', '1'], ['ⅲ', '3'], ['ⅱ', '2'], ['ⅰ', '1'], ['ⅳ', '4']];
  for (const [a, b] of rom) t = t.replace(new RegExp(`${a}$`), b);
  return t.replace(/[一壹]$/, '1').replace(/[二貳]$/, '2').replace(/[三參]$/, '3').replace(/[四肆]$/, '4');
}
// 檔名去掉副檔名與曲名，剩下的當作聲部名稱
export function partNameFromFile(name, pieceTitle = '') {
  let s = String(name || '').replace(/\.[^.]+$/, '');
  if (pieceTitle) s = s.split(pieceTitle).join(' ');
  return s.replace(/^[\s_\-–—.]+|[\s_\-–—.]+$/g, '').trim();
}
// 依檔名對到這首曲子的聲部：回傳 '總譜'、聲部 id，或 null（對不到）
export function matchPart(fileName, parts, pieceTitle = '') {
  const raw = partNameFromFile(fileName, pieceTitle);
  if (/總譜|总谱|full\s*score|^score$/i.test(raw)) return '總譜';
  const f = normPart(raw);
  if (!f) return null;
  const exact = parts.find((p) => normPart(p.name) === f);
  if (exact) return exact.id;
  const hits = parts.filter((p) => normPart(p.name) && f.includes(normPart(p.name))).sort((a, b) => normPart(b.name).length - normPart(a.name).length);
  return hits[0]?.id || null;
}

// 按「連結 Discord」回來時，Supabase 把失敗原因放在網址（?error_code=… 與 #error_code=…）；認得的回傳要顯示的說明
export const LINK_DISCORD_TAKEN = '這個 Discord 已經綁在另一個帳號上，請管理員先刪掉那個帳號。';
// 從 Discord 登入回來時網址帶的錯誤（例如 ?error=...&error_description=...），翻成看得懂的話
export function authErrorFromUrl(search, hash) {
  const q = new URLSearchParams(search), h = new URLSearchParams(hash.replace(/^#/, ''));
  const desc = q.get('error_description') || h.get('error_description') || '';
  const err = q.get('error') || h.get('error') || q.get('error_code') || h.get('error_code') || '';
  if (!err && !desc) return null;
  if (/identity_already_exists/.test(err)) return null;  // 連結 Discord 的錯誤另外處理
  const d = desc.replace(/\+/g, ' ');
  if (/signups? not allowed|signup.*disabled/i.test(d)) return '目前網站關閉了新帳號註冊，請聯絡管理員（Supabase 的 Allow new users to sign up 要打開）。';
  if (/email.*external provider|unverified|email.*not.*verified/i.test(d)) return '你的 Discord 帳號還沒有驗證 Email。請到 Discord「使用者設定 → 我的帳號」驗證 Email 後再登入。';
  if (/access_denied/i.test(err) && !d) return '你在 Discord 按了取消，沒有完成授權。';
  if (/flow state|code verifier|expired/i.test(d)) return '登入過程中斷了。請用 Safari 或 Chrome 打開網站（不要從 Discord 或 LINE 點連結），再按一次「使用 Discord 登入」。';
  return `登入失敗：${d || err}`;
}
export function linkErrorFromUrl(search, hash) {
  const code = new URLSearchParams(search).get('error_code') || new URLSearchParams(hash.replace(/^#/, '')).get('error_code');
  return code === 'identity_already_exists' ? LINK_DISCORD_TAKEN : null;
}
