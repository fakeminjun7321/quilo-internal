create extension if not exists pgcrypto;

create table if not exists public.classbot_schema_meta (
  id integer primary key check (id = 1),
  version integer not null check (version > 0),
  applied_at timestamptz not null default now()
);

insert into public.classbot_schema_meta(id, version, applied_at)
values (1, 7, now())
on conflict (id) do update set version = excluded.version, applied_at = excluded.applied_at;

create or replace function public.classbot_health_check()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select version from public.classbot_schema_meta where id = 1;
$$;

revoke all on function public.classbot_health_check() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_health_check() to service_role';
  end if;
end;
$$;

create table if not exists public.classbot_classes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  timezone text not null default 'Asia/Seoul',
  daily_digest_time time not null default '07:00',
  daily_digest_enabled boolean not null default true,
  max_members integer not null default 16 check (max_members between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classbot_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  display_name text not null,
  role text not null default 'student' check (role in ('admin', 'student')),
  kakao_user_key text unique,
  kakao_user_key_type text not null default 'botUserKey' check (kakao_user_key_type in ('botUserKey', 'plusfriendUserKey', 'appUserId')),
  notification_enabled boolean not null default true,
  daily_digest_enabled boolean not null default true,
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled', 'left')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.classbot_create_member(
  p_class_id uuid,
  p_display_name text,
  p_role text default 'student'
)
returns setof public.classbot_members
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_class public.classbot_classes%rowtype;
  created_member public.classbot_members%rowtype;
begin
  if coalesce(trim(p_display_name), '') = '' then
    raise exception '구성원 이름을 입력해 주세요.';
  end if;
  if p_role not in ('admin', 'student') then
    raise exception '올바른 구성원 역할이 아닙니다.';
  end if;

  select *
    into selected_class
    from public.classbot_classes
   where id = p_class_id
   for update;

  if not found then
    raise exception '학급을 찾을 수 없습니다.';
  end if;
  if (
    select count(*) from public.classbot_members
     where class_id = p_class_id and status <> 'left'
  ) >= selected_class.max_members then
    raise exception '학급 정원을 초과할 수 없습니다.';
  end if;

  insert into public.classbot_members(class_id, display_name, role)
  values (p_class_id, trim(p_display_name), p_role)
  returning * into created_member;

  return next created_member;
end;
$$;

revoke all on function public.classbot_create_member(uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_create_member(uuid, text, text) to service_role';
  end if;
end;
$$;

create or replace function public.classbot_seed_members_if_empty(
  p_class_id uuid,
  p_members jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_class public.classbot_classes%rowtype;
  seeded_count integer := 0;
begin
  select *
    into selected_class
    from public.classbot_classes
   where id = p_class_id
   for update;

  if not found then
    raise exception '학급을 찾을 수 없습니다.';
  end if;
  if exists (select 1 from public.classbot_members where class_id = p_class_id) then
    return 0;
  end if;
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) > selected_class.max_members then
    raise exception '초기 구성원 명단이 올바르지 않습니다.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_members) as member_data(display_name text, role text)
     where coalesce(trim(member_data.display_name), '') = ''
        or member_data.role not in ('admin', 'student')
  ) then
    raise exception '초기 구성원 이름 또는 역할이 올바르지 않습니다.';
  end if;

  insert into public.classbot_members(class_id, display_name, role, status)
  select p_class_id, trim(member_data.display_name), member_data.role, 'invited'
    from jsonb_to_recordset(p_members) as member_data(display_name text, role text);
  get diagnostics seeded_count = row_count;
  return seeded_count;
end;
$$;

revoke all on function public.classbot_seed_members_if_empty(uuid, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_seed_members_if_empty(uuid, jsonb) to service_role';
  end if;
end;
$$;

create table if not exists public.classbot_invites (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  portal_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.classbot_invites add column if not exists portal_used_at timestamptz;

drop function if exists public.classbot_claim_invite(text, text, text);

create or replace function public.classbot_claim_invite(
  p_class_id uuid,
  p_code_hash text,
  p_user_key text,
  p_user_key_type text default 'botUserKey'
)
returns setof public.classbot_members
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_invite public.classbot_invites%rowtype;
  claimed_member public.classbot_members%rowtype;
begin
  if coalesce(trim(p_user_key), '') = '' then
    raise exception '카카오 사용자 식별값이 필요합니다.';
  end if;
  if p_user_key_type not in ('botUserKey', 'plusfriendUserKey', 'appUserId') then
    raise exception '올바른 카카오 사용자 식별값 유형이 아닙니다.';
  end if;

  select *
    into selected_invite
    from public.classbot_invites
   where class_id = p_class_id and code_hash = p_code_hash
   for update;

  if not found or selected_invite.used_at is not null or selected_invite.expires_at <= now() then
    raise exception '초대 코드가 올바르지 않거나 만료되었습니다.';
  end if;

  if exists (
    select 1 from public.classbot_members
     where class_id = p_class_id and kakao_user_key = p_user_key and id <> selected_invite.member_id
  ) then
    raise exception '이미 다른 구성원으로 가입된 카카오 계정입니다.';
  end if;

  update public.classbot_members
     set kakao_user_key = p_user_key,
         kakao_user_key_type = p_user_key_type,
         status = 'active',
         joined_at = now(),
         updated_at = now()
   where class_id = p_class_id and id = selected_invite.member_id
   returning * into claimed_member;

  if not found then
    raise exception '초대 대상 구성원을 찾을 수 없습니다.';
  end if;

  update public.classbot_invites set used_at = now() where class_id = p_class_id and id = selected_invite.id;
  return next claimed_member;
end;
$$;

revoke all on function public.classbot_claim_invite(uuid, text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_claim_invite(uuid, text, text, text) to service_role';
  end if;
end;
$$;

create or replace function public.classbot_claim_member_by_name(
  p_class_id uuid,
  p_display_name text,
  p_user_key text,
  p_user_key_type text default 'botUserKey'
)
returns setof public.classbot_members
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_class public.classbot_classes%rowtype;
  selected_member public.classbot_members%rowtype;
  matching_count integer;
begin
  if coalesce(trim(p_display_name), '') = '' then
    raise exception '명단의 이름을 정확히 입력해 주세요.';
  end if;
  if char_length(trim(p_display_name)) > 40 then
    raise exception '명단의 이름을 40자 이내로 정확히 입력해 주세요.';
  end if;
  if coalesce(trim(p_user_key), '') = '' then
    raise exception '카카오 사용자 식별값이 필요합니다.';
  end if;
  if p_user_key_type not in ('botUserKey', 'plusfriendUserKey', 'appUserId') then
    raise exception '올바른 카카오 사용자 식별값 유형이 아닙니다.';
  end if;

  select * into selected_class
    from public.classbot_classes
   where id = p_class_id
   for update;
  if not found then
    raise exception '학급을 찾을 수 없습니다.';
  end if;

  select count(*) into matching_count
    from public.classbot_members
   where class_id = p_class_id
     and status <> 'left'
     and display_name = trim(p_display_name);
  if matching_count = 0 then
    raise exception '명단에서 이름을 찾을 수 없습니다. 이름을 정확히 입력해 주세요.';
  end if;
  if matching_count > 1 then
    raise exception '명단에 동명이인이 있어 이름만으로 등록할 수 없습니다.';
  end if;

  select * into selected_member
    from public.classbot_members
   where class_id = p_class_id
     and status <> 'left'
     and display_name = trim(p_display_name)
   for update;
  if selected_member.status = 'disabled' then
    raise exception '비활성 구성원은 이름을 등록할 수 없습니다.';
  end if;
  if exists (
    select 1 from public.classbot_members
     where kakao_user_key = trim(p_user_key)
       and id <> selected_member.id
  ) then
    raise exception '이미 다른 구성원으로 등록된 카카오 계정입니다.';
  end if;
  if selected_member.kakao_user_key is not null
     and selected_member.kakao_user_key <> trim(p_user_key) then
    raise exception '이미 다른 카카오 계정에 등록된 이름입니다. 관리자에게 문의해 주세요.';
  end if;
  if selected_member.kakao_user_key = trim(p_user_key)
     and selected_member.status = 'active' then
    return next selected_member;
    return;
  end if;

  update public.classbot_members
     set kakao_user_key = trim(p_user_key),
         kakao_user_key_type = p_user_key_type,
         status = 'active',
         joined_at = coalesce(joined_at, now()),
         updated_at = now()
   where class_id = p_class_id and id = selected_member.id
   returning * into selected_member;
  return next selected_member;
end;
$$;

revoke all on function public.classbot_claim_member_by_name(uuid, text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_claim_member_by_name(uuid, text, text, text) to service_role';
  end if;
end;
$$;

create table if not exists public.classbot_timetable (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 5),
  period integer not null check (period between 1 and 12),
  subject text not null,
  activity text not null default '',
  teacher text not null default '',
  room text not null default '',
  memo text not null default '',
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, weekday, period, effective_from)
);

-- Individual timetables are kept separate from the class-wide fallback. The
-- composite member key prevents a service-side bug from attaching a member's
-- timetable to a different class.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'classbot_members_class_id_id_key'
       and conrelid = 'public.classbot_members'::regclass
  ) then
    alter table public.classbot_members
      add constraint classbot_members_class_id_id_key unique (class_id, id);
  end if;
end;
$$;

create table if not exists public.classbot_member_timetable (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  member_id uuid not null,
  weekday integer not null check (weekday between 1 and 5),
  period integer not null check (period between 1 and 12),
  subject text not null check (char_length(trim(subject)) between 1 and 100),
  activity text not null default '' check (char_length(activity) <= 300),
  teacher text not null default '' check (char_length(teacher) <= 100),
  room text not null default '' check (char_length(room) <= 100),
  memo text not null default '' check (char_length(memo) <= 500),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classbot_member_timetable_member_fkey
    foreign key (class_id, member_id)
    references public.classbot_members(class_id, id)
    on delete cascade,
  constraint classbot_member_timetable_effective_dates_check
    check (effective_to is null or effective_to >= effective_from),
  constraint classbot_member_timetable_slot_key
    unique (class_id, member_id, weekday, period, effective_from)
);

create index if not exists classbot_member_timetable_lookup_idx
  on public.classbot_member_timetable(class_id, member_id, weekday, effective_from, effective_to, period);

create or replace function public.classbot_replace_timetable_day(
  p_class_id uuid,
  p_weekday integer,
  p_rows jsonb
)
returns setof public.classbot_timetable
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_weekday < 1 or p_weekday > 5 then
    raise exception '요일은 1부터 5 사이여야 합니다.';
  end if;
  perform 1 from public.classbot_classes where id = p_class_id for update;
  if not found then
    raise exception '학급을 찾을 수 없습니다.';
  end if;

  delete from public.classbot_timetable
   where class_id = p_class_id and weekday = p_weekday;

  return query
  with inserted as (
    insert into public.classbot_timetable(
      class_id, weekday, period, subject, activity, teacher, room, memo, effective_from, effective_to
    )
    select
      p_class_id,
      p_weekday,
      row_data.period,
      trim(row_data.subject),
      coalesce(trim(row_data.activity), ''),
      coalesce(trim(row_data.teacher), ''),
      coalesce(trim(row_data.room), ''),
      coalesce(trim(row_data.memo), ''),
      coalesce(row_data.effective_from, current_date),
      row_data.effective_to
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      period integer,
      subject text,
      activity text,
      teacher text,
      room text,
      memo text,
      effective_from date,
      effective_to date
    )
    where nullif(trim(row_data.subject), '') is not null
    returning *
  )
  select * from inserted order by period;
end;
$$;

revoke all on function public.classbot_replace_timetable_day(uuid, integer, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_replace_timetable_day(uuid, integer, jsonb) to service_role';
  end if;
end;
$$;

create or replace function public.classbot_replace_member_timetable(
  p_class_id uuid,
  p_member_id uuid,
  p_rows jsonb
)
returns setof public.classbot_member_timetable
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception '개인 시간표 데이터는 배열이어야 합니다.';
  end if;

  perform 1
    from public.classbot_members
   where class_id = p_class_id
     and id = p_member_id
     and status <> 'left'
   for update;
  if not found then
    raise exception '개인 시간표를 등록할 구성원을 찾을 수 없습니다.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
        weekday integer,
        period integer,
        subject text,
        activity text,
        teacher text,
        room text,
        memo text,
        effective_from date,
        effective_to date
      )
     where row_data.weekday is null
        or row_data.weekday < 1
        or row_data.weekday > 5
        or row_data.period is null
        or row_data.period < 1
        or row_data.period > 12
        or nullif(trim(row_data.subject), '') is null
        or char_length(trim(row_data.subject)) > 100
        or char_length(coalesce(row_data.activity, '')) > 300
        or char_length(coalesce(row_data.teacher, '')) > 100
        or char_length(coalesce(row_data.room, '')) > 100
        or char_length(coalesce(row_data.memo, '')) > 500
        or (
          row_data.effective_to is not null
          and row_data.effective_to < coalesce(row_data.effective_from, current_date)
        )
  ) then
    raise exception '개인 시간표 행 형식이 올바르지 않습니다.';
  end if;

  delete from public.classbot_member_timetable
   where class_id = p_class_id and member_id = p_member_id;

  return query
  with inserted as (
    insert into public.classbot_member_timetable(
      class_id, member_id, weekday, period, subject, activity, teacher, room, memo, effective_from, effective_to
    )
    select
      p_class_id,
      p_member_id,
      row_data.weekday,
      row_data.period,
      trim(row_data.subject),
      coalesce(trim(row_data.activity), ''),
      coalesce(trim(row_data.teacher), ''),
      coalesce(trim(row_data.room), ''),
      coalesce(trim(row_data.memo), ''),
      coalesce(row_data.effective_from, current_date),
      row_data.effective_to
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      weekday integer,
      period integer,
      subject text,
      activity text,
      teacher text,
      room text,
      memo text,
      effective_from date,
      effective_to date
    )
    returning *
  )
  select * from inserted order by weekday, period, effective_from desc;
end;
$$;

revoke all on function public.classbot_replace_member_timetable(uuid, uuid, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_replace_member_timetable(uuid, uuid, jsonb) to service_role';
  end if;
end;
$$;

create table if not exists public.classbot_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid references public.classbot_members(id) on delete cascade,
  category text not null check (category in ('assessment', 'assignment', 'class', 'schedule_change', 'notice')),
  subject text not null default '',
  title text not null,
  description text not null default '',
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  reminder_offsets integer[] not null default array[4320, 1440, 0],
  notify_on_change boolean not null default true,
  request_key text,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.classbot_events add column if not exists request_key text;
alter table public.classbot_events add column if not exists member_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'classbot_events_member_id_fkey'
       and conrelid = 'public.classbot_events'::regclass
  ) then
    alter table public.classbot_events
      add constraint classbot_events_member_id_fkey
      foreign key (member_id) references public.classbot_members(id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists classbot_events_request_key_idx
  on public.classbot_events(class_id, request_key)
  where request_key is not null;

create index if not exists classbot_events_due_idx on public.classbot_events(class_id, status, due_at);
create index if not exists classbot_events_member_due_idx on public.classbot_events(class_id, member_id, status, due_at);

create table if not exists public.classbot_notices (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  pinned boolean not null default false,
  notify_on_publish boolean not null default true,
  request_key text,
  created_by text not null default 'admin',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'published') or (published_at is not null))
);

create index if not exists classbot_notices_list_idx
  on public.classbot_notices(class_id, status, pinned desc, published_at desc, created_at desc);

create unique index if not exists classbot_notices_request_key_idx
  on public.classbot_notices(class_id, request_key)
  where request_key is not null;

create table if not exists public.classbot_files (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid references public.classbot_members(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 60),
  filename text not null check (char_length(filename) between 1 and 180),
  description text not null default '' check (char_length(description) <= 1000),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  bucket text not null,
  object_path text not null unique,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists classbot_files_class_alias_idx
  on public.classbot_files(class_id, lower(alias))
  where member_id is null and status = 'active';

create unique index if not exists classbot_files_member_alias_idx
  on public.classbot_files(class_id, member_id, lower(alias))
  where member_id is not null and status = 'active';

create index if not exists classbot_files_list_idx
  on public.classbot_files(class_id, status, created_at desc);

create table if not exists public.classbot_kakao_states (
  member_id uuid primary key references public.classbot_members(id) on delete cascade,
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  pending_file_ids text[] not null check (cardinality(pending_file_ids) between 1 and 3),
  pending_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, member_id)
    references public.classbot_members(class_id, id) on delete cascade
);

create index if not exists classbot_kakao_states_expiry_idx
  on public.classbot_kakao_states(class_id, pending_expires_at);

create table if not exists public.classbot_kakao_pending_actions (
  member_id uuid primary key references public.classbot_members(id) on delete cascade,
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  action text not null check (action in ('create', 'update', 'complete', 'delete')),
  event_id uuid references public.classbot_events(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, member_id)
    references public.classbot_members(class_id, id) on delete cascade,
  check ((action = 'create' and event_id is null) or (action <> 'create' and event_id is not null))
);

create index if not exists classbot_kakao_pending_actions_expiry_idx
  on public.classbot_kakao_pending_actions(class_id, expires_at);

create table if not exists public.classbot_notifications (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  event_id uuid references public.classbot_events(id) on delete set null,
  notice_id uuid references public.classbot_notices(id) on delete set null,
  idempotency_key text not null unique,
  kind text not null check (kind in ('daily_digest', 'event_reminder', 'schedule_change', 'notice', 'test')),
  scheduled_for timestamptz not null,
  status text not null default 'reserved' check (status in ('reserved', 'sent', 'failed', 'skipped')),
  task_id text,
  failure_reason text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep `schema.sql` safe to re-run against an earlier Classbot installation.
alter table public.classbot_notifications add column if not exists notice_id uuid references public.classbot_notices(id) on delete set null;
alter table public.classbot_notifications drop constraint if exists classbot_notifications_kind_check;
alter table public.classbot_notifications
  add constraint classbot_notifications_kind_check
  check (kind in ('daily_digest', 'event_reminder', 'schedule_change', 'notice', 'test'));

create index if not exists classbot_notifications_created_idx on public.classbot_notifications(class_id, created_at desc);

create table if not exists public.classbot_audit_logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.classbot_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'classbot_classes',
    'classbot_members',
    'classbot_timetable',
    'classbot_member_timetable',
    'classbot_events',
    'classbot_notices',
    'classbot_files',
    'classbot_kakao_states',
    'classbot_kakao_pending_actions',
    'classbot_notifications'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.classbot_set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

alter table public.classbot_classes enable row level security;
alter table public.classbot_schema_meta enable row level security;
alter table public.classbot_members enable row level security;
alter table public.classbot_invites enable row level security;
alter table public.classbot_timetable enable row level security;
alter table public.classbot_member_timetable enable row level security;
alter table public.classbot_events enable row level security;
alter table public.classbot_notices enable row level security;
alter table public.classbot_files enable row level security;
alter table public.classbot_kakao_states enable row level security;
alter table public.classbot_kakao_pending_actions enable row level security;
alter table public.classbot_notifications enable row level security;
alter table public.classbot_audit_logs enable row level security;

-- No anon/authenticated policies are created. The server uses the service role key,
-- and all browser access goes through the authenticated Classbot admin API.

-- Schema v7: 수행평가 고정 알림과 TKN 전용 허구 가상 주식.
update public.classbot_events
   set reminder_offsets = array[10080, 2880, 1440, 0], updated_at = now()
 where category = 'assessment'
   and reminder_offsets is distinct from array[10080, 2880, 1440, 0];

create or replace function public.classbot_enforce_assessment_reminders()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.category = 'assessment' then
    new.reminder_offsets := array[10080, 2880, 1440, 0];
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_assessment_reminders_insert on public.classbot_events;
create trigger enforce_assessment_reminders_insert before insert on public.classbot_events
for each row execute function public.classbot_enforce_assessment_reminders();
drop trigger if exists enforce_assessment_reminders_update on public.classbot_events;
create trigger enforce_assessment_reminders_update before update of category, reminder_offsets on public.classbot_events
for each row execute function public.classbot_enforce_assessment_reminders();

create table if not exists public.classbot_token_accounts (
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  balance bigint not null default 1000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (class_id, member_id),
  foreign key (class_id, member_id) references public.classbot_members(class_id, id) on delete cascade
);

create table if not exists public.classbot_token_ledger (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  kind text not null check (kind in ('daily_reward', 'buy', 'sell')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reference_key text not null check (char_length(reference_key) between 1 and 180),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (class_id, member_id) references public.classbot_members(class_id, id) on delete cascade,
  unique (class_id, member_id, reference_key)
);

create table if not exists public.classbot_market_positions (
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  symbol text not null check (symbol in ('QLR', 'BLW', 'NXT', 'GCR', 'SPW')),
  quantity integer not null default 0 check (quantity >= 0),
  average_cost bigint not null default 0 check (average_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (class_id, member_id, symbol),
  foreign key (class_id, member_id) references public.classbot_members(class_id, id) on delete cascade
);

create table if not exists public.classbot_market_trades (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  symbol text not null check (symbol in ('QLR', 'BLW', 'NXT', 'GCR', 'SPW')),
  side text not null check (side in ('buy', 'sell')),
  quantity integer not null check (quantity between 1 and 1000),
  price bigint not null check (price > 0),
  total bigint not null check (total = quantity::bigint * price),
  request_key text not null check (char_length(request_key) between 1 and 160),
  created_at timestamptz not null default now(),
  foreign key (class_id, member_id) references public.classbot_members(class_id, id) on delete cascade,
  unique (class_id, member_id, request_key)
);

create index if not exists classbot_token_ledger_member_created_idx
  on public.classbot_token_ledger(class_id, member_id, created_at desc);
create index if not exists classbot_market_trades_member_created_idx
  on public.classbot_market_trades(class_id, member_id, created_at desc);

create or replace function public.classbot_initialize_token_account()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.classbot_token_accounts(class_id, member_id, balance)
  values (new.class_id, new.id, 1000)
  on conflict (class_id, member_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_token_account on public.classbot_members;
create trigger initialize_token_account after insert on public.classbot_members
for each row execute function public.classbot_initialize_token_account();
revoke all on function public.classbot_initialize_token_account() from public;

insert into public.classbot_token_accounts(class_id, member_id, balance)
select class_id, id, 1000 from public.classbot_members
on conflict (class_id, member_id) do nothing;

create or replace function public.classbot_claim_daily_market_reward(
  p_class_id uuid, p_member_id uuid, p_reward_date date, p_amount integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  selected_timezone text;
  selected_account public.classbot_token_accounts%rowtype;
  created_ledger public.classbot_token_ledger%rowtype;
  reward_key text := 'daily:' || p_reward_date::text;
begin
  if p_amount < 1 or p_amount > 1000 then raise exception '접속 보상 금액이 올바르지 않습니다.'; end if;
  select c.timezone into selected_timezone
    from public.classbot_classes c join public.classbot_members m on m.class_id = c.id
   where c.id = p_class_id and m.id = p_member_id and m.status <> 'left';
  if selected_timezone is null then raise exception '가상 주식 계정 구성원을 찾을 수 없습니다.'; end if;
  if p_reward_date <> (clock_timestamp() at time zone selected_timezone)::date then
    raise exception '오늘 접속 보상만 받을 수 있습니다.';
  end if;
  insert into public.classbot_token_accounts(class_id, member_id, balance)
  values (p_class_id, p_member_id, 1000) on conflict (class_id, member_id) do nothing;
  select * into selected_account from public.classbot_token_accounts
   where class_id = p_class_id and member_id = p_member_id for update;
  if exists (select 1 from public.classbot_token_ledger where class_id = p_class_id and member_id = p_member_id and reference_key = reward_key) then
    return jsonb_build_object('claimed', false, 'balance', selected_account.balance);
  end if;
  update public.classbot_token_accounts set balance = balance + p_amount
   where class_id = p_class_id and member_id = p_member_id returning * into selected_account;
  insert into public.classbot_token_ledger(class_id, member_id, kind, amount, balance_after, reference_key, metadata)
  values (p_class_id, p_member_id, 'daily_reward', p_amount, selected_account.balance, reward_key, jsonb_build_object('reward_date', p_reward_date))
  returning * into created_ledger;
  return jsonb_build_object('claimed', true, 'ledger', to_jsonb(created_ledger));
end;
$$;

create or replace function public.classbot_execute_market_trade(
  p_class_id uuid, p_member_id uuid, p_symbol text, p_side text,
  p_quantity integer, p_price bigint, p_request_key text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  selected_account public.classbot_token_accounts%rowtype;
  selected_position public.classbot_market_positions%rowtype;
  existing_trade public.classbot_market_trades%rowtype;
  created_trade public.classbot_market_trades%rowtype;
  order_total bigint;
  next_quantity integer;
begin
  p_symbol := upper(trim(p_symbol)); p_side := lower(trim(p_side)); p_request_key := trim(p_request_key);
  if p_symbol not in ('QLR', 'BLW', 'NXT', 'GCR', 'SPW') then raise exception '존재하지 않는 가상 종목입니다.'; end if;
  if p_side not in ('buy', 'sell') then raise exception '매수 또는 매도를 선택해 주세요.'; end if;
  if p_quantity < 1 or p_quantity > 1000 then raise exception '주문 수량은 1~1000주 사이여야 합니다.'; end if;
  if p_price < 1 or p_price > 1000000 then raise exception '가상 종목 가격이 올바르지 않습니다.'; end if;
  if p_request_key = '' or char_length(p_request_key) > 160 then raise exception '주문 식별값이 올바르지 않습니다.'; end if;
  if not exists (select 1 from public.classbot_members where class_id = p_class_id and id = p_member_id and status <> 'left') then
    raise exception '가상 주식 계정 구성원을 찾을 수 없습니다.';
  end if;
  insert into public.classbot_token_accounts(class_id, member_id, balance)
  values (p_class_id, p_member_id, 1000) on conflict (class_id, member_id) do nothing;
  select * into selected_account from public.classbot_token_accounts
   where class_id = p_class_id and member_id = p_member_id for update;
  select * into existing_trade from public.classbot_market_trades
   where class_id = p_class_id and member_id = p_member_id and request_key = p_request_key;
  if found then return to_jsonb(existing_trade); end if;
  insert into public.classbot_market_positions(class_id, member_id, symbol, quantity, average_cost)
  values (p_class_id, p_member_id, p_symbol, 0, 0) on conflict (class_id, member_id, symbol) do nothing;
  select * into selected_position from public.classbot_market_positions
   where class_id = p_class_id and member_id = p_member_id and symbol = p_symbol for update;
  order_total := p_quantity::bigint * p_price;
  if p_side = 'buy' then
    if selected_account.balance < order_total then raise exception '보유 토큰이 부족해 매수할 수 없습니다.'; end if;
    next_quantity := selected_position.quantity + p_quantity;
    update public.classbot_market_positions set quantity = next_quantity,
      average_cost = round((selected_position.average_cost * selected_position.quantity + order_total)::numeric / next_quantity)::bigint
     where class_id = p_class_id and member_id = p_member_id and symbol = p_symbol;
    update public.classbot_token_accounts set balance = balance - order_total
     where class_id = p_class_id and member_id = p_member_id returning * into selected_account;
  else
    if selected_position.quantity < p_quantity then raise exception '보유 수량이 부족해 매도할 수 없습니다.'; end if;
    next_quantity := selected_position.quantity - p_quantity;
    update public.classbot_market_positions set quantity = next_quantity,
      average_cost = case when next_quantity = 0 then 0 else average_cost end
     where class_id = p_class_id and member_id = p_member_id and symbol = p_symbol;
    update public.classbot_token_accounts set balance = balance + order_total
     where class_id = p_class_id and member_id = p_member_id returning * into selected_account;
  end if;
  insert into public.classbot_market_trades(class_id, member_id, symbol, side, quantity, price, total, request_key)
  values (p_class_id, p_member_id, p_symbol, p_side, p_quantity, p_price, order_total, p_request_key)
  returning * into created_trade;
  insert into public.classbot_token_ledger(class_id, member_id, kind, amount, balance_after, reference_key, metadata)
  values (p_class_id, p_member_id, p_side, case when p_side = 'buy' then -order_total else order_total end,
    selected_account.balance, 'trade:' || p_request_key,
    jsonb_build_object('trade_id', created_trade.id, 'symbol', p_symbol, 'quantity', p_quantity, 'price', p_price));
  return to_jsonb(created_trade);
end;
$$;

revoke all on function public.classbot_claim_daily_market_reward(uuid, uuid, date, integer) from public;
revoke all on function public.classbot_execute_market_trade(uuid, uuid, text, text, integer, bigint, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.classbot_claim_daily_market_reward(uuid, uuid, date, integer) to service_role';
    execute 'grant execute on function public.classbot_execute_market_trade(uuid, uuid, text, text, integer, bigint, text) to service_role';
  end if;
end;
$$;

drop trigger if exists set_updated_at on public.classbot_token_accounts;
create trigger set_updated_at before update on public.classbot_token_accounts
for each row execute function public.classbot_set_updated_at();
drop trigger if exists set_updated_at on public.classbot_market_positions;
create trigger set_updated_at before update on public.classbot_market_positions
for each row execute function public.classbot_set_updated_at();

alter table public.classbot_token_accounts enable row level security;
alter table public.classbot_token_ledger enable row level security;
alter table public.classbot_market_positions enable row level security;
alter table public.classbot_market_trades enable row level security;
