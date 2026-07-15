import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../store/memory-store.js";
import { handleKakaoCommand } from "./commands.js";

const config = { classCode: "2-4", className: "2학년 4반", timezone: "Asia/Seoul" };
const now = new Date("2026-07-15T03:00:00.000Z");

function fixture() {
  const store = new MemoryStore(config);
  store.members[0].display_name = "홍길동";
  store.members[1].display_name = "김학생";
  store.events = [];
  return store;
}

async function ask(store, utterance) {
  return handleKakaoCommand({
    store,
    now,
    payload: { userRequest: { utterance, user: { id: "group-chat-anonymous" } } },
  });
}

function text(response) {
  return response.template.outputs[0].simpleText.text;
}

test("익명 그룹챗 개인 조회는 반 전체와 대상 개인 일정만 반환하고 개인화 Quick Reply를 붙인다", async () => {
  const store = fixture();
  await store.createEvent({ title: "반 전체 준비", due_at: "2026-07-15T16:00:00" });
  await store.createEvent({ member_id: store.members[0].id, title: "홍길동 개인 준비", due_at: "2026-07-15T17:00:00" });
  await store.createEvent({ member_id: store.members[1].id, title: "김학생 개인 준비", due_at: "2026-07-15T18:00:00" });

  const response = await ask(store, "오늘 일정 홍길동");
  assert.match(text(response), /홍길동님의 7월 15일 수요일 일정/);
  assert.match(text(response), /반 전체 준비/);
  assert.match(text(response), /홍길동 개인 준비/);
  assert.doesNotMatch(text(response), /김학생 개인 준비/);
  const replies = response.template.quickReplies;
  assert.deepEqual(replies.map((item) => item.messageText), [
    "오늘 일정 홍길동",
    "내일 일정 홍길동",
    "이번 주 일정 홍길동",
    "오늘 시간표 홍길동",
    "과제 홍길동",
  ]);
  assert.equal(replies.every((item) => item.label.endsWith("홍길동")), true);
});

test("오늘·내일·모레·이번 주·다음 주와 시험·숙제 변형을 대상 범위로 해석한다", async () => {
  const store = fixture();
  await store.createEvent({ member_id: store.members[0].id, category: "assessment", title: "오늘 시험", due_at: "2026-07-15T16:00:00" });
  await store.createEvent({ member_id: store.members[0].id, category: "assignment", title: "내일 숙제", due_at: "2026-07-16T16:00:00" });
  await store.createEvent({ member_id: store.members[0].id, category: "class", title: "모레 상담", due_at: "2026-07-17T16:00:00" });
  await store.createEvent({ member_id: store.members[0].id, category: "assessment", title: "다음 주 시험", due_at: "2026-07-21T16:00:00" });

  assert.match(text(await ask(store, "오늘 시험 홍길동")), /오늘 시험/);
  assert.match(text(await ask(store, "내일 숙제 홍길동")), /내일 숙제/);
  assert.match(text(await ask(store, "모레 뭐 있어 홍길동?")), /모레 상담/);
  assert.match(text(await ask(store, "이번주 일정 홍길동")), /오늘 시험/);
  assert.match(text(await ask(store, "다음 주 시험 홍길동")), /다음 주 시험/);
  assert.match(text(await ask(store, "과제 홍길동")), /내일 숙제/);
});

test("시간표도 이름을 맨 뒤에 요구하며 요청자 가입 없이 일간·주간 조회한다", async () => {
  const store = fixture();
  const today = await ask(store, "오늘 시간표 홍길동");
  assert.match(text(today), /홍길동님의 7월 15일 수요일 시간표/);
  assert.match(text(today), /1교시 물리학/);

  const nextWeek = await ask(store, "다음 주 시간표 홍길동");
  assert.match(text(nextWeek), /홍길동님의 다음 주 시간표/);
  assert.match(text(nextWeek), /7월 20일 월요일/);
});

test("이름 누락·후행 규칙 위반·미등록·동명이인을 명확히 안내한다", async () => {
  const store = fixture();
  assert.match(text(await ask(store, "오늘 일정")), /이름.*맨 뒤/);
  assert.match(text(await ask(store, "오늘 일정 알려줘")), /이름.*맨 뒤/);
  assert.match(text(await ask(store, "홍길동 오늘 일정")), /맨 뒤에 붙여/);
  assert.match(text(await ask(store, "오늘 일정 이테스트")), /등록된 구성원 '이테스트'.*찾을 수 없습니다/);

  store.members[2].display_name = "홍길동";
  assert.match(text(await ask(store, "오늘 일정 홍길동")), /동명이인/);
});

test("빈 결과와 대상 확정 뒤 처리 오류에도 대상 이름 Quick Reply를 유지한다", async () => {
  const store = fixture();
  const empty = await ask(store, "모레 숙제 홍길동");
  assert.match(text(empty), /등록된 과제가 없습니다/);
  assert.equal(empty.template.quickReplies.every((item) => item.messageText.endsWith("홍길동")), true);

  store.listEvents = async () => { throw new Error("database unavailable"); };
  const failed = await ask(store, "오늘 일정 홍길동");
  assert.match(text(failed), /잠시 후 다시 시도/);
  assert.equal(failed.template.quickReplies.every((item) => item.messageText.endsWith("홍길동")), true);
});
