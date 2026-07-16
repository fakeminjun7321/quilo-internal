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

async function ask(store, utterance, options = {}) {
  return handleKakaoCommand({
    store,
    now,
    makeFileUrl: options.makeFileUrl,
    payload: { userRequest: { utterance, user: { id: options.userId || "group-chat-anonymous" } } },
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
    "다음 일정 홍길동",
    "수행평가 과제 통합 요약 홍길동",
    "시간표 전체 홍길동",
    "자료 목록 홍길동",
  ]);
  assert.equal(replies.every((item) => item.label.endsWith("홍길동")), true);
});

function fileFixture() {
  const store = fixture();
  store.members[0].status = "active";
  store.members[0].kakao_user_key = "joined-hong";
  store.members[0].kakao_user_key_type = "botUserKey";
  store.members[1].status = "active";
  store.members[1].kakao_user_key = "joined-kim";
  store.members[1].kakao_user_key_type = "botUserKey";
  store.files = [
    { id: "class-image", alias: "좌석표", filename: "seats.png", description: "반 좌석 배치", mime_type: "image/png", size_bytes: 2048, member_id: null, status: "active" },
    { id: "class-pdf", alias: "가정통신문", filename: "notice.pdf", description: "7월 안내", mime_type: "application/pdf", size_bytes: 4096, member_id: null, status: "active" },
    { id: "hong-image", alias: "개인피드백", filename: "feedback.jpg", description: "개인 평가", mime_type: "image/jpeg", size_bytes: 8192, member_id: store.members[0].id, status: "active" },
    { id: "kim-pdf", alias: "김학생자료", filename: "kim.pdf", description: "타인 개인 자료", mime_type: "application/pdf", size_bytes: 1024, member_id: store.members[1].id, status: "active" },
    { id: "archived-pdf", alias: "지난자료", filename: "old.pdf", description: "보관됨", mime_type: "application/pdf", size_bytes: 1024, member_id: null, status: "archived" },
  ];
  store.listFiles = async ({ targetMemberId }) => store.files.filter((file) => file.member_id == null || file.member_id === targetMemberId);
  return store;
}

test("파일 목록은 가입된 본인이 자기 이름을 붙였을 때만 반 전체와 본인 개인자료를 보여준다", async () => {
  const store = fileFixture();
  const response = await ask(store, "자료 목록 홍길동", { userId: "joined-hong" });
  assert.match(text(response), /좌석표/);
  assert.match(text(response), /가정통신문/);
  assert.match(text(response), /개인피드백/);
  assert.doesNotMatch(text(response), /김학생자료|지난자료/);
  assert.equal(response.template.quickReplies.length, 5);
  assert.equal(response.template.quickReplies.at(-1).messageText, "자료 목록 홍길동");
});

test("가입된 본인은 파일 명령에서 이름 suffix를 생략하고 이름 없는 Quick Reply를 받는다", async () => {
  const store = fileFixture();
  const makeFileUrl = async (file) => `https://files.example.test/${file.id}`;
  const list = await ask(store, "자료 목록", { userId: "joined-hong" });
  assert.match(text(list), /좌석표|개인피드백/);
  assert.deepEqual(list.template.quickReplies.map((item) => item.messageText), [
    "오늘 일정",
    "다음 일정",
    "수행평가 과제 통합 요약",
    "시간표 전체",
    "자료 목록",
  ]);

  const privateImage = await ask(store, "이미지 개인피드백", { userId: "joined-hong", makeFileUrl });
  assert.equal(privateImage.template.outputs[0].textCard.buttons[0].webLinkUrl, "https://files.example.test/hong-image");

  const denied = await ask(store, "자료 목록 김학생", { userId: "joined-hong" });
  assert.match(text(denied), /권한이 없습니다/);
  assert.doesNotMatch(text(denied), /김학생자료/);
});

test("미가입 사용자와 다른 이름을 쓴 가입자는 파일 존재 여부를 알 수 없다", async () => {
  const store = fileFixture();
  let calls = 0;
  const original = store.listFiles;
  store.listFiles = async (options) => { calls += 1; return original(options); };

  const anonymous = await ask(store, "파일 개인피드백 홍길동", { userId: "unknown-user" });
  const wrongTarget = await ask(store, "파일 개인피드백 홍길동", { userId: "joined-kim" });
  assert.match(text(anonymous), /권한이 없습니다/);
  assert.match(text(wrongTarget), /권한이 없습니다/);
  assert.doesNotMatch(text(wrongTarget), /개인피드백|찾을 수 없습니다/);
  assert.equal(calls, 0);
});

test("반 전체 이미지는 인라인 이미지, 개인 이미지와 PDF는 열기 버튼 카드로 반환한다", async () => {
  const store = fileFixture();
  const makeFileUrl = async (file) => `https://files.example.test/${file.id}`;

  const classImage = await ask(store, "이미지 좌석표 홍길동", { userId: "joined-hong", makeFileUrl });
  assert.equal(classImage.template.outputs.length, 1);
  assert.equal(classImage.template.outputs[0].simpleImage.imageUrl, "https://files.example.test/class-image");

  const privateImage = await ask(store, "이미지 개인피드백 홍길동", { userId: "joined-hong", makeFileUrl });
  assert.equal(privateImage.template.outputs[0].simpleImage, undefined);
  assert.equal(privateImage.template.outputs[0].textCard.buttons[0].label, "파일 열기");

  const pdf = await ask(store, "PDF 가정통신문 홍길동", { userId: "joined-hong", makeFileUrl });
  assert.equal(pdf.template.outputs[0].textCard.buttons[0].label, "PDF 열기");
  assert.equal(pdf.template.outputs[0].textCard.buttons[0].webLinkUrl, "https://files.example.test/class-pdf");
});

test("파일 형식·별칭이 다르거나 URL 발급기가 없으면 안전한 안내만 반환한다", async () => {
  const store = fileFixture();
  const wrongType = await ask(store, "PDF 좌석표 홍길동", { userId: "joined-hong", makeFileUrl: async () => "https://files.example.test/x" });
  assert.match(text(wrongType), /찾을 수 없습니다/);

  const unavailable = await ask(store, "파일 가정통신문 홍길동", { userId: "joined-hong" });
  assert.match(text(unavailable), /자료 열기 기능을 사용할 수 없습니다/);
});

test("다음 일정은 현재 이후 가장 빠른 반 전체 또는 개인 일정 한 건만 보여준다", async () => {
  const store = fixture();
  await store.createEvent({ title: "이미 지난 반 일정", due_at: "2026-07-15T10:00:00+09:00" });
  await store.createEvent({ member_id: store.members[1].id, title: "다른 학생 다음 일정", due_at: "2026-07-15T13:00:00+09:00" });
  await store.createEvent({ member_id: store.members[0].id, title: "가장 가까운 개인 일정", due_at: "2026-07-15T13:30:00+09:00" });
  await store.createEvent({ title: "그다음 반 일정", due_at: "2026-07-15T14:00:00+09:00" });

  const response = await ask(store, "다음 일정 홍길동");
  assert.match(text(response), /홍길동님의 다음 일정/);
  assert.match(text(response), /가장 가까운 개인 일정/);
  assert.doesNotMatch(text(response), /이미 지난 반 일정|다른 학생 다음 일정|그다음 반 일정/);
});

test("이번 달 일정은 서울 달력 경계 안의 반 전체와 본인 일정만 보여준다", async () => {
  const store = fixture();
  await store.createEvent({ title: "7월 반 일정", due_at: "2026-07-01T00:00:00+09:00" });
  await store.createEvent({ member_id: store.members[0].id, title: "7월 개인 일정", due_at: "2026-07-31T23:59:00+09:00" });
  await store.createEvent({ member_id: store.members[1].id, title: "7월 타인 일정", due_at: "2026-07-20T12:00:00+09:00" });
  await store.createEvent({ title: "8월 일정", due_at: "2026-08-01T00:00:00+09:00" });

  const response = await ask(store, "이번 달 일정 홍길동");
  assert.match(text(response), /홍길동님의 2026년 7월 일정/);
  assert.match(text(response), /7월 반 일정/);
  assert.match(text(response), /7월 개인 일정/);
  assert.doesNotMatch(text(response), /7월 타인 일정|8월 일정/);
});

test("수행평가·과제 통합 요약은 두 유형만 함께 보여준다", async () => {
  const store = fixture();
  await store.createEvent({ category: "assessment", title: "물리 수행평가", due_at: "2026-07-16T13:00:00+09:00" });
  await store.createEvent({ member_id: store.members[0].id, category: "assignment", title: "영어 과제", due_at: "2026-07-17T13:00:00+09:00" });
  await store.createEvent({ category: "class", title: "진로 수업", due_at: "2026-07-18T13:00:00+09:00" });

  const response = await ask(store, "수행평가 과제 통합 요약 홍길동");
  assert.match(text(response), /수행평가·과제 통합 요약/);
  assert.match(text(response), /물리 수행평가/);
  assert.match(text(response), /영어 과제/);
  assert.doesNotMatch(text(response), /진로 수업/);
});

test("시간표 전체는 월요일부터 금요일까지 등록 원본을 보여준다", async () => {
  const store = fixture();
  const response = await ask(store, "시간표 전체 홍길동");
  assert.match(text(response), /홍길동님의 월~금 전체 시간표/);
  assert.match(text(response), /7월 13일 월요일/);
  assert.match(text(response), /7월 17일 금요일/);
  assert.match(text(response), /1교시 물리학/);
});

test("이번 주 남은 일정은 현재 시각 이후 일정만 유지한다", async () => {
  const store = fixture();
  await store.createEvent({ title: "오늘 지난 일정", due_at: "2026-07-15T10:00:00+09:00" });
  await store.createEvent({ title: "오늘 남은 일정", due_at: "2026-07-15T13:00:00+09:00" });
  await store.createEvent({ member_id: store.members[0].id, title: "금요일 개인 일정", due_at: "2026-07-17T13:00:00+09:00" });
  await store.createEvent({ title: "다음 주 일정", due_at: "2026-07-20T13:00:00+09:00" });

  const response = await ask(store, "이번 주 남은 일정 홍길동");
  assert.match(text(response), /홍길동님의 이번 주 남은 일정/);
  assert.match(text(response), /오늘 남은 일정/);
  assert.match(text(response), /금요일 개인 일정/);
  assert.doesNotMatch(text(response), /오늘 지난 일정|다음 주 일정/);
});

test("도움말은 최초 이름등록, 이름 없는 본인 조회와 명시적 타인 일정 조회를 안내한다", async () => {
  const store = fixture();
  const help = await ask(store, "도움말");
  assert.match(text(help), /이름등록 ABCD-EFGH/);
  assert.match(text(help), /본인 일정.*이름을 붙이지 않아도/);
  assert.match(text(help), /다음 일정/);
  assert.match(text(help), /이번 달 일정/);
  assert.match(text(help), /수행평가 과제 통합 요약/);
  assert.match(text(help), /시간표 전체/);
  assert.match(text(help), /자료 목록/);
  assert.match(text(help), /다른 구성원의 일정.*등록 이름/);

  const response = await ask(store, "이번 달 일정 홍길동");
  assert.equal(response.template.quickReplies.length, 5);
  assert.equal(response.template.quickReplies.every((item) => item.messageText.endsWith("홍길동")), true);
});

test("이름등록은 기존 가입과 같은 초대코드 매핑을 사용하고 이후 이름 없이 본인 일정을 조회한다", async () => {
  const store = fixture();
  const member = store.members[0];
  let claimInput;
  store.claimInvite = async (input) => {
    claimInput = input;
    member.status = "active";
    member.kakao_user_key = input.userKey;
    member.kakao_user_key_type = input.userKeyType;
    return { ...member };
  };
  await store.createEvent({ title: "반 전체 일정", due_at: "2026-07-15T16:00:00" });
  await store.createEvent({ member_id: member.id, title: "홍길동 개인 일정", due_at: "2026-07-15T17:00:00" });

  const registration = await ask(store, "이름등록 ABCD-EFGH", { userId: "new-hong-user" });
  assert.match(text(registration), /이름 등록.*가입이 완료/);
  assert.equal(claimInput.code, "ABCD-EFGH");
  assert.equal(claimInput.userKey, "new-hong-user");
  assert.equal(registration.template.quickReplies[0].messageText, "오늘 일정");

  const response = await ask(store, "오늘 일정", { userId: "new-hong-user" });
  assert.match(text(response), /홍길동님의.*오늘|홍길동님의 7월 15일/);
  assert.match(text(response), /반 전체 일정/);
  assert.match(text(response), /홍길동 개인 일정/);
  assert.equal(response.template.quickReplies.every((item) => !item.messageText.includes("홍길동")), true);
});

test("active 요청자는 모든 본인 조회 명령을 이름 없이 사용하고 명시한 다른 이름 일정도 조회한다", async () => {
  const store = fileFixture();
  await store.createEvent({ title: "오늘 반 일정", due_at: "2026-07-15T16:00:00" });
  await store.createEvent({ member_id: store.members[0].id, category: "assessment", title: "홍길동 수행평가", due_at: "2026-07-16T16:00:00" });
  await store.createEvent({ member_id: store.members[0].id, category: "assignment", title: "홍길동 과제", due_at: "2026-07-17T16:00:00" });
  await store.createEvent({ member_id: store.members[1].id, title: "김학생 개인 일정", due_at: "2026-07-15T18:00:00" });

  for (const utterance of [
    "오늘 일정",
    "내일 일정",
    "다음 일정",
    "이번 달 일정",
    "이번 주 남은 일정",
    "수행평가 과제 통합 요약",
    "오늘 시간표",
    "시간표 전체",
  ]) {
    const response = await ask(store, utterance, { userId: "joined-hong" });
    assert.match(text(response), /홍길동님의/);
    assert.deepEqual(response.template.quickReplies.map((item) => item.messageText), [
      "오늘 일정",
      "다음 일정",
      "수행평가 과제 통합 요약",
      "시간표 전체",
      "자료 목록",
    ]);
  }

  const other = await ask(store, "오늘 일정 김학생", { userId: "joined-hong" });
  assert.match(text(other), /김학생님의/);
  assert.match(text(other), /김학생 개인 일정/);
  assert.equal(other.template.quickReplies[0].messageText, "오늘 일정 김학생");
});

test("등록된 요청자의 알림·공지 응답 Quick Reply에도 이름 suffix를 다시 붙이지 않는다", async () => {
  const store = fileFixture();
  const notifications = await ask(store, "알림 설정", { userId: "joined-hong" });
  assert.deepEqual(notifications.template.quickReplies.map((item) => item.messageText), [
    "오늘 일정",
    "다음 일정",
    "수행평가 과제 통합 요약",
    "시간표 전체",
    "자료 목록",
  ]);

  const notices = await ask(store, "공지", { userId: "joined-hong" });
  assert.equal(notices.template.quickReplies.every((item) => !item.messageText.includes("홍길동")), true);
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
