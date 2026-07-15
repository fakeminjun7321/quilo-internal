import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseStore } from "./supabase-store.js";

function fixture(rpcResult) {
  const calls = [];
  const audits = [];
  const store = Object.create(SupabaseStore.prototype);
  store.config = { classCode: "2-4", className: "2학년 4반", timezone: "Asia/Seoul" };
  store.classroom = { id: "class-private" };
  store.client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: rpcResult, error: null };
    },
  };
  store.appendAudit = async (entry) => audits.push(entry);
  return { store, calls, audits };
}

test("Supabase 초기 명단 import는 민감 목록을 DB의 empty-only RPC에만 전달한다", async () => {
  const { store, calls, audits } = fixture(2);
  const members = [
    { display_name: "홍길동", role: "admin" },
    { display_name: "김학생", role: "student" },
  ];
  assert.equal(await store.seedMembersIfEmpty(members), 2);
  assert.deepEqual(calls, [{
    name: "classbot_seed_members_if_empty",
    args: { p_class_id: "class-private", p_members: members },
  }]);
  assert.deepEqual(audits[0].after, { count: 2 });
});

test("DB가 기존 구성원을 감지해 0을 반환하면 명단과 audit를 추가하지 않는다", async () => {
  const { store, audits } = fixture(0);
  assert.equal(await store.seedMembersIfEmpty([{ display_name: "홍길동", role: "admin" }]), 0);
  assert.equal(audits.length, 0);
});
