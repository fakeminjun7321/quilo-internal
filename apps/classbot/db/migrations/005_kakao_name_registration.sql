-- Classbot schema v5: exact roster-name Kakao registration and short-lived
-- pending file candidates used by the conversational file confirmation flow.

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

drop trigger if exists set_updated_at on public.classbot_kakao_states;
create trigger set_updated_at
before update on public.classbot_kakao_states
for each row execute function public.classbot_set_updated_at();

alter table public.classbot_kakao_states enable row level security;

insert into public.classbot_schema_meta(id, version, applied_at)
values (1, 5, now())
on conflict (id) do update set version = excluded.version, applied_at = excluded.applied_at;
