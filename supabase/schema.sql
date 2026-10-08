-- =====================================================================
-- 華夏國樂社系統：資料庫結構與權限
-- 用法：Supabase → SQL Editor → New query → 整份貼上 → Run。可重複執行。
-- 第一位登入的人自動成為「管理員」並啟用；之後的人都是「待核准」。
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 成員與身分組
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  real_name text not null default '',
  section text check (section in ('吹管','拉弦','彈撥','打擊','低音')),
  instruments text not null default '',
  grade text not null default '',
  school text not null default '',          -- 槍手填外校校名
  bio text not null default '',
  officer_title text not null default '',   -- 幹部職位標籤：副社、總務、公關…
  avatar_url text,
  status text not null default 'pending' check (status in ('pending','active','inactive')),
  created_at timestamptz not null default now()
);

-- 只有本人與幹部看得到的聯絡資料
create table if not exists public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text,
  google_email text,     -- 用來分享「幹部行事曆」
  phone text not null default ''
);

create table if not exists public.user_roles (
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','officer','leader','member','newbie','ringer','teacher','alumni')),
  primary key (user_id, role)
);
-- 校友：看得到社內資訊；只有排進當天編制才算出席
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin','officer','leader','member','newbie','ringer','teacher','alumni'));

-- ---------------------------------------------------------------------
-- 2. 學期與設定
-- ---------------------------------------------------------------------
create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- 例：114-1
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists one_current_semester on public.semesters (is_current) where is_current;

create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);
insert into public.settings (key, value) values
  ('team_name', '"華夏國樂社"'),
  -- 出席率規則（待社長確認後由管理員調整）
  ('attendance_rules', '{"late_weight":1,"early_weight":1,"unexcused_weight":0.5,"excused_mode":"absent","count_ringers":false}'),
  ('recruit_open', 'false'),
  -- 公告通知管道（待社長決定 discord / email / both）
  ('notify', '{"channel":"discord"}'),
  -- 「工具」頁的外部連結（管理員可在工具頁修改）
  ('tools', '[{"name":"輔助工具","url":"https://splendorous-piroshki-574d88.netlify.app/","desc":""}]')
on conflict (key) do nothing;
-- 舊資料補上「未預告晚到早退」的權重（重複執行不會覆蓋已調整的值）
update public.settings set value = '{"unexcused_weight":0.5}'::jsonb || value
  where key = 'attendance_rules' and not value ? 'unexcused_weight';

-- 只有管理員與後端看得到的設定（Discord webhook 網址等）
create table if not exists public.private_settings (
  key text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------------------
-- 3. 行事曆
-- ---------------------------------------------------------------------
create table if not exists public.calendars (
  key text primary key,
  name text not null,
  audience text not null check (audience in ('insiders','section','class','officers','ringers')),
  section text,
  gcal_id text,              -- 由 calendar-sync 函式建立後填入
  sort int not null default 0
);
insert into public.calendars (key, name, audience, section, sort) values
  ('tutti',  '華夏｜全團練習與演出', 'insiders', null, 1),
  ('sec-wind', '華夏｜吹管分部課', 'section', '吹管', 2),
  ('sec-bow',  '華夏｜拉弦分部課', 'section', '拉弦', 3),
  ('sec-pluck','華夏｜彈撥分部課', 'section', '彈撥', 4),
  ('sec-perc', '華夏｜打擊分部課', 'section', '打擊', 5),
  ('sec-bass', '華夏｜低音分部課', 'section', '低音', 6),
  ('class',  '華夏｜教學班', 'class', null, 7),
  ('ringers','華夏｜槍手行程', 'ringers', null, 8),
  ('officers','華夏｜幹部', 'officers', null, 9)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 4. 曲目、編制、槍手
-- ---------------------------------------------------------------------
create table if not exists public.pieces (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  composer text not null default '',
  duration_min numeric,
  notes text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.piece_parts (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces(id) on delete cascade,
  name text not null,                 -- 例：高笛、二胡I、打擊1
  needed text not null default '1',   -- 例：2、2-3、1↑
  needed_min int not null default 1,  -- 用來判斷缺人
  sort int not null default 0,
  tutor_id uuid references public.profiles(id) on delete set null,  -- 小老師
  note text not null default ''
);

create table if not exists public.ringers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school text not null default '',
  instruments text not null default '',
  contact_user_id uuid references public.profiles(id) on delete set null,  -- 負責聯絡的社員
  contact_info text not null default '',
  status text not null default 'contacting' check (status in ('contacting','accepted','declined')),
  note text not null default '',
  user_id uuid references public.profiles(id) on delete set null,  -- 槍手註冊後連結帳號
  created_at timestamptz not null default now()
);

create table if not exists public.part_assignments (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.piece_parts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  ringer_id uuid references public.ringers(id) on delete cascade,
  check (user_id is not null or ringer_id is not null)
);
create unique index if not exists part_assign_user on public.part_assignments (part_id, user_id) where user_id is not null;
create unique index if not exists part_assign_ringer on public.part_assignments (part_id, ringer_id) where ringer_id is not null;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces(id) on delete cascade,
  part_id uuid references public.piece_parts(id) on delete cascade,  -- null = 總譜
  title text not null default '',
  file_path text,         -- storage bucket "scores" 內的路徑：<piece>/<part|full>/<檔名>
  audio_url text not null default '',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- 分組樂譜：section 有值 = 給整組看（批次上傳時依檔名自動分組）
alter table public.scores add column if not exists section text;
alter table public.scores drop constraint if exists scores_section_check;
alter table public.scores add constraint scores_section_check check (section is null or section in ('吹管','拉弦','彈撥','打擊','低音'));
alter table public.piece_parts add column if not exists section text;
alter table public.piece_parts drop constraint if exists piece_parts_section_check;
alter table public.piece_parts add constraint piece_parts_section_check check (section is null or section in ('吹管','拉弦','彈撥','打擊','低音'));
-- 聲部沒填組別時，依名稱自動判斷（與 js/logic.js 的 guessSection 一致）
create or replace function public.guess_section(n text) returns text language sql immutable as $$
  select case
    when n ~* '笛|笙|嗩吶|唢呐|管子|簫|箫|巴烏|葫蘆絲|dizi|sheng|suona|flute' then '吹管'
    when n ~* '大提|低音提|倍大提|革胡|貝斯|cello|bass' then '低音'
    when n ~* '胡|erhu|gaohu|zhonghu' then '拉弦'
    when n ~* '琵琶|阮|柳琴|揚琴|扬琴|箏|筝|三弦|箜篌|pipa|ruan|liuqin|yangqin|guzheng' then '彈撥'
    when n ~* '打擊|打击|鼓|鑼|锣|鈸|钹|木魚|定音|鐘琴|鐵琴|木琴|鈴|梆子|板|perc|timp|drum' then '打擊'
  end
$$;
create or replace function public.piece_parts_section() returns trigger language plpgsql as $$
begin
  if new.section is null or new.section = '' then new.section := public.guess_section(new.name); end if;
  return new;
end $$;
drop trigger if exists piece_parts_section on public.piece_parts;
create trigger piece_parts_section before insert or update on public.piece_parts
  for each row execute function public.piece_parts_section();
update public.piece_parts set section = public.guess_section(name) where section is null;

-- 座位表：每首曲子一份；seats = [{k:'u:<id>'|'r:<id>', part:<part id>, x, y}]（公尺，舞台前緣中央為 0,0）
create table if not exists public.seating_charts (
  piece_id uuid primary key references public.pieces(id) on delete cascade,
  stage jsonb not null default '{"preset":"hall","w":12,"d":8}',
  seats jsonb not null default '[]',
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. 教學班
-- ---------------------------------------------------------------------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid references public.semesters(id) on delete cascade,
  name text not null,
  instrument text not null default '',
  teacher_ids uuid[] not null default '{}',
  note text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.class_students (
  class_id uuid references public.classes(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (class_id, user_id)
);
create table if not exists public.class_milestones (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  sort int not null default 0
);
create table if not exists public.class_progress (
  milestone_id uuid references public.class_milestones(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  done_at timestamptz not null default now(),
  checked_by uuid default auth.uid(),
  primary key (milestone_id, user_id)
);

-- ---------------------------------------------------------------------
-- 6. 行程、請假、點名
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid references public.semesters(id) on delete set null,
  kind text not null check (kind in ('tutti','sizhu','extra','sectional','class','dress','concert','officer','other')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '',
  note text not null default '',
  section text,                       -- 分部課的組別
  class_id uuid references public.classes(id) on delete set null,
  audience text not null default 'insiders' check (audience in ('insiders','all','officers')),
  calendar_key text references public.calendars(key),
  counts_attendance boolean not null default true,
  gcal_event_id text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists events_time on public.events (starts_at);

-- 類型可以複選（例：大團＋絲竹、總彩＋公演）；kind 自動等於第一個，給只看單一類型的地方用
alter table public.events add column if not exists kinds text[] not null default '{}'
  check (kinds <@ array['tutti','sizhu','extra','sectional','class','dress','concert','officer','other']::text[]);
create or replace function public.events_kinds() returns trigger language plpgsql as $$
begin
  if new.kinds is null or cardinality(new.kinds) = 0 then new.kinds := array[new.kind]; end if;
  new.kind := new.kinds[1];
  return new;
end $$;
drop trigger if exists events_kinds on public.events;
create trigger events_kinds before insert or update on public.events for each row execute function public.events_kinds();
update public.events set kinds = array[kind] where cardinality(kinds) = 0;

create table if not exists public.event_pieces (
  event_id uuid references public.events(id) on delete cascade,
  piece_id uuid references public.pieces(id) on delete cascade,
  primary key (event_id, piece_id)
);

create table if not exists public.leave_requests (
  event_id uuid references public.events(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete cascade,
  type text not null check (type in ('leave','late','early')),
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.attendance (
  event_id uuid references public.events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  status text not null check (status in ('present','late','early','absent','excused','na')),
  note text not null default '',
  marked_by uuid default auth.uid(),
  marked_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ---------------------------------------------------------------------
-- 7. 公告、任務
-- ---------------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'other' check (type in ('practice','performance','admin','class','urgent','other')),
  audience text not null default 'insiders' check (audience in ('all','insiders','section','officers','newbies','ringers')),
  section text,
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  author uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- 頻道：main 公告、sizhu 絲竹、concerts 音樂會分享、alumni 校友團
alter table public.announcements add column if not exists channel text not null default 'main'
  check (channel in ('main','sizhu','concerts','alumni'));
alter table public.announcements add column if not exists event_at timestamptz;   -- 音樂會日期
alter table public.announcements add column if not exists venue text not null default '';
alter table public.announcements add column if not exists link text not null default '';

-- 標記：mentions 指定的人；mention_all = 標記全體絲竹成員
alter table public.announcements add column if not exists mentions uuid[] not null default '{}';
alter table public.announcements add column if not exists mention_all boolean not null default false;

-- 2026-10 公告分類改版：channel 就是分類
--   performance 華夏演出｜tutti 大團｜sizhu 絲竹｜class 教學班｜alumni 校友團｜concerts 音樂會｜resources 資源
--   舊的 main 依 type 自動轉換；對象多一個 sizhu（大家看得到，提醒絲竹成員）
alter table public.announcements drop constraint if exists announcements_channel_check;
alter table public.announcements add constraint announcements_channel_check
  check (channel in ('main','performance','tutti','sizhu','class','alumni','concerts','resources'));
alter table public.announcements alter column channel set default 'tutti';
alter table public.announcements drop constraint if exists announcements_audience_check;
alter table public.announcements add constraint announcements_audience_check
  check (audience in ('all','insiders','section','officers','newbies','ringers','sizhu'));
create or replace function public.announcements_category() returns trigger language plpgsql as $$
begin
  if new.channel = 'main' then
    new.channel := case new.type when 'performance' then 'performance' when 'class' then 'class' else 'tutti' end;
  end if;
  if new.audience = 'sizhu' then new.mention_all := true; end if;
  return new;
end $$;
drop trigger if exists announcements_category on public.announcements;
create trigger announcements_category before insert or update on public.announcements
  for each row execute function public.announcements_category();
update public.announcements set channel = channel where channel = 'main';

-- 小樂團名單（目前只有絲竹，之後可加校友團等）
create table if not exists public.ensemble_members (
  ensemble text not null check (ensemble in ('sizhu')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (ensemble, user_id)
);

create table if not exists public.announcement_reads (
  ann_id uuid references public.announcements(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (ann_id, user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  due date,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  audience text not null default 'officers' check (audience in ('officers','insiders','assignees')),
  assignees uuid[] not null default '{}',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. 教學資源、練習回報
-- ---------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  section text,
  instrument text not null default '',
  title text not null,
  url text not null default '',
  note text not null default '',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.practice_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  piece_id uuid references public.pieces(id) on delete set null,
  part_id uuid references public.piece_parts(id) on delete set null,
  title text not null,
  url text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.report_feedback (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.practice_reports(id) on delete cascade,
  author uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. 招生報名（公開表單，免登入）
-- ---------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  grade text not null check (char_length(grade) between 1 and 40),
  contact text not null check (char_length(contact) between 1 and 120),
  experience text not null default 'none' check (experience in ('none','some','basic')),
  instruments_played text not null default '' check (char_length(instruments_played) <= 120),
  interests text[] not null default '{}',
  want_class boolean not null default false,
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'new' check (status in ('new','contacted','joined','declined')),
  officer_note text not null default '',
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 身分判斷函式
-- =====================================================================
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active')
$$;
create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and exists (select 1 from user_roles where user_id = auth.uid() and role = r)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('admin') $$;
create or replace function public.is_officer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin') or public.has_role('officer')
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_officer() or public.has_role('teacher')
$$;
-- 社內成員（不含只有槍手身分的人）
create or replace function public.is_insider() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and exists (select 1 from user_roles where user_id = auth.uid()
    and role in ('admin','officer','leader','member','newbie','teacher','alumni'))
$$;
create or replace function public.my_section() returns text
language sql stable security definer set search_path = public as $$
  select section from profiles where id = auth.uid()
$$;
create or replace function public.leads_user(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('leader') and exists (select 1 from profiles p where p.id = uid
    and p.section is not null and p.section = public.my_section())
$$;
create or replace function public.in_piece(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from part_assignments pa join piece_parts pp on pp.id = pa.part_id
    left join ringers r on r.id = pa.ringer_id
    where pp.piece_id = pid and (pa.user_id = auth.uid() or r.user_id = auth.uid()))
$$;
create or replace function public.in_part(part uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from part_assignments pa left join ringers r on r.id = pa.ringer_id
    where pa.part_id = part and (pa.user_id = auth.uid() or r.user_id = auth.uid()))
$$;
create or replace function public.teaches_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = cid and auth.uid() = any(teacher_ids))
$$;
create or replace function public.in_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_students where class_id = cid and user_id = auth.uid())
$$;
create or replace function public.can_see_event(e public.events) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.is_officer() then true
    when e.audience = 'officers' then false
    when public.is_insider() then true
    when e.audience = 'all' and public.is_active() then true
    else exists (select 1 from event_pieces ep where ep.event_id = e.id and public.in_piece(ep.piece_id))
  end
$$;

-- 某人是否「應出席」某次行程（自動判斷無曲）
create or replace function public.is_expected(e public.events, uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare rules jsonb; is_ringer_only boolean; k text;
  has_pieces boolean := exists (select 1 from event_pieces where event_id = e.id);
begin
  if not e.counts_attendance then return false; end if;
  if not exists (select 1 from profiles where id = uid and status = 'active') then return false; end if;
  select value into rules from settings where key = 'attendance_rules';
  is_ringer_only := not exists (select 1 from user_roles where user_id = uid
    and role in ('admin','officer','leader','member','newbie'));
  -- 只有校友身分：排進當天曲目編制才算
  if is_ringer_only and exists (select 1 from user_roles where user_id = uid and role = 'alumni') then
    return has_pieces and exists (select 1 from event_pieces ep join piece_parts pp on pp.piece_id = ep.piece_id
      join part_assignments pa on pa.part_id = pp.id where ep.event_id = e.id and pa.user_id = uid);
  end if;
  if is_ringer_only and not coalesce((rules->>'count_ringers')::boolean, false) then return false; end if;
  -- 複選類型：符合其中任一種就算應出席
  foreach k in array (case when cardinality(e.kinds) > 0 then e.kinds else array[e.kind] end) loop
    if k = 'officer' then
      if exists (select 1 from user_roles where user_id = uid and role in ('admin','officer')) then return true; end if;
    elsif k = 'sectional' then
      if exists (select 1 from profiles where id = uid and section = e.section) then return true; end if;
    elsif k = 'class' then
      if exists (select 1 from class_students where class_id = e.class_id and user_id = uid) then return true; end if;
    elsif has_pieces then
      if exists (select 1 from event_pieces ep join piece_parts pp on pp.piece_id = ep.piece_id
        join part_assignments pa on pa.part_id = pp.id left join ringers r on r.id = pa.ringer_id
        where ep.event_id = e.id and (pa.user_id = uid or r.user_id = uid)) then return true; end if;
    elsif k = 'sizhu' and exists (select 1 from ensemble_members where ensemble = 'sizhu') then
      if exists (select 1 from ensemble_members where ensemble = 'sizhu' and user_id = uid) then return true; end if;
    elsif not is_ringer_only then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- 點名名單：應出席的人 + 已有紀錄的人，附請假與點名狀態
create or replace function public.event_roster(eid uuid)
returns table (user_id uuid, expected boolean, status text, note text, leave_type text, leave_reason text)
language plpgsql stable security definer set search_path = public as $$
declare e events;
begin
  select * into e from events where id = eid;
  if e.id is null or not public.can_see_event(e) then return; end if;
  return query
    select p.id, public.is_expected(e, p.id), a.status, a.note, l.type, l.reason
    from profiles p
    left join attendance a on a.event_id = eid and a.user_id = p.id
    left join leave_requests l on l.event_id = eid and l.user_id = p.id
    where p.status = 'active'
      and (public.is_expected(e, p.id) or a.user_id is not null or l.user_id is not null)
      and (public.is_officer() or p.id = auth.uid() or public.leads_user(p.id));
end $$;

-- 出席率統計（目前／整學期）
-- 晚到／早退：有事先預告（請假系統選了晚到或早退）算 late_weight／early_weight，沒預告算 unexcused_weight
create or replace function public.attendance_stats(sem uuid)
returns table (user_id uuid, expected_total int, expected_so_far int, attended numeric,
  present int, late int, early int, excused int, absent int, current_rate numeric, total_rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare rules jsonb; lw numeric; ew numeric; uw numeric; exclude_excused boolean;
begin
  select value into rules from settings where key = 'attendance_rules';
  lw := coalesce((rules->>'late_weight')::numeric, 1);
  ew := coalesce((rules->>'early_weight')::numeric, 1);
  uw := coalesce((rules->>'unexcused_weight')::numeric, 0.5);
  exclude_excused := coalesce(rules->>'excused_mode', 'absent') = 'exclude';
  return query
  with ev as (
    select e as erow, e.id as eid, exists (select 1 from attendance a where a.event_id = e.id) as marked
    from events e where e.semester_id = sem and e.counts_attendance
  ), cells as (
    select p.id as uid, ev.marked, l.type as lt,
      coalesce(a.status, case when ev.marked then
        case when l.type = 'leave' then 'excused' else 'absent' end end) as st
    from profiles p cross join ev
    left join attendance a on a.event_id = ev.eid and a.user_id = p.id
    left join leave_requests l on l.event_id = ev.eid and l.user_id = p.id
    where p.status = 'active'
      and (public.is_officer() or p.id = auth.uid() or public.leads_user(p.id))
      and public.is_expected(ev.erow, p.id)
      and coalesce(a.status, '') <> 'na'
  ), w as (
    select cells.*, case st
      when 'present' then 1::numeric
      when 'late' then case when lt = 'late' then lw else uw end
      when 'early' then case when lt = 'early' then ew else uw end
      else 0::numeric end as wt
    from cells
  ), agg as (
    select uid,
      count(*)::int as exp_total,
      count(*) filter (where marked and not (exclude_excused and st = 'excused'))::int as exp_now,
      coalesce(sum(wt), 0) as got,
      count(*) filter (where st = 'present')::int as n_present,
      count(*) filter (where st = 'late')::int as n_late,
      count(*) filter (where st = 'early')::int as n_early,
      count(*) filter (where st = 'excused')::int as n_excused,
      count(*) filter (where st = 'absent')::int as n_absent,
      count(*) filter (where not marked and not (exclude_excused and st = 'excused'))::int as future
    from w group by uid
  )
  select uid, exp_total - case when exclude_excused then n_excused else 0 end, exp_now, got,
    n_present, n_late, n_early, n_excused, n_absent,
    case when exp_now > 0 then round(got / exp_now * 100, 1) end,
    case when (exp_now + future) > 0 then round(got / (exp_now + future) * 100, 1) end
  from agg;
end $$;

-- 個人出席明細：每次行程的計算後狀態
create or replace function public.attendance_detail(sem uuid, uid uuid)
returns table (event_id uuid, starts_at timestamptz, kind text, title text, expected boolean, marked boolean, status text, note text, leave_type text, leave_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (uid = auth.uid() or public.is_officer() or public.leads_user(uid)) then return; end if;
  return query
    select e.id, e.starts_at, e.kind, e.title, public.is_expected(e, uid),
      exists (select 1 from attendance x where x.event_id = e.id),
      coalesce(a.status, case when exists (select 1 from attendance x where x.event_id = e.id)
        and public.is_expected(e, uid) then case when l.type = 'leave' then 'excused' else 'absent' end end),
      a.note, l.type, l.reason
    from events e
    left join attendance a on a.event_id = e.id and a.user_id = uid
    left join leave_requests l on l.event_id = e.id and l.user_id = uid
    where e.semester_id = sem and e.counts_attendance
    order by e.starts_at;
end $$;

-- 提到我的訊息：被點名，或被標記全體而且我在那個樂團名單裡
create or replace function public.my_mentions()
returns setof public.announcements
language sql stable security definer set search_path = public as $$
  select a.* from announcements a
  where public.is_insider() and (auth.uid() = any(a.mentions)
    or (a.mention_all and exists (select 1 from ensemble_members m where m.ensemble = 'sizhu' and m.user_id = auth.uid())))
  order by a.created_at desc limit 50
$$;

-- 使用者 → Discord ID（給後端通知 @ 人用；一般登入者不能呼叫）
create or replace function public.discord_ids(uids uuid[])
returns table (user_id uuid, discord_id text)
language sql stable security definer set search_path = public, auth as $$
  select i.user_id, i.provider_id from auth.identities i where i.provider = 'discord' and i.user_id = any(uids)
$$;
revoke execute on function public.discord_ids(uuid[]) from public, anon, authenticated;

-- 練習回報可見範圍
create or replace function public.can_see_report(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from practice_reports r where r.id = rid and (
    r.user_id = auth.uid() or public.is_staff() or public.leads_user(r.user_id)
    or exists (select 1 from piece_parts pp where pp.id = r.part_id and pp.tutor_id = auth.uid())
    or exists (select 1 from class_students cs join classes c on c.id = cs.class_id
               where cs.user_id = r.user_id and auth.uid() = any(c.teacher_ids))))
$$;

-- =====================================================================
-- 觸發器
-- =====================================================================
-- 新帳號：建立個人資料；系統內還沒有管理員時，第一位自動成為管理員
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_admin boolean;
begin
  first_admin := not exists (select 1 from user_roles where role = 'admin');
  insert into profiles (id, display_name, avatar_url, status)
  values (new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->'custom_claims'->>'global_name', split_part(new.email, '@', 1), ''),
    new.raw_user_meta_data->>'avatar_url',
    case when first_admin then 'active' else 'pending' end)
  on conflict (id) do nothing;
  insert into profile_private (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  if first_admin then
    insert into user_roles values (new.id, 'admin'), (new.id, 'member') on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 個人資料：本人只能改基本欄位；狀態與職位只有管理員能改；組別與樂器幹部也能改
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.status is distinct from old.status or new.officer_title is distinct from old.officer_title then
    raise exception '只有管理員能變更帳號狀態或職位';
  end if;
  if (new.section is distinct from old.section) and not public.is_officer() then
    raise exception '組別由幹部設定';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- 至少保留一位管理員，避免交接時把自己鎖在外面
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and not exists (select 1 from user_roles where role = 'admin' and user_id <> old.user_id) then
    raise exception '系統至少要有一位管理員';
  end if;
  return old;
end $$;
drop trigger if exists keep_one_admin on public.user_roles;
create trigger keep_one_admin before delete on public.user_roles
  for each row execute function public.keep_one_admin();

create or replace function public.touch_updated() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events for each row execute function public.touch_updated();
drop trigger if exists seating_touch on public.seating_charts;
create trigger seating_touch before update on public.seating_charts for each row execute function public.touch_updated();

-- =====================================================================
-- 存取規則 (RLS)
-- =====================================================================
do $$ declare t text; p record; begin
  foreach t in array array['profiles','profile_private','user_roles','semesters','settings','private_settings',
    'calendars','pieces','piece_parts','ringers','part_assignments','scores','classes','class_students',
    'class_milestones','class_progress','events','event_pieces','leave_requests','attendance',
    'announcements','announcement_reads','tasks','resources','practice_reports','report_feedback','applications','ensemble_members','seating_charts'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- 成員
create policy prof_read on public.profiles for select using (id = auth.uid() or public.is_active());
create policy prof_update on public.profiles for update using (id = auth.uid() or public.is_officer());
create policy prof_delete on public.profiles for delete using (public.is_admin() and id <> auth.uid());
create policy priv_read on public.profile_private for select using (user_id = auth.uid() or public.is_officer());
create policy priv_write on public.profile_private for update using (user_id = auth.uid() or public.is_admin());
create policy roles_read on public.user_roles for select using (user_id = auth.uid() or public.is_active());
create policy roles_admin on public.user_roles for all using (public.is_admin()) with check (public.is_admin());

-- 學期與設定
create policy sem_read on public.semesters for select using (public.is_active());
create policy sem_admin on public.semesters for all using (public.is_admin()) with check (public.is_admin());
create policy set_read on public.settings for select using (key = 'team_name' or public.is_active());
create policy set_admin on public.settings for all using (public.is_admin()) with check (public.is_admin());
create policy pset_admin on public.private_settings for all using (public.is_admin()) with check (public.is_admin());
create policy cal_read on public.calendars for select using (public.is_active());
create policy cal_admin on public.calendars for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.can_staff_part(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_officer() or (public.is_active() and exists (select 1 from piece_parts pp where pp.id = pid and (
    pp.tutor_id = auth.uid() or (public.has_role('leader') and pp.section is not null and pp.section = public.my_section()))))
$$;
-- 曲目與編制：社內成員看全部；槍手只看自己參與的曲目
create policy piece_read on public.pieces for select using (public.is_insider() or public.in_piece(id));
create policy piece_write on public.pieces for all using (public.is_officer()) with check (public.is_officer());
create policy part_read on public.piece_parts for select using (public.is_insider() or public.in_piece(piece_id));
create policy part_write on public.piece_parts for all using (public.is_officer()) with check (public.is_officer());
create policy assign_read on public.part_assignments for select using (public.is_insider() or public.in_part(part_id));
-- 排人：幹部全部；組長排自己組的聲部；小老師排自己帶的聲部
create policy assign_write on public.part_assignments for all using (public.can_staff_part(part_id)) with check (public.can_staff_part(part_id));
-- 座位表：看得到曲子的人都看得到；幹部與組長可以調整
create policy seat_read on public.seating_charts for select using (public.is_insider() or public.in_piece(piece_id));
create policy seat_write on public.seating_charts for all using (public.is_officer() or public.has_role('leader')) with check (public.is_officer() or public.has_role('leader'));
create policy ringer_officer on public.ringers for all using (public.is_officer()) with check (public.is_officer());
create policy ringer_self on public.ringers for select using (user_id = auth.uid());

create or replace function public.can_read_score(s public.scores) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff()
    or (s.part_id is not null and public.in_part(s.part_id))
    or (s.part_id is null and s.section is not null and (
      (public.is_insider() and s.section = public.my_section())
      or exists (select 1 from piece_parts pp where pp.piece_id = s.piece_id and pp.section = s.section and public.in_part(pp.id))))
$$;
-- 樂譜：幹部與指導老師看全部；分譜看自己聲部；分組樂譜看自己那一組
-- （槍手沒有組別：排進這首曲子、且聲部屬於該組時也看得到）
create policy score_read on public.scores for select using (public.can_read_score(scores));
create policy score_write on public.scores for all using (public.is_officer()) with check (public.is_officer());

-- 教學班
create policy class_read on public.classes for select using (public.is_insider());
create policy class_write on public.classes for all using (public.is_officer()) with check (public.is_officer());
create policy cstu_read on public.class_students for select using (public.is_insider());
create policy cstu_write on public.class_students for all using (public.is_officer() or public.teaches_class(class_id))
  with check (public.is_officer() or public.teaches_class(class_id));
create policy cms_read on public.class_milestones for select using (public.is_insider());
create policy cms_write on public.class_milestones for all using (public.is_officer() or public.teaches_class(class_id))
  with check (public.is_officer() or public.teaches_class(class_id));
create policy cprog_read on public.class_progress for select using (user_id = auth.uid() or public.is_officer()
  or exists (select 1 from class_milestones m where m.id = milestone_id and public.teaches_class(m.class_id)));
create policy cprog_write on public.class_progress for all using (public.is_officer()
  or exists (select 1 from class_milestones m where m.id = milestone_id and public.teaches_class(m.class_id)))
  with check (public.is_officer()
  or exists (select 1 from class_milestones m where m.id = milestone_id and public.teaches_class(m.class_id)));

-- 行程
create policy ev_read on public.events for select using (public.can_see_event(events));
create policy ev_write on public.events for all using (public.is_officer()) with check (public.is_officer());
create policy evp_read on public.event_pieces for select using (public.is_active());
create policy evp_write on public.event_pieces for all using (public.is_officer()) with check (public.is_officer());

-- 請假：本人寫；幹部與組長看得到
create policy leave_read on public.leave_requests for select using (
  user_id = auth.uid() or public.is_officer() or public.leads_user(user_id));
create policy leave_own on public.leave_requests for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active());

-- 點名：幹部全部；組長點自己組員
create policy att_read on public.attendance for select using (
  user_id = auth.uid() or public.is_officer() or public.leads_user(user_id));
create policy att_write on public.attendance for all using (public.is_officer() or public.leads_user(user_id))
  with check (public.is_officer() or public.leads_user(user_id));

-- 公告
create policy ann_read on public.announcements for select using (
  public.is_officer() or case audience
    when 'all' then public.is_active()
    when 'insiders' then public.is_insider()
    when 'section' then public.is_insider() and section = public.my_section()
    when 'newbies' then public.has_role('newbie')
    when 'ringers' then public.has_role('ringer')
    when 'sizhu' then public.is_insider()
    else false end);
create policy ann_write on public.announcements for all using (public.is_officer()) with check (public.is_officer());
-- 樂團名單：社內成員看得到，幹部維護
create policy ens_read on public.ensemble_members for select using (public.is_insider());
create policy ens_write on public.ensemble_members for all using (public.is_officer()) with check (public.is_officer());

-- 音樂會分享：社內成員都能發，只能改或刪自己的
create policy ann_share_insert on public.announcements for insert with check (
  channel in ('concerts','resources') and public.is_insider() and author = auth.uid() and audience = 'insiders' and not pinned);
create policy ann_share_own on public.announcements for update using (channel in ('concerts','resources') and author = auth.uid())
  with check (channel in ('concerts','resources') and author = auth.uid() and audience = 'insiders' and not pinned);
create policy ann_share_del on public.announcements for delete using (channel in ('concerts','resources') and author = auth.uid());
create policy annr_own on public.announcement_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 任務：幹部事項社員看不到
create policy task_read on public.tasks for select using (
  public.is_officer() or auth.uid() = any(assignees) or (audience = 'insiders' and public.is_insider()));
create policy task_insert on public.tasks for insert with check (public.is_officer());
create policy task_update on public.tasks for update using (public.is_officer() or auth.uid() = any(assignees));
create policy task_delete on public.tasks for delete using (public.is_officer());

-- 教學資源與練習回報
create policy res_read on public.resources for select using (public.is_insider());
create policy res_write on public.resources for all using (public.is_staff() or public.has_role('leader'))
  with check (public.is_staff() or public.has_role('leader'));
create policy rep_read on public.practice_reports for select using (public.can_see_report(id));
create policy rep_own on public.practice_reports for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active());
create policy fb_read on public.report_feedback for select using (public.can_see_report(report_id));
create policy fb_insert on public.report_feedback for insert with check (author = auth.uid() and public.can_see_report(report_id));
create policy fb_delete on public.report_feedback for delete using (author = auth.uid() or public.is_officer());

-- 招生：開放報名期間任何人都能送出；只有幹部看得到與處理
create policy app_submit on public.applications for insert to anon, authenticated with check (
  status = 'new' and officer_note = ''
  and coalesce((select (value)::text = 'true' from public.settings where key = 'recruit_open'), false));
create policy app_officer on public.applications for select using (public.is_officer());
create policy app_officer_upd on public.applications for update using (public.is_officer()) with check (public.is_officer());
create policy app_officer_del on public.applications for delete using (public.is_officer());
create policy set_read_recruit on public.settings for select to anon using (key = 'recruit_open');

-- =====================================================================
-- 樂譜檔案（Storage）
-- =====================================================================
insert into storage.buckets (id, name, public) values ('scores', 'scores', false) on conflict (id) do nothing;
drop policy if exists scores_read on storage.objects;
drop policy if exists scores_write on storage.objects;
drop policy if exists scores_delete on storage.objects;
create policy scores_read on storage.objects for select using (
  bucket_id = 'scores' and (public.is_staff() or exists (
    select 1 from public.scores s where s.file_path = storage.objects.name and public.can_read_score(s))));
create policy scores_write on storage.objects for insert with check (bucket_id = 'scores' and public.is_officer());
create policy scores_delete on storage.objects for delete using (bucket_id = 'scores' and public.is_officer());
