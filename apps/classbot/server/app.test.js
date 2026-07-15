import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "./app.js";
import { MemoryStore } from "./store/memory-store.js";

const config = {
  nodeEnv: "test",
  production: false,
  port: 0,
  allowedOrigin: "http://localhost:5173",
  sessionSecret: "test-session-secret-that-is-long-enough",
  adminPassword: "correct horse battery staple",
  cronSecret: "cron-test-secret",
  kakaoSkillSecret: "",
  storage: "memory",
  classCode: "2-4",
  className: "2학년 4반",
  timezone: "Asia/Seoul",
  kakao: { enabled: false, botId: "", restApiKey: "", eventName: "quilo_schedule_notification", apiBase: "https://bot-api.kakao.com" },
};

async function fixture() {
  const store = new MemoryStore(config);
  const app = await createApp({
    config,
    store,
    now: () => new Date("2026-07-15T03:00:00.000Z"),
  });
  return { app, store, agent: request.agent(app) };
}

async function login(agent) {
  const response = await agent.post("/api/admin/login").send({ password: config.adminPassword });
  assert.equal(response.status, 200);
}

test("관리자 세션이 보호되고 로그인 후 overview를 조회한다", async () => {
  const { app, agent } = await fixture();
  assert.equal((await request(app).get("/api/admin/overview")).status, 401);
  assert.equal((await agent.post("/api/admin/login").send({ password: "wrong-password" })).status, 401);
  await login(agent);
  const response = await agent.get("/api/admin/overview");
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.headers["content-security-policy"], /default-src 'self'/);
  assert.doesNotMatch(response.headers["content-security-policy"], /upgrade-insecure-requests/);
  assert.equal(response.body.classroom.name, "2학년 4반");
  assert.equal(response.body.stats.memberCount, 13);
  assert.equal(Array.isArray(response.body.notices), true);
});

test("health check는 저장소 연결 실패를 503으로 노출하되 내부 오류는 숨긴다", async () => {
  const store = new MemoryStore(config);
  store.healthCheck = async () => { throw new Error("database password should not leak"); };
  const app = await createApp({ config, store });
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    ok: false,
    storage: "memory",
    kakaoEnabled: false,
    reason: "storage_unavailable",
  });
  assert.equal(JSON.stringify(response.body).includes("password"), false);
});

test("빌드된 관리자 화면의 동일 출처 로그인은 허용하고 외부 출처는 차단한다", async () => {
  const { app } = await fixture();
  const sameOrigin = await request(app)
    .post("/api/admin/login")
    .set("Origin", "http://localhost:4310")
    .set("Host", "localhost:4310")
    .send({ password: config.adminPassword });
  assert.equal(sameOrigin.status, 200);

  const foreignOrigin = await request(app)
    .post("/api/admin/login")
    .set("Origin", "https://attacker.example")
    .set("Host", "localhost:4310")
    .send({ password: config.adminPassword });
  assert.equal(foreignOrigin.status, 403);
});

test("동일 Idempotency-Key 일정 생성은 한 번만 저장한다", async () => {
  const { agent, store } = await fixture();
  await login(agent);
  const payload = {
    category: "assessment",
    subject: "물리학",
    title: "단진자 보고서",
    due_at: "2026-07-20T18:00:00",
    reminder_offsets: [1440, 0, 1440],
  };
  const first = await agent.post("/api/admin/events").set("Idempotency-Key", "event:test:0001").send(payload);
  const second = await agent.post("/api/admin/events").set("Idempotency-Key", "event:test:0001").send(payload);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.item.id, second.body.item.id);
  assert.equal((await store.listEvents()).filter((item) => item.title === payload.title).length, 1);
  assert.deepEqual(first.body.item.reminder_offsets, [1440, 0]);
});

test("시간표 중복 교시와 잘못된 일정 날짜를 거부한다", async () => {
  const { agent } = await fixture();
  await login(agent);
  const duplicate = await agent.put("/api/admin/timetable/3").send({
    rows: [
      { period: 1, subject: "수학" },
      { period: 1, subject: "영어" },
    ],
  });
  assert.equal(duplicate.status, 409);
  const invalidDate = await agent.post("/api/admin/events").send({ title: "잘못된 일정", due_at: "not-a-date" });
  assert.equal(invalidDate.status, 400);

  const frontendShape = await agent.put("/api/admin/timetable/4").send({ items: [{ period: 1, subject: "화학" }] });
  assert.equal(frontendShape.status, 200);
  assert.equal(frontendShape.body.items[0].subject, "화학");
});

test("초대 코드 가입, 카카오 알림 설정, 공지 조회가 이어진다", async () => {
  const { app, agent, store } = await fixture();
  await login(agent);
  const [member] = await store.listMembers();
  const invitation = await agent.post(`/api/admin/members/${member.id}/invite`).send({ expires_in_hours: 24 });
  assert.equal(invitation.status, 201);

  const user = { properties: { botUserKey: "kakao-user-1", isFriend: "false" } };
  const join = await request(app).post("/api/kakao/skill").send({
    userRequest: { utterance: `가입 ${invitation.body.code}`, user },
  });
  assert.equal(join.status, 200);
  assert.match(join.body.template.outputs[0].simpleText.text, /가입이 완료/);
  assert.match(join.body.template.outputs[0].simpleText.text, /친구 추가/);

  const disable = await request(app).post("/api/kakao/skill").send({
    userRequest: { utterance: "알림 끄기", user },
  });
  assert.match(disable.body.template.outputs[0].simpleText.text, /알림을 껐습니다/);
  assert.equal((await store.findMemberByUserKey("kakao-user-1")).notification_enabled, false);
  const memberResponse = await agent.get("/api/admin/members");
  const joinedMember = memberResponse.body.items.find((item) => item.id === member.id);
  assert.equal(joinedMember.kakao_connected, true);
  assert.equal("kakao_user_key" in joinedMember, false);
  assert.equal(JSON.stringify(store.auditLogs).includes("kakao-user-1"), false);

  const notice = await agent
    .post("/api/admin/notices")
    .set("Idempotency-Key", "notice:test:0001")
    .send({ title: "준비물 안내", body: "내일 실내화를 가져오세요.", status: "published" });
  assert.equal(notice.status, 201);
  assert.equal(notice.body.delivery.dryRun, true);

  const kakaoNotice = await request(app).post("/api/kakao/skill").send({ userRequest: { utterance: "공지", user } });
  assert.match(kakaoNotice.body.template.outputs[0].simpleText.text, /준비물 안내/);

  const draft = await agent.post("/api/admin/notices").send({ title: "게시 대기", body: "게시 버튼 테스트" });
  const sent = await agent.post(`/api/admin/notices/${draft.body.item.id}/send`).send({});
  assert.equal(sent.status, 200);
  assert.equal(sent.body.item.status, "published");
  assert.equal(sent.body.delivery.dryRun, true);
});

test("이름이 맨 뒤인 시간표와 오늘·내일·주간 일정 질의는 요청자 가입 없이 조회한다", async () => {
  const { app, agent, store } = await fixture();
  await login(agent);
  await store.createEvent({
    category: "assessment",
    subject: "영어",
    title: "단어 시험",
    due_at: "2026-07-15T16:00:00",
  });
  await store.createEvent({
    category: "assignment",
    subject: "수학",
    title: "문제집 제출",
    due_at: "2026-07-16T09:00:00",
  });
  const [member] = await store.listMembers();
  const invitation = await agent.post(`/api/admin/members/${member.id}/invite`).send({ expires_in_hours: 24 });
  const user = { properties: { botUserKey: "kakao-schedule-user", isFriend: "true" } };
  await request(app).post("/api/kakao/skill").send({
    userRequest: { utterance: `가입 ${invitation.body.code}`, user },
  });

  const missingTarget = await request(app)
    .post("/api/kakao/skill")
    .send({ userRequest: { utterance: "오늘 시간표", user: { id: "anonymous" } } });
  assert.match(missingTarget.body.template.outputs[0].simpleText.text, /이름.*맨 뒤/);

  const anonymousNatural = await request(app)
    .post("/api/kakao/skill")
    .send({ userRequest: { utterance: `오늘 뭐 있어 ${member.display_name}?`, user: { id: "anonymous" } } });
  assert.match(anonymousNatural.body.template.outputs[0].simpleText.text, /단어 시험/);

  const expected = new Map([
    [`오늘 일정 알려줘 ${member.display_name}`, /단어 시험/],
    [`내일 뭐 있어 ${member.display_name}?`, /문제집 제출/],
    [`일정 ${member.display_name}`, /앞으로 30일 일정/],
    [`이번 주 일정 ${member.display_name}`, /이번 주 일정/],
    [`이번 주 수행평가 ${member.display_name}`, /단어 시험/],
  ]);
  for (const [utterance, pattern] of expected) {
    const response = await request(app).post("/api/kakao/skill").send({ userRequest: { utterance, user } });
    assert.equal(response.status, 200);
    assert.equal(response.body.version, "2.0");
    assert.match(response.body.template.outputs[0].simpleText.text, pattern);
    assert.ok(response.body.template.outputs[0].simpleText.text.length > 10);
    assert.equal(response.body.template.quickReplies.some((item) => item.label === `오늘 일정 ${member.display_name}`), true);
  }

  for (const utterance of ["오늘 시간표", "내일 시간표", "수행평가"]) {
    const response = await request(app).post("/api/kakao/skill").send({ userRequest: { utterance: `${utterance} ${member.display_name}`, user } });
    assert.equal(response.status, 200);
    assert.equal(response.body.version, "2.0");
  }
});

test("관리자 일정 API는 개인 대상 member_id를 검증하고 반 전체 일정으로 되돌릴 수 있다", async () => {
  const { agent, store } = await fixture();
  await login(agent);
  const [member] = await store.listMembers();
  const created = await agent
    .post("/api/admin/events")
    .set("Idempotency-Key", "event:personal:0001")
    .send({
      member_id: member.id,
      category: "assignment",
      title: "개인 과제",
      due_at: "2026-07-18T18:00:00",
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.member_id, member.id);

  const invalid = await agent.post("/api/admin/events").send({
    member_id: "missing-member",
    category: "assignment",
    title: "잘못된 개인 과제",
    due_at: "2026-07-18T19:00:00",
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /구성원을 찾을 수 없습니다/);

  const classwide = await agent.patch(`/api/admin/events/${created.body.item.id}`).send({ member_id: null });
  assert.equal(classwide.status, 200);
  assert.equal(classwide.body.item.member_id, null);
});

test("초기 명단 bulk import는 관리자 인증과 빈 학급을 요구하고 가명 목록을 한 번만 넣는다", async () => {
  const { agent, store } = await fixture();
  store.members = [];
  const payload = {
    members: [
      { display_name: "홍길동", role: "admin" },
      { display_name: "김학생", role: "student" },
    ],
  };
  assert.equal((await agent.post("/api/admin/members/import").send(payload)).status, 401);
  await login(agent);
  const imported = await agent.post("/api/admin/members/import").send(payload);
  assert.equal(imported.status, 201);
  assert.equal(imported.body.created_count, 2);
  const members = await store.listMembers();
  assert.deepEqual(members.map((member) => [member.display_name, member.role, member.status]), [
    ["김학생", "student", "invited"],
    ["홍길동", "admin", "invited"],
  ]);
  const repeated = await agent.post("/api/admin/members/import").send(payload);
  assert.equal(repeated.status, 409);
  assert.equal((await store.listMembers()).length, 2);
});

test("동시 공지 게시 요청은 한 번만 새 게시와 알림을 만든다", async () => {
  const { agent } = await fixture();
  await login(agent);
  const draft = await agent.post("/api/admin/notices").send({
    title: "동시 게시 테스트",
    body: "한 번만 게시되어야 합니다.",
    notify_on_publish: true,
  });
  const [first, second] = await Promise.all([
    agent.patch(`/api/admin/notices/${draft.body.item.id}`).send({ status: "published" }),
    agent.patch(`/api/admin/notices/${draft.body.item.id}`).send({ status: "published" }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal([first.body.delivery, second.body.delivery].filter(Boolean).length, 1);
});

test("Cron endpoint는 Bearer secret과 dry-run을 지원한다", async () => {
  const { app, store } = await fixture();
  const [reserved] = await store.reserveNotifications([{
    member_id: store.members[0].id,
    event_id: null,
    notice_id: null,
    idempotency_key: "cron:dry-run:orphan",
    kind: "test",
    scheduled_for: new Date("2026-07-15T00:00:00.000Z").toISOString(),
    payload: { message: "dry-run must not mutate" },
  }]);
  store.notifications.find((item) => item.id === reserved.id).created_at = "2026-07-14T00:00:00.000Z";
  assert.equal((await request(app).post("/api/cron/notifications")).status, 401);
  const response = await request(app)
    .post("/api/cron/notifications")
    .set("Authorization", `Bearer ${config.cronSecret}`)
    .send({ dry_run: true });
  assert.equal(response.status, 200);
  assert.equal(response.body.dispatch.dryRun, true);
  assert.equal(response.body.reconciliation.skipped, true);
  assert.equal((await store.getNotification(reserved.id)).status, "reserved");
});

test("실패 알림 재시도 API는 관리자 Idempotency-Key를 강제한다", async () => {
  const { agent, store } = await fixture();
  await login(agent);
  const [notification] = await store.reserveNotifications([
    {
      member_id: store.members[0].id,
      event_id: null,
      notice_id: null,
      idempotency_key: "app:failed:retry:1",
      kind: "test",
      scheduled_for: new Date().toISOString(),
      payload: { message: "재시도" },
    },
  ]);
  await store.markNotifications([notification.id], { status: "failed", failure_reason: "테스트" });
  const response = await agent.post(`/api/admin/notifications/${notification.id}/retry`).send({});
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Idempotency-Key/);
});
