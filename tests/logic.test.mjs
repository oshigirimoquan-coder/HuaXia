import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perms, eventDefaults, calendarsFor, partShortage, rateLevel, twParts, twToIso, daysFromToday, defaultRollStatus, progressPct, twWeekday } from '../js/logic.js';

test('槍手只有 ringer 身分時是 ringerOnly，不算社內成員', () => {
  const p = perms(['ringer']);
  assert.equal(p.ringerOnly, true);
  assert.equal(p.insider, false);
  assert.equal(p.officer, false);
});

test('管理員自動擁有幹部權限', () => {
  const p = perms(['admin']);
  assert.equal(p.officer, true);
  assert.equal(p.staff, true);
});

test('帳號未啟用時沒有任何權限', () => {
  const p = perms(['admin'], false);
  assert.equal(p.admin, false);
  assert.equal(p.insider, false);
});

test('分部課依組別放進對應行事曆', () => {
  assert.equal(eventDefaults('sectional', '拉弦').calendar_key, 'sec-bow');
  assert.equal(eventDefaults('officer').audience, 'officers');
  assert.equal(eventDefaults('officer').counts_attendance, false);
  assert.equal(eventDefaults('concert').audience, 'all');
});

test('行事曆清單：社員看不到幹部與其他組的分部課', () => {
  const cals = [
    { key: 'tutti', audience: 'insiders', gcal_id: 'a' },
    { key: 'sec-bow', audience: 'section', section: '拉弦', gcal_id: 'b' },
    { key: 'sec-wind', audience: 'section', section: '吹管', gcal_id: 'c' },
    { key: 'officers', audience: 'officers', gcal_id: 'd' },
    { key: 'ringers', audience: 'ringers', gcal_id: 'e' },
    { key: 'class', audience: 'class', gcal_id: null },
  ];
  const keys = calendarsFor(cals, perms(['member']), '拉弦').map((c) => c.key);
  assert.deepEqual(keys, ['tutti', 'sec-bow']);
  assert.deepEqual(calendarsFor(cals, perms(['ringer']), null).map((c) => c.key), ['ringers']);
});

test('編制缺額不會變成負數', () => {
  assert.equal(partShortage({ needed_min: 2 }, 1), 1);
  assert.equal(partShortage({ needed_min: 1 }, 3), 0);
});

test('出席率分級', () => {
  assert.equal(rateLevel(null), 'none');
  assert.equal(rateLevel(80), 'ok');
  assert.equal(rateLevel(50), 'warn');
  assert.equal(rateLevel(49.9), 'bad');
});

test('台北時間轉換：晚上 19:30 不會跑到隔天', () => {
  const iso = twToIso('2026-11-14', '19:30');
  assert.equal(iso, '2026-11-14T11:30:00.000Z');
  assert.deepEqual([twParts(iso).date, twParts(iso).time], ['2026-11-14', '19:30']);
  assert.equal(twWeekday(iso), '六');
});

test('距今天數用台北日期計算', () => {
  const now = new Date('2026-10-07T17:00:00Z'); // 台北 10/8 01:00
  assert.equal(daysFromToday('2026-10-08T11:30:00Z', now), 0);
  assert.equal(daysFromToday('2026-10-09T11:30:00Z', now), 1);
});

test('點名預設狀態帶入請假', () => {
  assert.equal(defaultRollStatus({ status: 'present', leave_type: 'leave' }), 'present');
  assert.equal(defaultRollStatus({ leave_type: 'leave' }), 'excused');
  assert.equal(defaultRollStatus({ leave_type: 'late' }), 'late');
  assert.equal(defaultRollStatus({}), null);
});

test('教學進度百分比', () => {
  assert.equal(progressPct(0, 0), 0);
  assert.equal(progressPct(2, 3), 67);
});

test('備份提醒：超過 60 天沒備份才提醒；從沒備份過時，學期開始 30 天後才提醒', async () => {
  const { backupDue } = await import('../js/logic.js');
  const now = new Date('2026-12-01T00:00:00Z');
  assert.equal(backupDue('2026-11-01T00:00:00Z', '2026-09-01', now), false);
  assert.equal(backupDue('2026-09-15T00:00:00Z', '2026-09-01', now), true);
  assert.equal(backupDue(null, '2026-11-20', now), false);
  assert.equal(backupDue(null, '2026-09-01', now), true);
  assert.equal(backupDue(null, null, now), false);
});

test('CSV：有逗號、引號、換行的欄位會加引號，開頭有 BOM 讓 Excel 正確顯示中文', async () => {
  const { toCSV } = await import('../js/logic.js');
  const csv = toCSV([['姓名', '備註'], ['小華', '晚到, "家教"\n下次早點']]);
  assert.equal(csv, '﻿姓名,備註\r\n小華,"晚到, ""家教""\n下次早點"');
});

test('複選類型的顯示文字', async () => {
  const { kindsLabel } = await import('../js/logic.js');
  assert.equal(kindsLabel({ kinds: ['tutti', 'sizhu'], kind: 'tutti' }), '大團・絲竹');
  assert.equal(kindsLabel({ kind: 'dress' }), '總彩');
});

test('複選類型的預設：只有幹部會議才限幹部看；含總彩或公演時槍手也看得到', async () => {
  const { kindsDefaults } = await import('../js/logic.js');
  assert.deepEqual(kindsDefaults(['officer']), { kind: 'officer', calendar_key: 'officers', audience: 'officers', counts: false });
  assert.deepEqual(kindsDefaults(['sectional', 'officer'], '拉弦'), { kind: 'sectional', calendar_key: 'sec-bow', audience: 'insiders', counts: true });
  assert.deepEqual(kindsDefaults(['tutti', 'concert']), { kind: 'tutti', calendar_key: 'tutti', audience: 'all', counts: true });
});
