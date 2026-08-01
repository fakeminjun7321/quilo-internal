-- Classbot schema v7: 수행평가 고정 알림 정책과 TKN 전용 허구 가상 주식.

update public.classbot_events
   set reminder_offsets = array[10080, 2880, 1440, 0], updated_at = now()
 where category = 'assessment'
   and reminder_offsets is distinct from array[10080, 2880, 1440, 0];

create or replace function public.classbot_enforce_assessment_reminders()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category = 'assessment' then
    new.reminder_offsets := array[10080, 2880, 1440, 0];
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_assessment_reminders_insert on public.classbot_events;
create trigger enforce_assessment_reminders_insert
before insert on public.classbot_events
for each row execute function public.classbot_enforce_assessment_reminders();
drop trigger if exists enforce_assessment_reminders_update on public.classbot_events;
create trigger enforce_assessment_reminders_update
before update of category, reminder_offsets on public.classbot_events
for each row execute function public.classbot_enforce_assessment_reminders();

create table if not exists public.classbot_token_accounts (
  class_id uuid not null references public.classbot_classes(id) on delete cascade,
  member_id uuid not null references public.classbot_members(id) on delete cascade,
  balance bigint not null default 1000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (class_id, member_id),
  foreign key (class_id, member_id)
    references public.classbot_members(class_id, id) on delete cascade
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
  foreign key (class_id, member_id)
    references public.classbot_members(class_id, id) on delete cascade,
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
  foreign key (class_id, member_id)
    references public.classbot_members(class_id, id) on delete cascade
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
  foreign key (class_id, member_id)
    references public.classbot_members(class_id, id) on delete cascade,
  unique (class_id, member_id, request_key)
);

create index if not exists classbot_token_ledger_member_created_idx
  on public.classbot_token_ledger(class_id, member_id, created_at desc);
create index if not exists classbot_market_trades_member_created_idx
  on public.classbot_market_trades(class_id, member_id, created_at desc);

create or replace function public.classbot_initialize_token_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.classbot_token_accounts(class_id, member_id, balance)
  values (new.class_id, new.id, 1000)
  on conflict (class_id, member_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_token_account on public.classbot_members;
create trigger initialize_token_account
after insert on public.classbot_members
for each row execute function public.classbot_initialize_token_account();
revoke all on function public.classbot_initialize_token_account() from public;

insert into public.classbot_token_accounts(class_id, member_id, balance)
select class_id, id, 1000 from public.classbot_members
on conflict (class_id, member_id) do nothing;

create or replace function public.classbot_claim_daily_market_reward(
  p_class_id uuid,
  p_member_id uuid,
  p_reward_date date,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_timezone text;
  selected_account public.classbot_token_accounts%rowtype;
  created_ledger public.classbot_token_ledger%rowtype;
  reward_key text := 'daily:' || p_reward_date::text;
begin
  if p_amount < 1 or p_amount > 1000 then
    raise exception '접속 보상 금액이 올바르지 않습니다.';
  end if;
  select c.timezone into selected_timezone
    from public.classbot_classes c
    join public.classbot_members m on m.class_id = c.id
   where c.id = p_class_id and m.id = p_member_id and m.status <> 'left';
  if selected_timezone is null then
    raise exception '가상 주식 계정 구성원을 찾을 수 없습니다.';
  end if;
  if p_reward_date <> (clock_timestamp() at time zone selected_timezone)::date then
    raise exception '오늘 접속 보상만 받을 수 있습니다.';
  end if;

  insert into public.classbot_token_accounts(class_id, member_id, balance)
  values (p_class_id, p_member_id, 1000)
  on conflict (class_id, member_id) do nothing;
  select * into selected_account
    from public.classbot_token_accounts
   where class_id = p_class_id and member_id = p_member_id
   for update;

  if exists (
    select 1 from public.classbot_token_ledger
     where class_id = p_class_id and member_id = p_member_id and reference_key = reward_key
  ) then
    return jsonb_build_object('claimed', false, 'balance', selected_account.balance);
  end if;

  update public.classbot_token_accounts
     set balance = balance + p_amount
   where class_id = p_class_id and member_id = p_member_id
   returning * into selected_account;
  insert into public.classbot_token_ledger(class_id, member_id, kind, amount, balance_after, reference_key, metadata)
  values (p_class_id, p_member_id, 'daily_reward', p_amount, selected_account.balance, reward_key, jsonb_build_object('reward_date', p_reward_date))
  returning * into created_ledger;
  return jsonb_build_object('claimed', true, 'ledger', to_jsonb(created_ledger));
end;
$$;

create or replace function public.classbot_execute_market_trade(
  p_class_id uuid,
  p_member_id uuid,
  p_symbol text,
  p_side text,
  p_quantity integer,
  p_price bigint,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_account public.classbot_token_accounts%rowtype;
  selected_position public.classbot_market_positions%rowtype;
  existing_trade public.classbot_market_trades%rowtype;
  created_trade public.classbot_market_trades%rowtype;
  order_total bigint;
  next_quantity integer;
begin
  p_symbol := upper(trim(p_symbol));
  p_side := lower(trim(p_side));
  p_request_key := trim(p_request_key);
  if p_symbol not in ('QLR', 'BLW', 'NXT', 'GCR', 'SPW') then raise exception '존재하지 않는 가상 종목입니다.'; end if;
  if p_side not in ('buy', 'sell') then raise exception '매수 또는 매도를 선택해 주세요.'; end if;
  if p_quantity < 1 or p_quantity > 1000 then raise exception '주문 수량은 1~1000주 사이여야 합니다.'; end if;
  if p_price < 1 or p_price > 1000000 then raise exception '가상 종목 가격이 올바르지 않습니다.'; end if;
  if p_request_key = '' or char_length(p_request_key) > 160 then raise exception '주문 식별값이 올바르지 않습니다.'; end if;
  if not exists (
    select 1 from public.classbot_members
     where class_id = p_class_id and id = p_member_id and status <> 'left'
  ) then raise exception '가상 주식 계정 구성원을 찾을 수 없습니다.'; end if;

  insert into public.classbot_token_accounts(class_id, member_id, balance)
  values (p_class_id, p_member_id, 1000)
  on conflict (class_id, member_id) do nothing;
  select * into selected_account
    from public.classbot_token_accounts
   where class_id = p_class_id and member_id = p_member_id
   for update;

  select * into existing_trade
    from public.classbot_market_trades
   where class_id = p_class_id and member_id = p_member_id and request_key = p_request_key;
  if found then return to_jsonb(existing_trade); end if;

  insert into public.classbot_market_positions(class_id, member_id, symbol, quantity, average_cost)
  values (p_class_id, p_member_id, p_symbol, 0, 0)
  on conflict (class_id, member_id, symbol) do nothing;
  select * into selected_position
    from public.classbot_market_positions
   where class_id = p_class_id and member_id = p_member_id and symbol = p_symbol
   for update;

  order_total := p_quantity::bigint * p_price;
  if p_side = 'buy' then
    if selected_account.balance < order_total then raise exception '보유 토큰이 부족해 매수할 수 없습니다.'; end if;
    next_quantity := selected_position.quantity + p_quantity;
    update public.classbot_market_positions
       set quantity = next_quantity,
           average_cost = round((selected_position.average_cost * selected_position.quantity + order_total)::numeric / next_quantity)::bigint
     where class_id = p_class_id and member_id = p_member_id and symbol = p_symbol;
    update public.classbot_token_accounts
       set balance = balance - order_total
     where class_id = p_class_id and member_id = p_member_id
     returning * into selected_account;
  else
    if selected_position.quantity < p_quantity then raise exception '보유 수량이 부족해 매도할 수 없습니다.'; end if;
    next_quantity := selected_position.quantity - p_quantity;
    update public.classbot_market_positions
       set quantity = next_quantity,
           average_cost = case when next_quantity = 0 then 0 else average_cost end
     where class_id = p_class_id and member_id = p_member_id and symbol = p_symbol;
    update public.classbot_token_accounts
       set balance = balance + order_total
     where class_id = p_class_id and member_id = p_member_id
     returning * into selected_account;
  end if;

  insert into public.classbot_market_trades(class_id, member_id, symbol, side, quantity, price, total, request_key)
  values (p_class_id, p_member_id, p_symbol, p_side, p_quantity, p_price, order_total, p_request_key)
  returning * into created_trade;
  insert into public.classbot_token_ledger(class_id, member_id, kind, amount, balance_after, reference_key, metadata)
  values (
    p_class_id, p_member_id, p_side,
    case when p_side = 'buy' then -order_total else order_total end,
    selected_account.balance, 'trade:' || p_request_key,
    jsonb_build_object('trade_id', created_trade.id, 'symbol', p_symbol, 'quantity', p_quantity, 'price', p_price)
  );
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

insert into public.classbot_schema_meta(id, version, applied_at)
values (1, 7, now())
on conflict (id) do update set version = excluded.version, applied_at = excluded.applied_at;
