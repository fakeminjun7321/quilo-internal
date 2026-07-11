-- Quilo 개발자 플랫폼 1차: API 요청 감사 로그와 idempotency 응답 저장소.
-- service_role 전용이며 브라우저 Supabase 클라이언트에서 직접 읽을 수 없다.

create table if not exists api_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_id uuid references user_access_tokens(id) on delete set null,
  request_id text not null unique,
  method text not null,
  path text not null,
  scope text not null,
  status integer not null,
  duration_ms integer not null default 0,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists api_request_logs_user_created_idx
  on api_request_logs (user_id, created_at desc);

create table if not exists api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_id uuid references user_access_tokens(id) on delete set null,
  operation text not null,
  idempotency_key text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (user_id, operation, idempotency_key)
);

create index if not exists api_idempotency_keys_expiry_idx
  on api_idempotency_keys (expires_at);

alter table api_request_logs enable row level security;
alter table api_idempotency_keys enable row level security;
revoke all on table api_request_logs, api_idempotency_keys from anon, authenticated;
grant select, insert, update, delete on table api_request_logs, api_idempotency_keys to service_role;
