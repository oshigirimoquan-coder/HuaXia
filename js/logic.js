// 純邏輯（沒有畫面、沒有網路），可以單獨測試
export const TZ = 'Asia/Taipei';
export const SECTIONS = ['吹管', '拉弦', '彈撥', '打擊', '低音'];
export const ROLE_LABEL = {
  admin: '管理員', officer: '幹部', leader: '組長', member: '社員', newbie: '新生', ringer: '槍手', teacher: '指導老師',
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
  const insider = ['admin', 'officer', 'leader', 'member', 'newbie', 'teacher'].some((x) => r.has(x));
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
