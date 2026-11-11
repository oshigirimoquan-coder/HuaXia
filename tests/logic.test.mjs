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

test('分部的缺人看自己的人數；有分部的聲部看所有分部排到幾個不同的人', async () => {
  const { shortageOf } = await import('../js/logic.js');
  // 擊樂2 要 2 人，底下風鈴、鈴鼓、沙球各要 1 人；阿甲一人負責風鈴與鈴鼓
  const parts = [
    { id: 'p', name: '擊樂2', needed_min: 2 },
    { id: 'd1', name: '風鈴', needed_min: 1, parent_id: 'p' },
    { id: 'd2', name: '鈴鼓', needed_min: 1, parent_id: 'p' },
    { id: 'd3', name: '沙球', needed_min: 1, parent_id: 'p' },
    { id: 'q', name: '高胡', needed_min: 2 },
  ];
  const asg = [{ part_id: 'd1', user_id: 'a' }, { part_id: 'd2', user_id: 'a' }, { part_id: 'q', user_id: 'b' }];
  assert.equal(shortageOf(parts[0], parts, asg), 1);   // 只有阿甲一人，不是兩人
  assert.equal(shortageOf(parts[1], parts, asg), 0);
  assert.equal(shortageOf(parts[3], parts, asg), 1);
  assert.equal(shortageOf(parts[4], parts, asg), 1);   // 沒分部的聲部照舊
  // 槍手排在兩個分部也只算一人
  const asg2 = [{ part_id: 'd1', ringer_id: 'r' }, { part_id: 'd3', ringer_id: 'r' }];
  assert.equal(shortageOf(parts[0], parts, asg2), 1);
  assert.equal(shortageOf(parts[0], parts, [...asg2, { part_id: 'd2', user_id: 'b' }]), 0);
});

test('曲目缺人：每個聲部取「聲部缺的人」與「分部缺的位置加總」較多的一邊，不重複算', async () => {
  const { pieceShortage } = await import('../js/logic.js');
  // 二胡要 8 人，I、II 各要 4 人：I 排 4 人、II 排 0 人 → 缺 4（不是聲部 4 加分部 4）
  const erhu = [{ id: 'e', needed_min: 8 }, { id: 'e1', needed_min: 4, parent_id: 'e' }, { id: 'e2', needed_min: 4, parent_id: 'e' }];
  const four = ['a', 'b', 'c', 'd'].map((u) => ({ part_id: 'e1', user_id: u }));
  assert.equal(pieceShortage(erhu, four), 4);
  // 擊樂要 2 人、三件樂器各要 1 人：2 人排滿聲部，但沙球沒人 → 缺 1
  const perc = [{ id: 'p', needed_min: 2 }, { id: 'p1', needed_min: 1, parent_id: 'p' }, { id: 'p2', needed_min: 1, parent_id: 'p' }, { id: 'p3', needed_min: 1, parent_id: 'p' }];
  assert.equal(pieceShortage(perc, [{ part_id: 'p1', user_id: 'a' }, { part_id: 'p2', user_id: 'b' }]), 1);
  // 沒分部的聲部照舊相加（擊樂沒排人時，三件樂器缺 3 多於聲部缺 2）
  assert.equal(pieceShortage([...erhu, ...perc, { id: 'q', needed_min: 2 }], four), 4 + 3 + 2);
});

test('所屬聲部：只列這首曲目本身不是分部的聲部；有分部或有分譜的聲部不能收成分部', async () => {
  const { parentChoices } = await import('../js/logic.js');
  const parts = [
    { id: 'e', name: '二胡' }, { id: 'e1', name: '二胡I', parent_id: 'e' }, { id: 'e2', name: '二胡II', parent_id: 'e' },
    { id: 'z', name: '中胡' }, { id: 'g', name: '高胡' },
  ];
  const scores = [{ part_id: 'g' }, { part_id: null }];
  // 新增聲部：有分部的二胡也能選（加第二個分部）；分部不能選
  assert.deepEqual(parentChoices(null, parts, scores), { options: [['e', '二胡'], ['z', '中胡'], ['g', '高胡']], blocked: null });
  // 分部可以換到別的聲部或移出來，自己不在選項裡
  assert.deepEqual(parentChoices(parts[1], parts, scores).options, [['e', '二胡'], ['z', '中胡'], ['g', '高胡']]);
  assert.deepEqual(parentChoices(parts[3], parts, scores), { options: [['e', '二胡'], ['g', '高胡']], blocked: null });
  // 有分部的聲部、有分譜的聲部：不能選所屬聲部，說明原因
  assert.deepEqual(parentChoices(parts[0], parts, scores).options, []);
  assert.match(parentChoices(parts[0], parts, scores).blocked, /二胡.*有分部/);
  assert.deepEqual(parentChoices(parts[4], parts, scores).options, []);
  assert.match(parentChoices(parts[4], parts, scores).blocked, /高胡.*分譜/);
});

test('加第一個分部：聲部上的排人移到分部，分部已經有的同一人不重複', async () => {
  const { divisiMovePlan } = await import('../js/logic.js');
  const asg = [
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((u) => ({ id: 'x' + u, part_id: 'e', user_id: u })),
    { id: 'xr', part_id: 'e', ringer_id: 'r' },
    { id: 'ya', part_id: 'e1', user_id: 'a' }, { id: 'yr', part_id: 'e1', user_id: 'r' }, { id: 'z', part_id: 'q', user_id: 'b' },
  ];
  const plan = divisiMovePlan('e', 'e1', asg);
  assert.equal(plan.people, 9);
  assert.deepEqual(plan.drop, ['xa']);                         // 阿 a 已經排在 e1
  assert.deepEqual(plan.move, ['xb', 'xc', 'xd', 'xe', 'xf', 'xg', 'xh', 'xr']);  // 槍手 r 與社員 r 是不同人
  // 新建的分部還沒有人；聲部沒排人時什麼都不用移
  assert.deepEqual(divisiMovePlan('e', null, asg).move.length, 9);
  assert.deepEqual(divisiMovePlan('q2', 'e1', asg), { people: 0, drop: [], move: [] });
});

test('刪有分部的聲部：算出會一起刪掉幾個分部、幾人的排人（一人排在好幾個分部算一人）', async () => {
  const { deleteCounts } = await import('../js/logic.js');
  const parts = [{ id: 'p' }, { id: 'p1', parent_id: 'p' }, { id: 'p2', parent_id: 'p' }, { id: 'p3', parent_id: 'p' }, { id: 'q' }];
  const asg = [{ part_id: 'p1', user_id: 'a' }, { part_id: 'p2', user_id: 'a' }, { part_id: 'p3', ringer_id: 'r' }, { part_id: 'q', user_id: 'b' }];
  assert.deepEqual(deleteCounts(parts[0], parts, asg), { divisi: 3, people: 2 });
  assert.deepEqual(deleteCounts(parts[4], parts, asg), { divisi: 0, people: 1 });
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

test('批次上傳：依檔名猜組別', async () => {
  const { guessSection } = await import('../js/logic.js');
  assert.equal(guessSection('春天組曲_梆笛.pdf', '春天組曲'), '吹管');
  assert.equal(guessSection('春天組曲_笛一.pdf'), '吹管');
  assert.equal(guessSection('低音笙.pdf'), '吹管');
  assert.equal(guessSection('泰芙努特_二胡I.pdf', '泰芙努特'), '拉弦');
  assert.equal(guessSection('高胡.pdf'), '拉弦');
  assert.equal(guessSection('大提琴.pdf'), '低音');
  assert.equal(guessSection('低音提琴.pdf'), '低音');
  assert.equal(guessSection('中阮.pdf'), '彈撥');
  assert.equal(guessSection('揚琴.pdf'), '彈撥');
  assert.equal(guessSection('定音鼓.pdf'), '打擊');
  assert.equal(guessSection('Erhu 1.pdf'), '拉弦');
  assert.equal(guessSection('鼓聲_總譜.pdf', '鼓聲'), '總譜');
  assert.equal(guessSection('鼓聲_琵琶.pdf', '鼓聲'), '彈撥');   // 曲名裡的字不算
  assert.equal(guessSection('鍵盤.pdf'), null);
});

test('座位表：依編制自動排位，拉弦在左、彈撥在右、打擊在最後，而且都在舞台內', async () => {
  const { autoSeat, reconcileSeats } = await import('../js/logic.js');
  const parts = [
    { id: 'a', name: '二胡I', sort: 1 }, { id: 'b', name: '琵琶', sort: 2 }, { id: 'c', name: '梆笛', sort: 3 },
    { id: 'd', name: '定音鼓', sort: 4 }, { id: 'e', name: '大提琴', sort: 5 }, { id: 'f', name: '鍵盤', sort: 6 },
  ];
  const asg = [];
  for (const [p, n] of [['a', 6], ['b', 4], ['c', 3], ['d', 2], ['e', 2], ['f', 1]]) for (let i = 0; i < n; i++) asg.push({ part_id: p, user_id: p + i });
  for (const style of ['arc', 'rows']) for (const st of [{ w: 8, d: 6 }, { w: 16, d: 10 }]) {
    const s = autoSeat(parts, asg, { ...st, style });
    assert.equal(s.length, 18);
    const of = (p) => s.filter((x) => x.part === p);
    assert.ok(of('a').every((x) => x.x < 0), `${style} 拉弦在左`);
    assert.ok(of('b').every((x) => x.x > 0), `${style} 彈撥在右`);
    assert.ok(Math.min(...of('d').map((x) => x.y)) >= Math.max(...of('a').map((x) => x.y)), `${style} 打擊在後`);
    assert.ok(s.every((x) => Math.abs(x.x) <= st.w / 2 && x.y > 0 && x.y <= st.d), `${style} 在舞台內`);
    assert.equal(new Set(s.map((x) => x.x + ',' + x.y)).size, 18, `${style} 沒有重疊`);
  }
  const s = autoSeat(parts, asg, { w: 12, d: 8 });
  const r = reconcileSeats(s, parts, [...asg.filter((a) => a.user_id !== 'a0'), { part_id: 'a', user_id: 'new' }]);
  assert.equal(r.seats.length, 17);
  assert.deepEqual(r.missing, [{ k: 'u:new', part: 'a' }]);
});

test('座位表：排在分部的人照分部的組別（等於所屬聲部的）排位置，名稱猜不出組別也一樣', async () => {
  const { autoSeat } = await import('../js/logic.js');
  const parts = [
    { id: 'e', name: '二胡', section: '拉弦', sort: 1 }, { id: 'e1', name: 'I', section: '拉弦', parent_id: 'e', sort: 2 },
    { id: 'p', name: '擊樂2', section: '打擊', sort: 3 }, { id: 'p1', name: '雨柱', section: '打擊', parent_id: 'p', sort: 4 },
    { id: 'y', name: '揚琴', section: '彈撥', sort: 5 },
  ];
  const asg = [{ part_id: 'e1', user_id: 'a' }, { part_id: 'e1', user_id: 'b' }, { part_id: 'p1', user_id: 'c' }, { part_id: 'y', user_id: 'd' }];
  const s = autoSeat(parts, asg, { w: 12, d: 8 });
  const at = (u) => s.find((x) => x.k === 'u:' + u);
  assert.ok(at('a').x < 0 && at('b').x < 0);            // 拉弦在左
  assert.ok(at('c').y > Math.max(at('a').y, at('d').y)); // 打擊在最後
  assert.equal(at('a').part, 'e1');
});

test('需要人數自動換算至少幾人；檔名對到聲部', async () => {
  const { parseNeeded, matchPart, partNameFromFile } = await import('../js/logic.js');
  assert.equal(parseNeeded('2'), 2); assert.equal(parseNeeded('2-3'), 2); assert.equal(parseNeeded('1↑'), 1); assert.equal(parseNeeded(''), 1);
  const parts = [{ id: 'e1', name: '二胡I' }, { id: 'e2', name: '二胡II' }, { id: 'e0', name: '二胡' }, { id: 'd1', name: '笛一' }, { id: 'd2', name: '笛二' }, { id: 'b', name: '梆笛' }, { id: 'q', name: '曲笛' }];
  assert.equal(matchPart('春天組曲_笛一.pdf', parts, '春天組曲'), 'd1');
  assert.equal(matchPart('春天組曲_笛2.pdf', parts, '春天組曲'), 'd2');
  assert.equal(matchPart('春天組曲-梆笛.pdf', parts, '春天組曲'), 'b');
  assert.equal(matchPart('二胡 I.pdf', parts), 'e1');
  assert.equal(matchPart('二胡Ⅱ.pdf', parts), 'e2');
  assert.equal(matchPart('二胡.pdf', parts), 'e0');
  assert.equal(matchPart('春天組曲_總譜.pdf', parts, '春天組曲'), '總譜');
  assert.equal(matchPart('新笛.pdf', parts), null);
  assert.equal(partNameFromFile('春天組曲_新笛.pdf', '春天組曲'), '新笛');
});

test('連結 Discord 回來時讀出「已經綁在另一個帳號」', async () => {
  const { linkErrorFromUrl, LINK_DISCORD_TAKEN } = await import('../js/logic.js');
  const q = 'error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user';
  assert.equal(linkErrorFromUrl('?' + q, '#' + q), LINK_DISCORD_TAKEN);
  assert.equal(linkErrorFromUrl('', '#' + q), LINK_DISCORD_TAKEN);
  assert.equal(linkErrorFromUrl('', '#/me'), null);
  assert.equal(linkErrorFromUrl('?error_code=otp_expired', ''), null);
});

test('leaveText／replyTag：晚到早退時間不露出【】', async () => {
  const { leaveText, replyTag } = await import('../js/logic.js');
  assert.equal(leaveText('late', '【17:06 到】家教'), '晚到 17:06・家教');
  assert.equal(leaveText('early', '【21:00 走】'), '早退 21:00');
  assert.equal(leaveText('leave', '期中考'), '事假・期中考');
  assert.equal(leaveText('sick', ''), '病假');
  assert.equal(replyTag('late'), '已晚到');
  assert.equal(replyTag('sick'), '已請病假');
  assert.equal(replyTag('attend'), '會出席');
});
