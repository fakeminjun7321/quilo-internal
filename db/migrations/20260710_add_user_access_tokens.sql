-- Quilo 외부 API / Codex 플러그인용 사용자 범위 제한 액세스 토큰.
-- 평문 토큰은 생성 응답에서 한 번만 보여주며 DB에는 SHA-256 해시만 저장한다.

create table if not exists user_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  token_prefix text not null check (char_length(token_prefix) = 8),
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_access_tokens_user_idx
  on user_access_tokens (user_id, created_at desc);

create index if not exists user_access_tokens_active_idx
  on user_access_tokens (token_hash, expires_at)
  where revoked_at is null;

alter table user_access_tokens enable row level security;
revoke all on table user_access_tokens from anon, authenticated;
grant select, insert, update, delete on table user_access_tokens to service_role;
