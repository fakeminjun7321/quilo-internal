-- chem-pre-lab-web: 사용자 등록 + 한도 시스템 DB 스키마
-- Supabase Dashboard → SQL Editor에 통째로 붙여넣고 Run.

-- ── 사용자 테이블 ────────────────────────────────────────────────────────────
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  student_id text not null default '',
  password_hash text not null,
  budget_usd numeric(10, 4) not null default 0,
  spent_usd numeric(10, 4) not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_name_idx on users (lower(name));

-- ── 사용량 로그 ──────────────────────────────────────────────────────────────
create table if not exists usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  job_id text,
  text_cost_usd numeric(10, 6) not null default 0,
  image_cost_usd numeric(10, 6) not null default 0,
  total_usd numeric(10, 6) not null default 0,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_logs_user_id_idx on usage_logs (user_id, created_at desc);

-- ── updated_at 자동 갱신 트리거 ─────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ── RLS (Row-Level Security) ─────────────────────────────────────────────────
-- service_role 키는 RLS를 우회하므로 안전. 단, anon 키 노출 방지를 위해
-- RLS는 켜두고 공개 정책을 만들지 않음.
alter table users enable row level security;
alter table usage_logs enable row level security;

-- ── 끝 ─────────────────────────────────────────────────────────────────────
