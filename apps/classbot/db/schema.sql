create extension if not exists pgcrypto;

create table if not exists public.classbot_schema_meta (
  id integer primary key check (id = 1),
  version integer not null check (version > 0),
  applied_at timestamptz not null default now()
);

insert into public.classbot_schema_meta(id, version, applied_at)
values (1, 1, now())
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
  created_at timestamptz not null default now()
);

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
    'classbot_events',
    'classbot_notices',
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
alter table public.classbot_events enable row level security;
alter table public.classbot_notices enable row level security;
alter table public.classbot_notifications enable row level security;
alter table public.classbot_audit_logs enable row level security;

-- No anon/authenticated policies are created. The server uses the service role key,
-- and all browser access goes through the authenticated Classbot admin API.
