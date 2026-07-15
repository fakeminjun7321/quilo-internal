import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.resolve(here, "../../db/schema.sql"), "utf8");
const storeSource = fs.readFileSync(path.resolve(here, "supabase-store.js"), "utf8");

test("구성원 정원과 시간표 교체는 DB lock 기반 RPC로 원자화한다", () => {
  const memberFunction = schema.match(/create or replace function public\.classbot_create_member[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(memberFunction, /for update/);
  assert.match(memberFunction, /status <> 'left'/);
  assert.match(memberFunction, /selected_class\.max_members/);
  assert.match(storeSource, /\.rpc\("classbot_create_member"/);

  const timetableFunction = schema.match(/create or replace function public\.classbot_replace_timetable_day[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(timetableFunction, /for update/);
  assert.match(timetableFunction, /delete from public\.classbot_timetable/);
  assert.match(storeSource, /\.rpc\("classbot_replace_timetable_day"/);
});

test("초대 claim RPC와 단건 store 조작은 class_id scope를 사용한다", () => {
  const claimFunction = schema.match(/create or replace function public\.classbot_claim_invite[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(claimFunction, /class_id = p_class_id and code_hash/);
  assert.match(storeSource, /classbot_members"\)\.update\(allowed\)\.eq\("class_id", classroom\.id\)\.eq\("id", memberId\)/);
  assert.match(storeSource, /classbot_events"\)\.select\("\*"\)\.eq\("class_id", classroom\.id\)\.eq\("id", eventId\)/);
  assert.match(storeSource, /classbot_events"\)\.update\(allowed\)\.eq\("class_id", classroom\.id\)\.eq\("id", eventId\)/);
  assert.match(storeSource, /classbot_notifications"\)\.update\(changes\)\.eq\("class_id", classroom\.id\)/);
});

test("스키마 버전 health RPC와 전체 RLS가 운영 준비 상태를 검증한다", () => {
  assert.match(schema, /create table if not exists public\.classbot_schema_meta/);
  assert.match(schema, /create or replace function public\.classbot_health_check\(\)/);
  assert.match(schema, /grant execute on function public\.classbot_health_check\(\) to service_role/);
  for (const table of ["schema_meta", "classes", "members", "invites", "timetable", "events", "notices", "notifications", "audit_logs"]) {
    assert.match(schema, new RegExp(`alter table public\\.classbot_${table} enable row level security`));
  }
  assert.match(storeSource, /\.rpc\("classbot_health_check"\)/);
  assert.match(storeSource, /result\.error\.code === "23505"/);
});

test("개인 일정은 nullable member FK와 대상별 반 전체 포함 조회를 사용한다", () => {
  assert.match(schema, /classbot_events[\s\S]*member_id uuid references public\.classbot_members\(id\) on delete cascade/);
  assert.match(schema, /classbot_events_member_due_idx/);
  assert.match(storeSource, /targetMemberId[\s\S]*member_id\.is\.null,member_id\.eq/);
  assert.match(storeSource, /member_id: input\.member_id \|\| null/);
});

test("초기 명단 RPC는 학급 lock 뒤 구성원이 0명일 때만 invited로 일괄 생성한다", () => {
  const seedFunction = schema.match(/create or replace function public\.classbot_seed_members_if_empty[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(seedFunction, /for update/);
  assert.match(seedFunction, /if exists \(select 1 from public\.classbot_members where class_id = p_class_id\)[\s\S]*return 0/);
  assert.match(seedFunction, /member_data\.role, 'invited'/);
  assert.match(storeSource, /\.rpc\("classbot_seed_members_if_empty"/);
});
