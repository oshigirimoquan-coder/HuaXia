// 資料庫規則測試：用 PGlite（瀏覽器版 Postgres）在本機跑 schema.sql，模擬不同身分的人
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const A = '00000000-0000-0000-0000-00000000000a'; // 第一位註冊 → 管理員
const B = '00000000-0000-0000-0000-00000000000b'; // 社員（拉弦）
const R = '00000000-0000-0000-0000-00000000000c'; // 槍手
const S = '11111111-1111-1111-1111-111111111111';
const P1 = '22222222-2222-2222-2222-222222222221', P2 = '22222222-2222-2222-2222-222222222222';
const PT1 = '33333333-3333-3333-3333-333333333331', PT2 = '33333333-3333-3333-3333-333333333332';
const E = (n) => `55555555-5555-5555-5555-55555555555${n}`;

async function as(uid, sql) {
  await db.exec(`reset role; select set_config('test.uid','${uid}',false); set role authenticated;`);
  try { const r = await db.exec(sql); return { rows: r[r.length - 1]?.rows ?? [] }; }
  catch (e) { return { error: e.message, code: e.code }; }
  finally { await db.exec('reset role'); }
}

before(async () => {
  await db.exec(`
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create table auth.identities (user_id uuid, provider text, provider_id text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    create role authenticated; create role anon;
    grant usage on schema public, auth, storage to authenticated, anon;
    alter default privileges in schema public grant all on tables to authenticated, anon;
    alter default privileges in schema public grant execute on functions to authenticated, anon;
    grant all on all tables in schema storage to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  const sql = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace(/create extension[^;]+;/, '');
  await db.exec(sql);
  await db.exec(sql); // 可以重複執行
  await db.exec(`insert into auth.users values ('${A}','a@x','{"full_name":"社長"}'),('${B}','b@x','{"name":"阿B"}'),('${R}','r@x','{}')`);
  await as(A, `update profiles set status='active', section='拉弦' where id='${B}'; insert into user_roles values ('${B}','member');
    update profiles set status='active' where id='${R}'; insert into user_roles values ('${R}','ringer');
    insert into semesters (id,name,starts_on,ends_on,is_current) values ('${S}','114-1','2026-09-01','2027-01-31',true);
    insert into pieces (id,title) values ('${P1}','泰芙努特'),('${P2}','神遊浯洲');
    insert into piece_parts (id,piece_id,name,needed_min) values ('${PT1}','${P1}','二胡I',2),('${PT2}','${P2}','高胡',1);
    insert into ringers (id,name,status,user_id) values ('44444444-4444-4444-4444-444444444444','外校甲','accepted','${R}');
    insert into part_assignments (part_id,user_id) values ('${PT1}','${B}');
    insert into part_assignments (part_id,ringer_id) values ('${PT2}','44444444-4444-4444-4444-444444444444');
    insert into events (id,semester_id,kind,title,starts_at,ends_at,calendar_key) values
      ('${E(1)}','${S}','tutti','大團','2026-09-22 19:30+08','2026-09-22 21:30+08','tutti'),
      ('${E(2)}','${S}','tutti','大團','2026-09-29 19:30+08','2026-09-29 21:30+08','tutti'),
      ('${E(3)}','${S}','sizhu','絲竹','2026-10-06 19:30+08','2026-10-06 21:30+08','tutti'),
      ('${E(4)}','${S}','tutti','大團','2026-12-01 19:30+08','2026-12-01 21:30+08','tutti');
    insert into events (id,semester_id,kind,title,starts_at,ends_at,calendar_key,audience,counts_attendance) values
      ('${E(5)}','${S}','officer','幹部會議','2026-10-01 12:00+08','2026-10-01 13:00+08','officers','officers',false);
    insert into event_pieces values ('${E(3)}','${P2}');
    insert into attendance (event_id,user_id,status) values ('${E(1)}','${B}','late'),('${E(1)}','${A}','present'),('${E(2)}','${A}','present'),('${E(3)}','${A}','present');`);
  await as(B, `insert into leave_requests (event_id,type,reason) values ('${E(2)}','leave','考試')`);
});

test('第一位註冊的人自動成為啟用中的管理員，之後的人待核准', async () => {
  const r = await db.query(`select id, status from profiles order by id`);
  assert.equal(r.rows[0].status, 'active');
  const roles = await db.query(`select role from user_roles where user_id='${A}' order by role`);
  assert.deepEqual(roles.rows.map((x) => x.role), ['admin', 'member']);
});

test('社員不能自己升成管理員，也不能改自己的帳號狀態', async () => {
  assert.match((await as(B, `insert into user_roles values ('${B}','admin')`)).error, /row-level security/);
  assert.match((await as(B, `update profiles set status='inactive' where id='${B}'`)).error, /只有管理員/);
});

test('不能移除最後一位管理員', async () => {
  assert.match((await as(A, `delete from user_roles where user_id='${A}' and role='admin'`)).error, /至少要有一位管理員/);
});

test('出席率：沒預告的晚到算 0.5、請假算缺席、沒排到曲目的場次自動無曲', async () => {
  const { rows } = await as(A, `select * from attendance_stats('${S}')`);
  const b = rows.find((r) => r.user_id === B);
  assert.equal(b.expected_total, 3);      // E1、E2、E4（E3 無曲）
  assert.equal(b.expected_so_far, 2);     // 已點名的 E1、E2
  assert.equal(b.late, 1);
  assert.equal(b.excused, 1);
  assert.equal(Number(b.attended), 0.5);  // E1 晚到但沒事先預告
  assert.equal(Number(b.current_rate), 25);
});

test('事先預告晚到的話，晚到算 1 次出席', async () => {
  await as(B, `insert into leave_requests (event_id,type,reason) values ('${E(1)}','late','家教')`);
  const { rows } = await as(A, `select * from attendance_stats('${S}')`);
  const b = rows.find((r) => r.user_id === B);
  assert.equal(Number(b.attended), 1);
  assert.equal(Number(b.current_rate), 50);
});

test('出席規則改成「請假不列入」後重新計算', async () => {
  await as(A, `update settings set value = jsonb_set(value, '{excused_mode}', '"exclude"') where key='attendance_rules'`);
  const { rows } = await as(A, `select * from attendance_stats('${S}')`);
  assert.equal(Number(rows.find((r) => r.user_id === B).current_rate), 100);
  await as(A, `update settings set value = jsonb_set(value, '{excused_mode}', '"absent"') where key='attendance_rules'`);
});

test('社員只看得到自己的出席率', async () => {
  const { rows } = await as(B, `select user_id from attendance_stats('${S}')`);
  assert.deepEqual(rows.map((r) => r.user_id), [B]);
});

test('社員看不到幹部會議；槍手只看到有自己曲目的行程', async () => {
  assert.deepEqual((await as(B, `select kind from events order by starts_at`)).rows.map((r) => r.kind), ['tutti', 'tutti', 'sizhu', 'tutti']);
  assert.deepEqual((await as(R, `select kind from events`)).rows.map((r) => r.kind), ['sizhu']);
  assert.deepEqual((await as(R, `select title from pieces`)).rows.map((r) => r.title), ['神遊浯洲']);
});

test('幹部事項社員看不到', async () => {
  await as(A, `insert into tasks (title,audience) values ('幹部事','officers'),('大家事','insiders')`);
  assert.deepEqual((await as(B, `select title from tasks`)).rows.map((r) => r.title), ['大家事']);
});

test('社員不能發公告', async () => {
  assert.match((await as(B, `insert into announcements (title) values ('x')`)).error, /row-level security/);
});

test('樂譜只看得到自己的聲部', async () => {
  await as(A, `insert into scores (piece_id,part_id,title,file_path) values ('${P1}','${PT1}','二胡I譜','a'),('${P2}','${PT2}','高胡譜','b')`);
  assert.deepEqual((await as(B, `select title from scores`)).rows.map((r) => r.title), ['二胡I譜']);
  assert.deepEqual((await as(R, `select title from scores`)).rows.map((r) => r.title), ['高胡譜']);
});

test('招生：開放報名時，沒登入的人可以送出，但看不到別人的報名', async () => {
  await as(A, `update settings set value = 'true' where key='recruit_open'`);
  const ins = await as('', `set role anon; insert into applications (name, grade, contact) values ('新同學','資管一','IG: abc')`);
  assert.equal(ins.error, undefined);
  assert.equal((await as('', `set role anon; select * from applications`)).rows.length, 0);
  assert.equal((await as(B, `select * from applications`)).rows.length, 0);
  assert.equal((await as(A, `select name from applications`)).rows[0].name, '新同學');
});

test('招生：關閉報名後不能送出', async () => {
  await as(A, `update settings set value = 'false' where key='recruit_open'`);
  const ins = await as('', `set role anon; insert into applications (name, grade, contact) values ('晚來的','財管一','x')`);
  assert.match(ins.error, /row-level security/);
});

test('頻道：社員可以在「音樂會」分享，但不能在公告、絲竹、校友團發文', async () => {
  assert.equal((await as(B, `insert into announcements (channel,title,venue) values ('concerts','北市國週年音樂會','中山堂')`)).error, undefined);
  for (const ch of ['main', 'sizhu', 'alumni']) {
    assert.match((await as(B, `insert into announcements (channel,title) values ('${ch}','x')`)).error, /row-level security/, ch);
  }
  assert.equal((await as(A, `insert into announcements (channel,title) values ('sizhu','絲竹週四改 721')`)).error, undefined);
});

test('頻道：社員只能刪自己分享的音樂會，幹部都能刪', async () => {
  await as(A, `insert into announcements (channel,title) values ('concerts','幹部分享的')`);
  await as(B, `delete from announcements where channel='concerts' and title='幹部分享的'`);
  assert.equal((await as(A, `select 1 from announcements where title='幹部分享的'`)).rows.length, 1);
  await as(B, `delete from announcements where title='北市國週年音樂會'`);
  assert.equal((await as(A, `select 1 from announcements where title='北市國週年音樂會'`)).rows.length, 0);
});

test('頻道：槍手看不到絲竹與校友團', async () => {
  await as(A, `insert into announcements (channel,title) values ('alumni','校友團年度聚會')`);
  assert.equal((await as(R, `select 1 from announcements where channel in ('sizhu','alumni')`)).rows.length, 0);
  assert.equal((await as(B, `select 1 from announcements where channel in ('sizhu','alumni')`)).rows.length, 2);
});

test('絲竹名單：幹部可以加人，社員只能看', async () => {
  assert.equal((await as(A, `insert into ensemble_members (ensemble,user_id) values ('sizhu','${B}')`)).error, undefined);
  assert.match((await as(B, `insert into ensemble_members (ensemble,user_id) values ('sizhu','${A}')`)).error, /row-level security/);
  assert.equal((await as(B, `select user_id from ensemble_members where ensemble='sizhu'`)).rows.length, 1);
});

test('絲竹標記：公告可以標記人，被標記的人查得到提到自己的訊息', async () => {
  await as(A, `insert into announcements (channel,title,mentions) values ('sizhu','B 段請練熟',array['${B}']::uuid[])`);
  await as(A, `insert into announcements (channel,title,mention_all) values ('sizhu','週四全員到',true)`);
  const { rows } = await as(B, `select title from my_mentions() order by title`);
  assert.deepEqual(rows.map((r) => r.title).sort(), ['B 段請練熟', '週四全員到'].sort());
  assert.equal((await as(R, `select 1 from my_mentions()`)).rows.length, 0);
});

test('行程類型可以複選：主要類型自動取第一個', async () => {
  const r = await as(A, `insert into events (id,semester_id,kinds,title,starts_at,ends_at,calendar_key) values
    ('${E(6)}','${S}',array['dress','concert'],'總彩＋公演','2026-12-10 14:00+08','2026-12-10 21:00+08','tutti') returning kind`);
  assert.equal(r.error, undefined);
  assert.equal(r.rows[0].kind, 'dress');
  const old = await as(A, `select kinds from events where id='${E(1)}'`);
  assert.deepEqual(old.rows[0].kinds, ['tutti']);  // 舊資料自動補上
});

test('複選類型：只要符合其中一種就算應出席（幹部會議＋拉弦分部課）', async () => {
  await as(A, `insert into events (id,semester_id,kinds,section,title,starts_at,ends_at,calendar_key) values
    ('${E(7)}','${S}',array['officer','sectional'],'拉弦','幹部＋拉弦','2026-10-20 12:00+08','2026-10-20 13:00+08','officers')`);
  const { rows } = await as(A, `select p.id, public.is_expected(e, p.id) as ok from events e, profiles p where e.id='${E(7)}' order by p.id`);
  const ok = Object.fromEntries(rows.map((x) => [x.id, x.ok]));
  assert.equal(ok[A], true);   // 幹部
  assert.equal(ok[B], true);   // 拉弦
  assert.equal(ok[R], false);  // 槍手
});

test('分部課可以好幾組一起上：組別自動取第一組，任一組的人都算應出席', async () => {
  const E2 = (n) => `55555555-5555-5555-5555-5555555555a${n}`;
  const r = await as(A, `insert into events (id,semester_id,kinds,sections,title,starts_at,ends_at,calendar_key) values
    ('${E2(1)}','${S}',array['sectional'],array['彈撥','拉弦'],'彈撥＋拉弦','2026-11-22 10:00+08','2026-11-22 12:00+08','tutti'),
    ('${E2(2)}','${S}',array['sectional'],array['彈撥','低音'],'彈撥＋低音','2026-11-22 10:00+08','2026-11-22 12:00+08','tutti') returning section`);
  assert.equal(r.error, undefined);
  assert.equal(r.rows[0].section, '彈撥');
  const old = await as(A, `insert into events (id,semester_id,kinds,section,title,starts_at,ends_at,calendar_key) values
    ('${E2(3)}','${S}',array['sectional'],'打擊','打擊','2026-11-22 10:00+08','2026-11-22 12:00+08','tutti') returning sections`);
  assert.deepEqual(old.rows[0].sections, ['打擊']);  // 只填一組也可以
  const exp = async (n) => (await as(A, `select public.is_expected(e, '${B}') as ok from events e where e.id='${E2(n)}'`)).rows[0].ok;
  assert.equal(await exp(1), true);   // 阿B 是拉弦
  assert.equal(await exp(2), false);
});

test('可以事先確認出席，不會被當成請假', async () => {
  const ok = await as(B, `insert into leave_requests (event_id,type) values ('${E(7)}','attend') returning type`);
  assert.equal(ok.error, undefined);
  const bad = await as(B, `insert into leave_requests (event_id,type) values ('${E(7)}','maybe')`);
  assert.ok(bad.error);
  await as(B, `delete from leave_requests where event_id='${E(7)}'`);
});

test('絲竹排練沒指定曲目時，只有絲竹名單上的人算應出席', async () => {
  await as(A, `insert into events (id,semester_id,kinds,title,starts_at,ends_at,calendar_key) values
    ('${E(8)}','${S}',array['sizhu'],'絲竹排練','2026-10-22 19:00+08','2026-10-22 21:00+08','tutti')`);
  const { rows } = await as(A, `select p.id, public.is_expected(e, p.id) as ok from events e, profiles p where e.id='${E(8)}'`);
  const ok = Object.fromEntries(rows.map((x) => [x.id, x.ok]));
  assert.equal(ok[B], true);   // 在絲竹名單
  assert.equal(ok[A], false);  // 不在
});

test('公告分類：社員可以分享「資源」，但不能發大團、華夏演出', async () => {
  assert.equal((await as(B, `insert into announcements (channel,title,link) values ('resources','二胡換把教學','https://x')`)).error, undefined);
  for (const ch of ['tutti', 'performance']) {
    assert.match((await as(B, `insert into announcements (channel,title) values ('${ch}','x')`)).error, /row-level security/, ch);
  }
});

test('公告分類：舊版的「公告」自動轉成新分類（演出→華夏演出、教學班→教學班、其他→大團）', async () => {
  const r = await as(A, `insert into announcements (channel,type,title) values ('main','performance','舊演出'),('main','class','舊教學'),('main','practice','舊練習') returning title, channel`);
  const m = Object.fromEntries(r.rows.map((x) => [x.title, x.channel]));
  assert.deepEqual(m, { 舊演出: 'performance', 舊教學: 'class', 舊練習: 'tutti' });
});

test('對象選「絲竹」：大家都看得到，絲竹成員會被提醒', async () => {
  await as(A, `insert into announcements (channel,audience,title) values ('sizhu','sizhu','對象絲竹的公告')`);
  assert.equal((await as(B, `select 1 from my_mentions() where title='對象絲竹的公告'`)).rows.length, 1);  // B 在絲竹名單
  assert.equal((await as(B, `select 1 from announcements where title='對象絲竹的公告'`)).rows.length, 1);
  assert.equal((await as(R, `select 1 from announcements where title='對象絲竹的公告'`)).rows.length, 0); // 槍手看不到
});

test('Discord ID 對照只有後端能查，一般登入者不能呼叫', async () => {
  assert.match((await as(B, `select * from discord_ids(array['${B}']::uuid[])`)).error, /permission denied/);
});

test('別人看不到我的手機與信箱', async () => {
  assert.equal((await as(B, `select * from profile_private where user_id='${A}'`)).rows.length, 0);
});

test('校友：看得到社內行程；只有排進當天編制才算應出席', async () => {
  const AL = '00000000-0000-0000-0000-0000000000a1';
  await db.exec(`insert into auth.users values ('${AL}','al@x','{}')`);
  await as(A, `update profiles set status='active' where id='${AL}'; insert into user_roles values ('${AL}','alumni');
    insert into events (id,semester_id,kinds,title,starts_at,ends_at,calendar_key) values
      ('${E(9)}','${S}',array['tutti'],'大團（泰芙努特）','2026-11-03 19:30+08','2026-11-03 21:30+08','tutti');
    insert into event_pieces values ('${E(9)}','${P1}');`);
  assert.ok((await as(AL, `select id from events where id='${E(1)}'`)).rows.length === 1);
  const exp = async (n) => (await as(A, `select public.is_expected(e, '${AL}') as ok from events e where e.id='${E(n)}'`)).rows[0].ok;
  assert.equal(await exp(1), false);  // 沒排曲目的大團：不算
  assert.equal(await exp(9), false);  // 有曲目但沒排到他
  await as(A, `insert into part_assignments (part_id,user_id) values ('${PT1}','${AL}')`);
  assert.equal(await exp(9), true);   // 排進編制就算
});

test('分組樂譜：社員看自己那組；槍手看排到的曲子裡同組的譜', async () => {
  assert.equal((await as(A, `select section from piece_parts where id='${PT2}'`)).rows[0].section, '拉弦'); // 高胡 → 自動判斷
  await as(A, `insert into scores (piece_id,section,title) values ('${P1}','拉弦','P1拉弦'),('${P1}','吹管','P1吹管'),('${P2}','拉弦','P2拉弦')`);
  const t = async (u) => (await as(u, `select title from scores where section is not null order by title`)).rows.map((r) => r.title);
  assert.deepEqual(await t(B), ['P1拉弦', 'P2拉弦']);
  assert.deepEqual(await t(R), ['P2拉弦']);
  assert.equal((await t(A)).length, 3);
});

test('工具連結：已預設一筆，社員看得到但不能改', async () => {
  assert.equal((await as(B, `select value from settings where key='tools'`)).rows[0].value[0].url.includes('netlify'), true);
  await as(B, `update settings set value='[]' where key='tools'`);
  assert.equal((await as(A, `select jsonb_array_length(value) n from settings where key='tools'`)).rows[0].n, 1);
});

test('排人：組長可以排自己組的聲部，不能排別組；座位表組長可以存', async () => {
  const L = '00000000-0000-0000-0000-0000000000b2';
  await db.exec(`insert into auth.users values ('${L}','l@x','{}')`);
  await as(A, `update profiles set status='active', section='拉弦' where id='${L}'; insert into user_roles values ('${L}','member'),('${L}','leader');
    insert into piece_parts (id,piece_id,name) values ('33333333-3333-3333-3333-333333333339','${P1}','梆笛')`);
  assert.equal((await as(L, `insert into part_assignments (part_id,user_id) values ('${PT1}','${L}')`)).error, undefined);           // 二胡I（拉弦）
  assert.ok((await as(L, `insert into part_assignments (part_id,user_id) values ('33333333-3333-3333-3333-333333333339','${L}')`)).error); // 梆笛（吹管）
  assert.ok((await as(B, `insert into part_assignments (part_id,user_id) values ('${PT2}','${B}')`)).error);                         // 一般社員不行
  assert.equal((await as(L, `insert into seating_charts (piece_id, seats) values ('${P1}', '[]')`)).error, undefined);
  assert.ok((await as(B, `update seating_charts set seats='[1]' where piece_id='${P1}' returning piece_id`)).rows.length === 0);
  assert.equal((await as(B, `select piece_id from seating_charts`)).rows.length, 1);
});

test('總譜：絲竹曲目只有排進那首曲子的人看得到；大團曲目只有組長、聲部長看得到', async () => {
  const L = '00000000-0000-0000-0000-0000000000b2'; // 前面測試建立的拉弦組長
  await as(A, `insert into scores (piece_id,title) values ('${P1}','P1總譜'),('${P2}','P2總譜'); update pieces set ensemble='sizhu' where id='${P2}'`);
  const t = async (u) => (await as(u, `select title from scores where part_id is null and section is null order by title`)).rows.map((r) => r.title);
  assert.deepEqual(await t(B), []);                    // 一般社員沒排進 P2（絲竹）：看不到
  assert.deepEqual(await t(R), ['P2總譜']);            // 槍手排進 P2
  assert.deepEqual(await t(L), ['P1總譜']);            // 組長：大團的看得到，沒排進的絲竹曲目看不到
  await as(A, `insert into part_assignments (part_id,user_id) values ('${PT2}','${B}')`);
  assert.deepEqual(await t(B), ['P2總譜']);            // 排進 P2 之後看得到
  await as(A, `delete from part_assignments where part_id='${PT2}' and user_id='${B}'`);
  await as(A, `update piece_parts set tutor_id='${B}' where id='${PT1}'`);
  assert.deepEqual(await t(B), ['P1總譜']);            // 當上 P1 的聲部長
});

// ---------- 分部：聲部底下可以再分排人的單位（piece_parts.parent_id），只分兩層 ----------
const P5 = '22222222-2222-2222-2222-222222222225';
const D = (n) => `77777777-7777-7777-7777-7777777777${String(n).padStart(2, '0')}`;
const parentOf = async (id) => (await as(A, `select parent_id from piece_parts where id='${id}'`)).rows[0].parent_id;

test('分部：只有兩層，分部與所屬聲部同一首曲目', async () => {
  await as(A, `insert into pieces (id,title) values ('${P5}','難忘的潑水節');
    insert into piece_parts (id,piece_id,name) values ('${D(1)}','${P5}','打擊'),('${D(2)}','${P5}','定音鼓'),('${D(3)}','${P5}','云鑼'),
      ('${D(4)}','${P5}','排鼓'),('${D(5)}','${P1}','梆笛');`);
  assert.equal((await as(A, `update piece_parts set parent_id='${D(1)}' where id in ('${D(2)}','${D(3)}')`)).error, undefined);
  assert.equal(await parentOf(D(2)), D(1));
  const rejected = [
    [`insert into piece_parts (piece_id,name,parent_id) values ('${P5}','定音鼓 1','${D(2)}')`, /分部不能再分出分部/],  // 分部底下再分
    [`update piece_parts set parent_id='${D(4)}' where id='${D(1)}'`, /有分部的聲部不能/],                         // 有分部的聲部被收進別的聲部
    [`update piece_parts set parent_id='${D(5)}' where id='${D(4)}'`, /同一首曲目/],                               // 別首曲目的聲部
    [`update piece_parts set parent_id='${D(4)}' where id='${D(4)}'`, /自己/],                                     // 自己
  ];
  for (const [sql, why] of rejected) {
    const r = await as(A, sql);
    assert.match(r.error ?? '', why, sql);
    assert.equal(r.code, '23514', sql);
  }
  assert.equal(await parentOf(D(1)), null);
  assert.equal(await parentOf(D(4)), null);
  assert.equal((await as(A, `select 1 from piece_parts where name='定音鼓 1'`)).rows.length, 0);
});

test('分部：樂譜只掛在聲部、排人只排在分部；已有樂譜或排人時也不能收成分部', async () => {
  // D(1) 打擊 有分部 D(2) 定音鼓、D(3) 云鑼；D(4) 排鼓 還是獨立聲部
  const rejected = [
    [`insert into scores (piece_id,part_id,title) values ('${P5}','${D(2)}','定音鼓')`, /分部不能有樂譜/],
    [`insert into part_assignments (part_id,user_id) values ('${D(1)}','${B}')`, /有分部的聲部不能排人/],
  ];
  // 排鼓 先掛了樂譜：不能收成分部，也不能把樂譜改掛到分部
  const sc = (await as(A, `insert into scores (piece_id,part_id,title) values ('${P5}','${D(4)}','排鼓') returning id`)).rows[0].id;
  rejected.push([`update piece_parts set parent_id='${D(1)}' where id='${D(4)}'`, /有樂譜/]);
  rejected.push([`update scores set part_id='${D(3)}' where id='${sc}'`, /分部不能有樂譜/]);
  // 排鼓 排了人：不能替它加分部
  assert.equal((await as(A, `insert into part_assignments (part_id,user_id) values ('${D(4)}','${B}'),('${D(2)}','${B}')`)).error, undefined);
  rejected.push([`insert into piece_parts (piece_id,name,parent_id) values ('${P5}','排鼓 I','${D(4)}')`, /排了人/]);
  for (const [sql, why] of rejected) {
    const r = await as(A, sql);
    assert.match(r.error ?? '', why, sql);
    assert.equal(r.code, '23514', sql);
  }
  assert.equal((await as(A, `select 1 from scores where part_id in ('${D(1)}','${D(2)}','${D(3)}')`)).rows.length, 0);
  assert.equal((await as(A, `select 1 from part_assignments where part_id='${D(1)}'`)).rows.length, 0);
  assert.equal(await parentOf(D(4)), null);
  assert.equal((await as(A, `select 1 from piece_parts where name='排鼓 I'`)).rows.length, 0);
  await as(A, `delete from scores where id='${sc}'; delete from part_assignments where part_id='${D(4)}'`);
});

test('分部：聲部組跟著所屬聲部', async () => {
  const sec = async (id) => (await as(A, `select section from piece_parts where id='${id}'`)).rows[0].section;
  await as(A, `insert into piece_parts (id,piece_id,name,parent_id) values ('${D(6)}','${P5}','雨柱','${D(1)}');
    insert into piece_parts (id,piece_id,name,section) values ('${D(7)}','${P5}','沙球','低音')`);
  assert.equal(await sec(D(6)), '打擊');                   // 新建的分部
  await as(A, `update piece_parts set parent_id='${D(1)}' where id='${D(7)}'`);
  assert.equal(await sec(D(7)), '打擊');                   // 收成分部
  await as(A, `update piece_parts set section='彈撥' where id='${D(1)}'`);
  assert.deepEqual((await as(A, `select distinct section from piece_parts where parent_id='${D(1)}'`)).rows, [{ section: '彈撥' }]);  // 聲部改組
  await as(A, `update piece_parts set section='吹管' where id='${D(6)}'`);
  assert.equal(await sec(D(6)), '彈撥');                   // 分部自己改不了
  await as(A, `update piece_parts set parent_id=null where id='${D(7)}'; update piece_parts set section='低音' where id='${D(7)}'`);
  assert.equal(await sec(D(7)), '低音');                   // 變回獨立聲部就自己決定
  await as(A, `update piece_parts set section='打擊' where id='${D(1)}'; delete from piece_parts where id='${D(7)}'`);
});

test('分部：排在任一個分部的人讀得到所屬聲部的分譜，讀不到別的聲部的', async () => {
  // 阿B 排在 定音鼓（打擊的分部）；槍手排在 云鑼（打擊的分部）
  await as(A, `insert into part_assignments (part_id,ringer_id) values ('${D(3)}','44444444-4444-4444-4444-444444444444');
    insert into scores (piece_id,part_id,title) values ('${P5}','${D(1)}','打擊分譜'),('${P5}','${D(4)}','排鼓分譜')`);
  const t = async (u) => (await as(u, `select title from scores where piece_id='${P5}' and part_id is not null order by title`)).rows.map((r) => r.title);
  assert.deepEqual(await t(B), ['打擊分譜']);
  assert.deepEqual(await t(R), ['打擊分譜']);
  assert.deepEqual(await t(A), ['打擊分譜', '排鼓分譜']);
});

test('分部：聲部長設在聲部上，就能替它的分部排人、看分部的練習回報', async () => {
  const T = '00000000-0000-0000-0000-00000000002a';
  await db.exec(`insert into auth.users values ('${T}','t@x','{"name":"打擊小老師"}')`);
  await as(A, `update profiles set status='active' where id='${T}'; insert into user_roles values ('${T}','member');
    update piece_parts set tutor_id='${T}' where id='${D(1)}'`);
  assert.equal((await as(T, `insert into part_assignments (part_id,user_id) values ('${D(6)}','${B}')`)).error, undefined);  // 雨柱（打擊的分部）
  assert.ok((await as(T, `insert into part_assignments (part_id,user_id) values ('${D(4)}','${B}')`)).error);               // 排鼓（別的聲部）
  await as(B, `insert into practice_reports (piece_id,part_id,title) values ('${P5}','${D(2)}','定音鼓練習'),('${P5}','${D(4)}','排鼓練習')`);
  assert.deepEqual((await as(T, `select title from practice_reports where piece_id='${P5}'`)).rows.map((r) => r.title), ['定音鼓練習']);
});

test('分部：刪聲部連分部、分部的排人與聲部的樂譜一起刪，別的聲部不動', async () => {
  const kids = [D(2), D(3), D(6)].map((x) => `'${x}'`).join(',');
  assert.equal((await as(A, `select 1 from part_assignments where part_id in (${kids})`)).rows.length, 3);
  assert.equal((await as(A, `delete from piece_parts where id='${D(1)}'`)).error, undefined);
  assert.deepEqual((await as(A, `select id from piece_parts where piece_id='${P5}'`)).rows.map((r) => r.id), [D(4)]);
  assert.equal((await as(A, `select 1 from part_assignments where part_id in (${kids})`)).rows.length, 0);
  assert.deepEqual((await as(A, `select title from scores where piece_id='${P5}'`)).rows.map((r) => r.title), ['排鼓分譜']);
});

// 網頁的聲部表單（js/views/pieces.js 的 saveFirstDivisi）照 divisiMovePlan 的順序寫入
test('分部：替已排 8 人的聲部加第一個分部，人移到分部後聲部上沒有排人；照錯的順序會被擋', async () => {
  const { divisiMovePlan } = await import('../js/logic.js');
  const P8 = '22222222-2222-2222-2222-222222222228';
  const RG = (n) => `88888888-8888-8888-8888-88888888888${n}`;
  await as(A, `insert into pieces (id,title) values ('${P8}','春天組曲');
    insert into piece_parts (id,piece_id,name,needed_min) values ('${D(30)}','${P8}','二胡',8),('${D(31)}','${P8}','二胡II',4);
    insert into ringers (id,name,status) values ${[1, 2, 3, 4, 5, 6, 7].map((n) => `('${RG(n)}','外校${n}','accepted')`).join(',')};
    insert into part_assignments (part_id,user_id) values ('${D(30)}','${B}'),('${D(31)}','${B}');
    insert into part_assignments (part_id,ringer_id) values ${[1, 2, 3, 4, 5, 6, 7].map((n) => `('${D(30)}','${RG(n)}')`).join(',')}`);
  const asgOf = async () => (await as(A, `select id,part_id,user_id,ringer_id from part_assignments where part_id in ('${D(30)}','${D(31)}','${D(32)}')`)).rows;
  // 直接建成分部會被擋：聲部上還有人
  assert.match((await as(A, `insert into piece_parts (piece_id,name,parent_id) values ('${P8}','二胡I','${D(30)}')`)).error ?? '', /排了人/);
  // 新建分部：先建成獨立聲部，再移人，最後設所屬聲部
  const plan = divisiMovePlan(D(30), null, await asgOf());
  assert.equal(plan.people, 8);
  const steps = (child, p) => [
    p.drop.length && `delete from part_assignments where id in (${p.drop.map((x) => `'${x}'`).join(',')})`,
    p.move.length && `update part_assignments set part_id='${child}' where id in (${p.move.map((x) => `'${x}'`).join(',')})`,
    `update piece_parts set parent_id='${D(30)}' where id='${child}'`,
  ].filter(Boolean);
  assert.equal((await as(A, `insert into piece_parts (id,piece_id,name,needed_min) values ('${D(32)}','${P8}','二胡I',4)`)).error, undefined);
  for (const sql of steps(D(32), plan)) assert.equal((await as(A, sql)).error, undefined, sql);
  const after = await asgOf();
  assert.equal(after.filter((a) => a.part_id === D(30)).length, 0);
  assert.equal(after.filter((a) => a.part_id === D(32)).length, 8);
  assert.equal(await parentOf(D(32)), D(30));
  // 再把現有的二胡II 收進來：聲部已經有分部、沒有排人，不用移；阿B 同時在 I 與 II
  assert.deepEqual(divisiMovePlan(D(30), D(31), after), { people: 0, drop: [], move: [] });
  assert.equal((await as(A, `update piece_parts set parent_id='${D(30)}' where id='${D(31)}'`)).error, undefined);
  assert.equal((await asgOf()).filter((a) => a.user_id === B).length, 2);
});

// ---------- 泠靈發譜函式（docs/LINGLING.md） ----------
const P3 = '22222222-2222-2222-2222-222222222223', P4 = '22222222-2222-2222-2222-222222222224';
const llPath = (piece, c, slot = 'score') => `lingling/${piece}/${c.repeat(64)}-${slot}.pdf`;
const publish = (uid, payload) => as(uid, `select lingling_publish('${JSON.stringify({ version: 3, ...payload }).replace(/'/g, "''")}'::jsonb) as r`);
test('公告照片：只能上傳到自己的資料夾；看得到那則公告的人才看得到照片；最多 9 張', async () => {
  await db.exec('alter table storage.objects enable row level security');
  try {
    const put = (u, name) => as(u, `insert into storage.objects (bucket_id,name) values ('photos','${name}')`);
    assert.equal((await put(B, `${B}/b1.jpg`)).error, undefined);           // 自己的資料夾
    assert.ok((await put(B, `${A}/fake.jpg`)).error);                       // 別人的資料夾
    assert.ok((await put(R, `${R}/r1.jpg`)).error);                         // 槍手不能上傳
    assert.equal((await put(A, `${A}/p1.jpg`)).error, undefined);
    const see = async (u) => (await as(u, `select name from storage.objects where bucket_id='photos' and name='${A}/p1.jpg'`)).rows.length;
    assert.equal(await see(B), 0);                                          // 還沒放進任何公告
    await as(A, `insert into announcements (id,channel,title,audience,photos) values ('66666666-6666-6666-6666-666666666661','tutti','幹部照片','officers',array['${A}/p1.jpg'])`);
    assert.equal(await see(B), 0);                                          // 公告只給幹部 → 社員看不到照片
    await as(A, `update announcements set audience='insiders' where id='66666666-6666-6666-6666-666666666661'`);
    assert.equal(await see(B), 1);                                          // 改成全體社員 → 看得到
    assert.equal(await see(R), 0);                                          // 槍手看不到社內公告的照片
    assert.ok((await as(B, `delete from storage.objects where bucket_id='photos' and name='${A}/p1.jpg' returning name`)).rows?.length !== 1); // 不能刪別人的
    const ten = Array.from({ length: 10 }, (_, i) => `'${A}/x${i}.jpg'`).join(',');
    assert.ok((await as(A, `insert into announcements (channel,title,photos) values ('tutti','太多張',array[${ten}])`)).error);
  } finally {
    await db.exec('alter table storage.objects disable row level security');
  }
});

test('一個人可以同時在好幾組：分部課、組內公告、組長排人都算進去', async () => {
  const C = '00000000-0000-0000-0000-00000000000d';
  await db.exec(`insert into auth.users values ('${C}','c@x','{"name":"阿C"}')`);
  await as(A, `update profiles set status='active', sections=array['彈撥','打擊'] where id='${C}'; insert into user_roles values ('${C}','member')`);
  assert.equal((await as(A, `select section from profiles where id='${C}'`)).rows[0].section, '彈撥');   // 主要組別＝第一組
  assert.ok((await as(C, `update profiles set sections=array['吹管'] where id='${C}'`)).error);          // 自己不能改組別
  // 分部課：打擊的也要到
  const EV = '55555555-5555-5555-5555-5555555555b1';
  await as(A, `insert into events (id,semester_id,kinds,sections,title,starts_at,ends_at,calendar_key) values ('${EV}','${S}',array['sectional'],array['打擊'],'打擊分部','2026-11-22 10:00+08','2026-11-22 12:00+08','tutti')`);
  assert.equal((await as(A, `select public.is_expected(e, '${C}') as ok from events e where e.id='${EV}'`)).rows[0].ok, true);
  // 組內公告：發給打擊組的也看得到
  await as(A, `insert into announcements (channel,title,audience,section) values ('tutti','打擊組公告','section','打擊')`);
  assert.equal((await as(C, `select 1 from announcements where title='打擊組公告'`)).rows.length, 1);
  assert.equal((await as(B, `select 1 from announcements where title='打擊組公告'`)).rows.length, 0);  // 拉弦的看不到
  // 舊版畫面只改 section：sections 跟著換
  await as(A, `update profiles set section='低音' where id='${C}'`);
  assert.deepEqual((await as(A, `select sections from profiles where id='${C}'`)).rows[0].sections, ['低音']);
});

test('永久管理員：網站上不能拿掉管理員身分、不能停用；名單也不能從網站改；SQL Editor 可以解除', async () => {
  const P = '00000000-0000-0000-0000-00000000000e';
  await db.exec(`insert into auth.users values ('${P}','p@x','{"name":"永久"}')`);
  await as(A, `update profiles set status='active' where id='${P}'; insert into user_roles values ('${P}','member'),('${P}','admin')`);
  assert.ok((await as(A, `insert into protected_admins (user_id) values ('${P}')`)).error);          // 網站上不能加名單
  await db.exec(`insert into protected_admins (user_id) values ('${P}')`);                           // SQL Editor 加
  assert.match((await as(A, `delete from user_roles where user_id='${P}' and role='admin'`)).error, /永久管理員/);
  assert.match((await as(A, `update user_roles set role='member' where user_id='${P}' and role='admin'`)).error || '', /永久管理員|duplicate/);
  assert.match((await as(A, `update profiles set status='inactive' where id='${P}'`)).error, /永久管理員/);
  assert.equal((await as(A, `update profiles set officer_title='社長' where id='${P}'`)).error, undefined);  // 其他欄位照常能改
  assert.ok((await as(P, `delete from protected_admins where user_id='${P}'`)).rows?.length !== 1);  // 自己也不能從網站移出名單
  assert.equal((await as(A, `select 1 from user_roles where user_id='${P}' and role='admin'`)).rows.length, 1);
  await db.exec(`delete from protected_admins where user_id='${P}'`);                                // SQL Editor 解除
  assert.equal((await as(A, `delete from user_roles where user_id='${P}' and role='admin'`)).error, undefined);
});

test('點名：各組組長可以幫全團點名，看得到全團名單與請假；一般社員不行', async () => {
  const Ld = '00000000-0000-0000-0000-00000000001a', Mb = '00000000-0000-0000-0000-00000000001b';
  await db.exec(`insert into auth.users values ('${Ld}','ld@x','{"name":"吹管組長"}'),('${Mb}','mb@x','{"name":"彈撥社員"}')`);
  await as(A, `update profiles set status='active', sections=array['吹管'] where id='${Ld}'; update profiles set status='active', sections=array['彈撥'] where id='${Mb}';
    insert into user_roles values ('${Ld}','member'),('${Ld}','leader'),('${Mb}','member')`);
  const EV = '55555555-5555-5555-5555-5555555555c1';
  await as(A, `insert into events (id,semester_id,kinds,title,starts_at,ends_at,calendar_key) values ('${EV}','${S}',array['tutti'],'大團點名測試','2026-11-03 19:30+08','2026-11-03 21:30+08','tutti')`);
  await as(Mb, `insert into leave_requests (event_id,type,reason) values ('${EV}','late','上課')`);
  const roster = (await as(Ld, `select user_id, leave_type from public.event_roster('${EV}')`)).rows;
  assert.ok(roster.some((r) => r.user_id === Mb && r.leave_type === 'late'));        // 看得到別組的人與請假
  assert.equal((await as(Ld, `insert into attendance (event_id,user_id,status) values ('${EV}','${Mb}','late')`)).error, undefined);  // 可以點別組
  assert.equal((await as(Ld, `select status from attendance where event_id='${EV}' and user_id='${Mb}'`)).rows[0].status, 'late');
  assert.ok((await as(Mb, `insert into attendance (event_id,user_id,status) values ('${EV}','${Ld}','present')`)).error);  // 社員不能點名
});

test('頭像：只能上傳到自己的資料夾，不能刪別人的', async () => {
  await db.exec('alter table storage.objects enable row level security');
  try {
    assert.equal((await as(B, `insert into storage.objects (bucket_id,name) values ('avatars','${B}/a.jpg')`)).error, undefined);
    assert.ok((await as(B, `insert into storage.objects (bucket_id,name) values ('avatars','${A}/a.jpg')`)).error);
    await db.exec(`insert into storage.objects (bucket_id,name) values ('avatars','${A}/mine.jpg')`);
    await as(B, `delete from storage.objects where bucket_id='avatars' and name='${A}/mine.jpg'`);
    assert.equal((await db.exec(`select 1 from storage.objects where name='${A}/mine.jpg'`))[0].rows.length, 1);
  } finally { await db.exec('alter table storage.objects disable row level security'); }
});

const upload = (...paths) => db.exec(`insert into storage.objects (bucket_id, name) values ${paths.map((p) => `('scores','${p}')`).join(',')}`);

test('泠靈發譜：版本查詢回傳 3，舊版（2）的泠靈被擋；登入的人才能呼叫，版本不符時整個不做', async () => {
  assert.equal((await as(A, `select lingling_publish_version() as v`)).rows[0].v, 3);
  assert.equal((await as(B, `select lingling_publish_version() as v`)).rows[0].v, 3);
  assert.match((await as('', `set role anon; select lingling_publish_version()`)).error, /permission denied for function lingling_publish_version$/);
  assert.match((await as('', `set role anon; select lingling_publish('{}'::jsonb)`)).error, /permission denied for function lingling_publish$/);
  const r = await as(A, `select lingling_publish('{"version":2,"piece_id":"${P3}","new_piece":{"title":"新曲"}}'::jsonb)`);
  assert.match(r.error, /介面版本/);
  assert.equal(r.code, 'PT409');
  assert.equal((await as(A, `select 1 from pieces where id='${P3}'`)).rows.length, 0);
});

test('泠靈發譜：新建曲目、聲部、樂譜與掛場次一次完成；重跑沿用同一首、不重複掛', async () => {
  await upload(llPath(P3, 'a'), llPath(P3, 'b'));
  const payload = {
    piece_id: P3, new_piece: { title: '春江花月夜', composer: '佚名', duration_min: 7.5, ensemble: 'tutti' },
    create_parts: [{ name: '二胡 I', needed: '6-8', needed_min: 6, section: '', sort: 1 }, { name: '琵琶', needed: '2↑', needed_min: 2, section: '彈撥', sort: 2 }],
    add_scores: [{ new_part: '二胡 I', title: '二胡 I', file_path: llPath(P3, 'a') }, { part_id: null, title: '總譜', file_path: llPath(P3, 'b') }],
    attach_events: [E(4)],
  };
  const { rows, error } = await publish(A, payload);
  assert.equal(error, undefined);
  const out = rows[0].r;
  assert.equal(out.version, 3);
  assert.equal(out.piece_id, P3);
  assert.equal(out.piece_created, true);
  assert.deepEqual(out.created_parts.map((p) => [p.name, p.absorbed]), [['二胡 I', []], ['琵琶', []]]);
  const erhu = out.created_parts[0].id;
  assert.deepEqual(out.added_scores.map((s) => [s.part_id, s.file_path]), [[erhu, llPath(P3, 'a')], [null, llPath(P3, 'b')]]);
  assert.deepEqual(out.removed_scores, []);
  assert.deepEqual(out.attached_events, [E(4)]);
  const parts = (await as(A, `select name, needed, needed_min, section from piece_parts where piece_id='${P3}' order by sort`)).rows;
  assert.deepEqual(parts, [{ name: '二胡 I', needed: '6-8', needed_min: 6, section: '拉弦' }, { name: '琵琶', needed: '2↑', needed_min: 2, section: '彈撥' }]);
  const again = await publish(A, { piece_id: P3, new_piece: payload.new_piece, attach_events: [E(4)] });
  assert.equal(again.rows[0].r.piece_created, false);
  assert.deepEqual(again.rows[0].r.attached_events, []);
  assert.equal((await as(A, `select 1 from pieces where id='${P3}'`)).rows.length, 1);
  assert.equal((await as(A, `select 1 from event_pieces where piece_id='${P3}'`)).rows.length, 1);
});

test('泠靈發譜：改人數與聲部組、取代樂譜；已經不在的登記略過，回傳實際撤掉的', async () => {
  const erhu = (await as(A, `select id from piece_parts where piece_id='${P3}' and name='二胡 I'`)).rows[0].id;
  const old = (await as(A, `select id from scores where piece_id='${P3}' and part_id='${erhu}'`)).rows[0].id;
  await upload(llPath(P3, 'c'));
  const { rows, error } = await publish(A, {
    piece_id: P3, update_parts: [{ id: erhu, needed: '4', needed_min: 4 }],
    remove_scores: [old, '99999999-9999-9999-9999-999999999999'],
    add_scores: [{ part_id: erhu, title: '二胡 I', file_path: llPath(P3, 'c') }],
  });
  assert.equal(error, undefined);
  assert.deepEqual(rows[0].r.removed_scores, [{ id: old, part_id: erhu, file_path: llPath(P3, 'a') }]);
  // 沒給 sort：順序不動
  assert.deepEqual((await as(A, `select needed, needed_min, section, sort from piece_parts where id='${erhu}'`)).rows[0], { needed: '4', needed_min: 4, section: '拉弦', sort: 1 });
  assert.deepEqual((await as(A, `select file_path from scores where part_id='${erhu}'`)).rows.map((x) => x.file_path), [llPath(P3, 'c')]);
});

test('泠靈發譜：update_parts 給了 sort 才改順序（照泠靈的樂器表重排），只給 sort 時人數與聲部組不動', async () => {
  const order = async () => (await as(A, `select name from piece_parts where piece_id='${P3}' and parent_id is null order by sort`)).rows.map((x) => x.name);
  assert.deepEqual(await order(), ['二胡 I', '琵琶']);
  const id = async (name) => (await as(A, `select id from piece_parts where piece_id='${P3}' and name='${name}'`)).rows[0].id;
  const erhu = await id('二胡 I'), pipa = await id('琵琶');
  const { error } = await publish(A, { piece_id: P3, update_parts: [{ id: pipa, sort: 1 }, { id: erhu, sort: 2, needed: null }] });
  assert.equal(error, undefined);
  assert.deepEqual(await order(), ['琵琶', '二胡 I']);
  assert.deepEqual((await as(A, `select needed, needed_min, section from piece_parts where id='${erhu}'`)).rows[0], { needed: '4', needed_min: 4, section: '拉弦' });
  assert.deepEqual((await as(A, `select needed, section from piece_parts where id='${pipa}'`)).rows[0], { needed: '2↑', section: '彈撥' });
});

test('泠靈發譜：只撤這首曲目泠靈發的登記，要撤別人放的或別首曲目的就整個不做', async () => {
  const erhu = (await as(A, `select id from piece_parts where piece_id='${P3}' and name='二胡 I'`)).rows[0].id;
  const mine = (await as(A, `select id from scores where file_path='${llPath(P3, 'c')}'`)).rows[0].id;
  const add = async (piece, path) => (await as(A, `insert into scores (piece_id, part_id, title, file_path) values ('${piece}', ${piece === P3 ? `'${erhu}'` : 'null'}, '別人放的', '${path}') returning id`)).rows[0].id;
  const foreign = [
    await add(P3, `${P3}/${erhu}/123_web.pdf`),       // 網頁上傳到這首曲目的
    await add(P3, llPath(P4, 'd')),                  // 這首曲目上、別首曲目的泠靈路徑
    await add(P1, llPath(P1, 'e')),                  // 別首曲目上泠靈發的
    (await as(A, `select id from scores where piece_id='${P1}' and file_path is null limit 1`)).rows[0].id,  // 別首曲目的
  ];
  for (const id of foreign) {
    const r = await publish(A, { piece_id: P3, update_parts: [{ id: erhu, needed: '5' }], remove_scores: [mine, id] });
    assert.match(r.error, /不能撤掉這筆樂譜登記/);
    assert.equal(r.code, '22023');
    assert.equal((await as(A, `select needed from piece_parts where id='${erhu}'`)).rows[0].needed, '4');
    assert.equal((await as(A, `select 1 from scores where id in ('${mine}','${id}')`)).rows.length, 2);
  }
  await as(A, `delete from scores where id in (${foreign.slice(0, 3).map((id) => `'${id}'`).join(',')})`);
});

// 115-1 發譜時泠靈把一份二胡分譜複製給 二胡l、二胡ll 各一份；這次新建「二胡」並把兩個收成分部
const P6 = '22222222-2222-2222-2222-222222222226';
test('泠靈發譜：新建聲部時把現有聲部收成分部；被收的聲部上泠靈的舊登記同一次撤掉，排的人不動', async () => {
  await upload(llPath(P6, '1', 'erhu1'), llPath(P6, '2', 'erhu2'), llPath(P6, '3', 'erhu'));
  await as(A, `insert into pieces (id,title) values ('${P6}','泰芙努特（重發）');
    insert into piece_parts (id,piece_id,name,section) values ('${D(11)}','${P6}','二胡l','拉弦'),('${D(12)}','${P6}','二胡ll','拉弦'),('${D(13)}','${P6}','中胡','拉弦');
    insert into part_assignments (part_id,user_id) values ('${D(11)}','${B}');
    insert into part_assignments (part_id,ringer_id) values ('${D(12)}','44444444-4444-4444-4444-444444444444')`);
  const old = (await as(A, `insert into scores (piece_id,part_id,title,file_path) values
    ('${P6}','${D(11)}','二胡l','${llPath(P6, '1', 'erhu1')}'),('${P6}','${D(12)}','二胡ll','${llPath(P6, '2', 'erhu2')}') returning id`)).rows.map((r) => r.id);
  const { rows, error } = await publish(A, {
    piece_id: P6,
    create_parts: [{ name: '二胡', needed: '8', needed_min: 8, section: '拉弦', sort: 1, absorb: [D(11), D(12)] }],
    remove_scores: old,
    add_scores: [{ new_part: '二胡', title: '二胡', file_path: llPath(P6, '3', 'erhu') }],
  });
  assert.equal(error, undefined);
  const out = rows[0].r;
  const erhu = out.created_parts[0].id;
  assert.deepEqual(out.created_parts, [{ id: erhu, name: '二胡', absorbed: [D(11), D(12)] }]);
  assert.deepEqual(out.removed_scores.map((s) => s.part_id).sort(), [D(11), D(12)].sort());
  assert.deepEqual(out.added_scores.map((s) => s.part_id), [erhu]);
  const parts = (await as(A, `select id, parent_id from piece_parts where piece_id='${P6}' order by name`)).rows;
  assert.deepEqual(parts, [{ id: D(13), parent_id: null }, { id: erhu, parent_id: null }, { id: D(11), parent_id: erhu }, { id: D(12), parent_id: erhu }]);
  assert.equal((await as(A, `select 1 from part_assignments where part_id in ('${D(11)}','${D(12)}')`)).rows.length, 2);
  const read = async (u) => (await as(u, `select title from scores where piece_id='${P6}'`)).rows.map((r) => r.title);
  assert.deepEqual(await read(B), ['二胡']);  // 排在 二胡l
  assert.deepEqual(await read(R), ['二胡']);  // 槍手排在 二胡ll
});

test('泠靈撤回：只把仍屬於那次新建聲部的分部改回獨立聲部，再刪新建的聲部，排的人不動', async () => {
  const erhu = (await as(A, `select id from piece_parts where piece_id='${P6}' and name='二胡'`)).rows[0].id;
  // 之後幹部在網頁上把 二胡ll 移到別的聲部底下
  await as(A, `insert into piece_parts (id,piece_id,name) values ('${D(14)}','${P6}','二胡（網頁）'); update piece_parts set parent_id='${D(14)}' where id='${D(12)}'`);
  // 泠靈經 REST：PATCH /rest/v1/piece_parts?id=in.(…)&parent_id=eq.<新建聲部> {"parent_id": null}
  const unparent = (u) => as(u, `update piece_parts set parent_id=null where id in ('${D(11)}','${D(12)}') and parent_id='${erhu}' returning id`);
  assert.deepEqual((await unparent(B)).rows, []);                        // 不是幹部：RLS 擋下，什麼都沒改
  assert.deepEqual((await unparent(A)).rows, [{ id: D(11) }]);
  assert.equal((await as(A, `delete from piece_parts where id='${erhu}'`)).error, undefined);
  assert.equal(await parentOf(D(11)), null);
  assert.equal(await parentOf(D(12)), D(14));
  assert.equal((await as(A, `select 1 from part_assignments where part_id in ('${D(11)}','${D(12)}')`)).rows.length, 2);
});

test('泠靈發譜：收成分部違反規則時整次不生效', async () => {
  const P7 = '22222222-2222-2222-2222-222222222227';
  await upload(llPath(P7, '4', 'perc2'), llPath(P7, '5', 'bell'));
  await as(A, `insert into pieces (id,title) values ('${P7}','泰芙努特（擊樂）');
    insert into piece_parts (id,piece_id,name) values ('${D(21)}','${P7}','風鈴'),('${D(22)}','${P7}','鈴鼓'),('${D(23)}','${P7}','打擊'),('${D(25)}','${P7}','碰鈴');
    insert into piece_parts (id,piece_id,name,parent_id) values ('${D(24)}','${P7}','吊拔','${D(23)}');
    insert into scores (piece_id,part_id,title,file_path) values ('${P7}','${D(25)}','碰鈴（泠靈舊檔）','${llPath(P7, '5', 'bell')}')`);
  const web = (await as(A, `insert into scores (piece_id,part_id,title,file_path) values ('${P7}','${D(21)}','風鈴','${P7}/${D(21)}/123_web.pdf') returning id`)).rows[0].id;
  const base = (absorb, extra = {}) => ({
    piece_id: P7, update_parts: [{ id: D(22), needed: '3' }],
    create_parts: [{ name: '擊樂2', needed: '4', needed_min: 4, absorb: [D(22), ...absorb] }],
    add_scores: [{ new_part: '擊樂2', title: '擊樂2', file_path: llPath(P7, '4', 'perc2') }], ...extra,
  });
  const failures = [
    [base([D(21)]), /有樂譜/, '23514'],                    // 網頁上傳的樂譜還掛著
    [base([D(25)]), /有樂譜/, '23514'],                    // 泠靈的舊檔沒放進 remove_scores
    [base([D(23)]), /有分部的聲部不能/, '23514'],          // 本身有分部
    [base([D(24)]), /已經是分部/, '23514'],                // 已經是別的聲部的分部
    [base([PT1]), /找不到這首曲目的聲部/, 'PT404'],        // 別首曲目的聲部
    [base([], { add_scores: [{ part_id: D(22), title: '鈴鼓', file_path: llPath(P7, '4', 'perc2') }] }), /分部不能有樂譜/, '23514'],  // 樂譜掛到剛收的分部
  ];
  for (const [payload, why, code] of failures) {
    const r = await publish(A, payload);
    assert.match(r.error ?? '', why, JSON.stringify(payload.create_parts));
    assert.equal(r.code, code);
    assert.equal((await as(A, `select 1 from piece_parts where piece_id='${P7}' and name='擊樂2'`)).rows.length, 0);
    assert.deepEqual((await as(A, `select parent_id, needed from piece_parts where id='${D(22)}'`)).rows[0], { parent_id: null, needed: '1' });
    assert.equal((await as(A, `select 1 from scores where piece_id='${P7}'`)).rows.length, 2);
  }
  assert.equal(await parentOf(D(24)), D(23));
  assert.equal((await as(A, `select 1 from scores where id='${web}'`)).rows.length, 1);
});

test('泠靈發譜：一份 Storage 檔只給一筆登記，已有登記指著的檔不能再登記', async () => {
  const erhu = (await as(A, `select id from piece_parts where piece_id='${P3}' and name='二胡 I'`)).rows[0].id;
  const pipa = (await as(A, `select id from piece_parts where piece_id='${P3}' and name='琵琶'`)).rows[0].id;
  const r = await publish(A, { piece_id: P3, add_scores: [{ part_id: pipa, title: '琵琶', file_path: llPath(P3, 'c') }] });
  assert.match(r.error, /已有樂譜登記這個檔/);
  assert.equal(r.code, '23505');
  assert.deepEqual((await as(A, `select part_id from scores where file_path='${llPath(P3, 'c')}'`)).rows.map((x) => x.part_id), [erhu]);
});

test('泠靈發譜：一個群組全成或全不成，任何一步失敗都不留下前面的寫入', async () => {
  await upload(llPath(P4, 'a'));
  const base = { piece_id: P4, new_piece: { title: '將軍令' }, create_parts: [{ name: '嗩吶', needed: '1', needed_min: 1, sort: 1 }],
    add_scores: [{ new_part: '嗩吶', file_path: llPath(P4, 'a') }], attach_events: [E(4)] };
  const failures = [
    [{ add_scores: [...base.add_scores, { part_id: null, file_path: llPath(P4, 'f') }] }, /還沒傳到 Storage/, 'PT404'],
    [{ add_scores: [{ part_id: null, file_path: `${P4}/full/123_x.pdf` }] }, /不是泠靈的樂譜路徑/, '22023'],
    [{ add_scores: [{ part_id: null, file_path: `lingling/${P4}/${'a'.repeat(64)}.pdf` }] }, /不是泠靈的樂譜路徑/, '22023'],
    [{ add_scores: [...base.add_scores, { part_id: null, file_path: llPath(P4, 'a') }] }, /已有樂譜登記這個檔/, '23505'],
    [{ update_parts: [{ id: PT1, needed: '9' }] }, /找不到這首曲目的聲部/, 'PT404'],
    [{ attach_events: [E(4), '55555555-5555-5555-5555-555555555550'] }, /foreign key/, '23503'],
  ];
  for (const [change, why, code] of failures) {
    const r = await publish(A, { ...base, ...change });
    assert.match(r.error, why);
    assert.equal(r.code, code);
    assert.equal((await as(A, `select 1 from pieces where id='${P4}'`)).rows.length, 0);
    assert.equal((await as(A, `select 1 from piece_parts where piece_id='${P4}'`)).rows.length, 0);
    assert.equal((await as(A, `select 1 from scores where piece_id='${P4}'`)).rows.length, 0);
  }
  assert.equal((await as(A, `select needed from piece_parts where id='${PT1}'`)).rows[0].needed, '1');
});

test('泠靈發譜：不是幹部會被 RLS 擋下，什麼都沒寫進去', async () => {
  const r = await publish(B, { piece_id: P4, new_piece: { title: '將軍令' } });
  assert.match(r.error, /row-level security/);
  assert.equal(r.code, '42501');
  assert.equal((await as(A, `select 1 from pieces where id='${P4}'`)).rows.length, 0);
  assert.match((await publish(B, { piece_id: P1, attach_events: [E(4)] })).error, /row-level security/);
  assert.match((await publish(B, { piece_id: P1, create_parts: [{ name: '高胡' }] })).error, /row-level security/);
  assert.ok((await publish(B, { piece_id: P1, update_parts: [{ id: PT1, needed: '9' }] })).error);
  assert.equal((await as(A, `select needed from piece_parts where id='${PT1}'`)).rows[0].needed, '1');
  assert.equal((await as(A, `select 1 from event_pieces where piece_id='${P1}' and event_id='${E(4)}'`)).rows.length, 0);
});

test('組內出席平均與 80% 名單：社員只看到自己組的平均和名單上的名字，看不到別人的數字；計算函式不能直接呼叫', async () => {
  const all = (await as(A, `select user_id, current_rate from attendance_stats('${S}')`)).rows;
  // 社員：只拿得到自己所在組別的平均
  const mySecs = (await as(B, `select my_sections() as s`)).rows[0].s;
  const secs = (await as(B, `select * from section_attendance('${S}')`)).rows;
  assert.ok(secs.length >= 1);
  assert.ok(secs.every((r) => mySecs.includes(r.section)));
  // 幹部：五組都拿得到
  assert.equal((await as(A, `select * from section_attendance('${S}')`)).rows.length, 5);
  // 80% 名單：只有 user_id，和幹部算出來的一致
  const roll = (await as(B, `select * from attendance_honor_roll('${S}')`)).rows;
  assert.deepEqual(Object.keys(roll[0] || { user_id: 1 }), ['user_id']);
  const want = all.filter((r) => r.current_rate != null && Number(r.current_rate) >= 80).map((r) => r.user_id).sort();
  assert.deepEqual(roll.map((r) => r.user_id).sort(), want);
  // 社員自己的出席率表還是只有自己
  assert.deepEqual((await as(B, `select user_id from attendance_stats('${S}')`)).rows.map((r) => r.user_id), [B]);
  // 不是社內的人（只有槍手身分）拿不到名單；任何登入的人都不能直接呼叫計算函式
  assert.equal((await as(R, `select * from attendance_honor_roll('${S}')`)).rows.length, 0);
  assert.ok((await as(B, `select * from attendance_calc('${S}', true)`)).error);
});
