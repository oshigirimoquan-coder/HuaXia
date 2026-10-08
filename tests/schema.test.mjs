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
  catch (e) { return { error: e.message }; }
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
