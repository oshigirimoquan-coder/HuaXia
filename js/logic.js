// 純邏輯（沒有畫面、沒有網路），可以單獨測試
export const TZ = 'Asia/Taipei';
export const SECTIONS = ['吹管', '拉弦', '彈撥', '打擊', '低音'];
export const ROLE_LABEL = {
  admin: '管理員', officer: '幹部', leader: '組長', member: '社員', newbie: '新生', ringer: '槍手', teacher: '指導老師', alumni: '校友',
};
export const KIND_LABEL = {
  tutti: '大團', sizhu: '絲竹', extra: '加練', sectional: '分部課', class: '教學班',
  dress: '總彩', concert: '公演', officer: '幹部會議', other: '活動',
};
export const ATT_LABEL = { present: '出席', late: '晚到', early: '早退', absent: '缺席', excused: '請假', na: '無曲' };
export const LEAVE_LABEL = { leave: '請假', late: '晚到', early: '早退' };
export const ANN_TYPE = { practice: '練習異動', performance: '演出', admin: '行政', class: '教學班', urgent: '緊急', other: '公告' };
export const ANN_AUDIENCE = { all: '全體（含槍手）', insiders: '全體社員', section: '某一組', officers: '幹部', newbies: '新生', ringers: '槍手' };

// 依身分組判斷權限（與資料庫規則一致，資料庫才是最終把關）
export function perms(roles, active = true) {
  const r = new Set(active ? roles : []);
  const admin = r.has('admin');
  const officer = admin || r.has('officer');
  const insider = ['admin', 'officer', 'leader', 'member', 'newbie', 'teacher', 'alumni'].some((x) => r.has(x));
  return {
    admin, officer, insider,
    staff: officer || r.has('teacher'),
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
    if (c.audience === 'section') return p.officer || c.section === section;
    if (c.audience === 'class') return p.newbie || p.canTeach;
    return true;
  });
}

// 編制缺額：needed_min 減去已排人數
export function partShortage(part, assignedCount) {
  return Math.max(0, (part.needed_min ?? 1) - assignedCount);
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
  if (row.leave_type === 'late') return 'late';
  if (row.leave_type === 'early') return 'early';
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
