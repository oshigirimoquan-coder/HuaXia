-- 團隊事務台：Supabase 資料表與權限
-- 用法：Supabase 後台 → SQL Editor → New query → 整份貼上 → Run。可重複執行。
-- 第一個登入的人會自動成為「負責人」(owner)，之後登入的人都是「待審核」。

-- ========== 資料表 ==========
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  avatar text,
  email text,
  role text not null default 'pending' check (role in ('pending','member','admin','owner')),
  joined_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  team_name text
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 120),
  descr text default '' check (char_length(descr) <= 2000),
  due date,
  assignees uuid[] not null default '{}',
  status text not null default 'todo' check (status in ('todo','doing','done')),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'event' check (kind in ('event','shift')),
  title text not null check (char_length(title) <= 100),
  date date not null,
  start_time text default '',
  end_time text default '',
  place text default '',
  capacity int not null default 0 check (capacity >= 0 and capacity <= 999),
  note text default '',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.signups (
  event_id uuid references public.events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.attendance (
  event_id uuid references public.events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  present boolean not null default true,
  primary key (event_id, user_id)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 120),
  body text default '' check (char_length(body) <= 5000),
  pinned boolean not null default false,
  author uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  ann_id uuid not null references public.announcements(id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  author uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ========== 身分判斷 ==========
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('member','admin','owner'), false)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','owner'), false)
$$;
create or replace function public.event_has_room(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.capacity = 0 or (select count(*) from public.signups s where s.event_id = e.id) < e.capacity
    from public.events e where e.id = eid), false)
$$;

-- 新使用者登入時建立個人資料；第一位成為負責人
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, avatar, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new.email,
    case when exists (select 1 from public.profiles where role = 'owner') then 'pending' else 'owner' end
  ) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 身分調整規則：負責人可調管理者；管理者只能核准/退回一般成員
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if auth.uid() is null then return new; end if;  -- SQL Editor / 後台操作不受限
  if new.id <> old.id or new.email is distinct from old.email then
    raise exception '不能修改帳號資料';
  end if;
  if new.role is distinct from old.role then
    if r = 'owner' then
      if old.role = 'owner' or new.role = 'owner' then raise exception '不能變更負責人身分'; end if;
    elsif r = 'admin' then
      if not (old.role in ('pending','member') and new.role in ('pending','member')) then
        raise exception '只有負責人能調整管理者';
      end if;
    else
      raise exception '沒有權限';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- ========== 存取規則 (RLS) ==========
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.signups enable row level security;
alter table public.attendance enable row level security;
alter table public.announcements enable row level security;
alter table public.comments enable row level security;

do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles','settings','tasks','events','signups','attendance','announcements','comments')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

-- 個人資料：自己看得到自己；正式成員看得到所有人
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_member());
create policy profiles_insert_self on public.profiles for insert with check (id = auth.uid() and role = 'pending');
create policy profiles_admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy profiles_admin_delete on public.profiles for delete
  using (public.is_admin() and role in ('pending','member') and id <> auth.uid());

-- 團隊名稱：所有人可讀（登入頁也要顯示）；只有負責人可改
create policy settings_read on public.settings for select using (true);
create policy settings_owner on public.settings for update using (public.my_role() = 'owner');

-- 任務：成員可讀、新增、更新；建立者或管理者可刪
create policy tasks_read on public.tasks for select using (public.is_member());
create policy tasks_insert on public.tasks for insert with check (public.is_member());
create policy tasks_update on public.tasks for update using (public.is_member()) with check (public.is_member());
create policy tasks_delete on public.tasks for delete using (public.is_admin() or created_by = auth.uid());

-- 活動／時段：成員可讀；管理者可改
create policy events_read on public.events for select using (public.is_member());
create policy events_write on public.events for all using (public.is_admin()) with check (public.is_admin());

-- 報名：成員可讀；只能幫自己報名，且有名額；自己或管理者可取消
create policy signups_read on public.signups for select using (public.is_member());
create policy signups_insert on public.signups for insert
  with check (user_id = auth.uid() and public.is_member() and public.event_has_room(event_id));
create policy signups_delete on public.signups for delete using (user_id = auth.uid() or public.is_admin());

-- 出席：成員可讀；管理者點名
create policy attendance_read on public.attendance for select using (public.is_member());
create policy attendance_write on public.attendance for all using (public.is_admin()) with check (public.is_admin());

-- 公告：成員可讀；管理者發布
create policy ann_read on public.announcements for select using (public.is_member());
create policy ann_write on public.announcements for all using (public.is_admin()) with check (public.is_admin());

-- 留言：成員可讀可留言（只能用自己的名義）；作者或管理者可刪
create policy cmt_read on public.comments for select using (public.is_member());
create policy cmt_insert on public.comments for insert with check (public.is_member() and author = auth.uid());
create policy cmt_delete on public.comments for delete using (author = auth.uid() or public.is_admin());

-- ========== 即時同步 ==========
do $$ declare t text; begin
  foreach t in array array['profiles','settings','tasks','events','signups','attendance','announcements','comments'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
