import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../store/memory-store.js";
import { formatDayTimetable, formatTimetableRows, getDaySchedule, getWeekTimetable } from "./schedule.js";
import { applyTimetablePolicy, normalizeTimetableRow } from "./timetable-policy.js";

const config = { classCode: "2-4", className: "2학년 4반", timezone: "Asia/Seoul" };
const wednesday = new Date("2026-07-15T03:00:00.000Z");

test("대상 구성원의 개인 시간표를 우선하고 개인 행이 없으면 반 시간표로 폴백한다", async () => {
  const store = new MemoryStore(config);
  const member = store.members[0];
  const otherMember = store.members[1];
  await store.replaceMemberTimetable({
    memberId: member.id,
    rows: [{ weekday: 3, period: 1, subject: "개인 선택 수업", effective_from: "2026-03-01" }],
  });

  const personal = await getDaySchedule(store, wednesday, { targetMemberId: member.id });
  const fallback = await getDaySchedule(store, wednesday, { targetMemberId: otherMember.id });

  assert.equal(personal.timetable[0].subject, "개인 선택 수업");
  assert.equal(fallback.timetable[0].subject, "물리학");
});

test("주간 개인 시간표는 개인 행이 등록된 요일만 덮어쓰고 나머지는 반 시간표를 유지한다", async () => {
  const store = new MemoryStore(config);
  const member = store.members[0];
  await store.replaceMemberTimetable({
    memberId: member.id,
    rows: [{ weekday: 1, period: 1, subject: "월요일 개인 수업", effective_from: "2026-03-01" }],
  });

  const bundle = await getWeekTimetable(store, wednesday, { targetMemberId: member.id });
  assert.equal(bundle.days[0].rows[0].subject, "월요일 개인 수업");
  assert.equal(bundle.days[1].rows[0].subject, "영어");
});

test("개인 시간표 저장은 구성원별로 격리하고 조회일에 유효한 최신 버전만 선택한다", async () => {
  const store = new MemoryStore(config);
  const member = store.members[0];
  const otherMember = store.members[1];
  await store.replaceMemberTimetable({
    memberId: member.id,
    rows: [
      { weekday: 3, period: 1, subject: "1학기 수업", effective_from: "2026-03-01", effective_to: "2026-07-31" },
      { weekday: 3, period: 1, subject: "2학기 수업", effective_from: "2026-08-01" },
    ],
  });

  assert.equal((await store.listMemberTimetable(member.id, { date: "2026-07-15" }))[0].subject, "1학기 수업");
  assert.equal((await store.listMemberTimetable(member.id, { date: "2026-08-15" }))[0].subject, "2학기 수업");
  assert.deepEqual(await store.listMemberTimetable(otherMember.id, { date: "2026-08-15" }), []);
});

test("개인 시간표 교체는 중복 교시와 잘못된 적용 기간을 거부한다", async () => {
  const store = new MemoryStore(config);
  const memberId = store.members[0].id;
  await assert.rejects(
    store.replaceMemberTimetable({
      memberId,
      rows: [
        { weekday: 1, period: 1, subject: "수학", effective_from: "2026-08-01" },
        { weekday: 1, period: 1, subject: "영어", effective_from: "2026-08-01" },
      ],
    }),
    /동일 교시/,
  );
  await assert.rejects(
    store.replaceMemberTimetable({
      memberId,
      rows: [{ weekday: 1, period: 1, subject: "수학", effective_from: "2026-09-01", effective_to: "2026-08-01" }],
    }),
    /종료일/,
  );
});

test("카카오 시간표 과목명과 담당 선생님 표기를 요청한 형식으로 통일한다", () => {
  const rows = [
    { period: 1, subject: "수Ⅰ", teacher: "류상욱", room: "601호" },
    { period: 2, subject: "수2", teacher: "강윤석" },
    { period: 3, subject: "수Ⅲ", teacher: "추철우" },
    { period: 4, subject: "독서", teacher: "윤소영" },
    { period: 5, subject: "영Ⅰ", teacher: "이계화" },
    { period: 6, subject: "영2", teacher: "김선옥" },
    { period: 7, subject: "체2", teacher: "이재욱" },
    { period: 8, subject: "확통1", teacher: "박진환" },
    { period: 9, subject: "공2", teacher: "공3", room: "잘못된 강의실" },
  ];

  const text = formatTimetableRows(rows);
  assert.match(text, /1교시 수학\(류상욱T\) — 601호/);
  assert.match(text, /2교시 수학\(강윤석T\)/);
  assert.match(text, /3교시 수학\(추철우T\)/);
  assert.match(text, /4교시 국어\(윤소영T\)/);
  assert.match(text, /5교시 영어\(이계화T\)/);
  assert.match(text, /6교시 영어\(김선옥T\)/);
  assert.match(text, /7교시 체육\(이재욱T\)/);
  assert.match(text, /8교시 확통\(박진환T\)/);
  assert.match(text, /9교시 공강/);
  assert.doesNotMatch(text, /공3T|잘못된 강의실/);
  assert.deepEqual(normalizeTimetableRow({ subject: "공1", teacher: "공3" }), {
    subject: "공강", teacher: "", activity: "", room: "",
  });
});

test("화요일 창체·동아리와 수요일 자율연구 교시를 날짜 규칙으로 보정한다", () => {
  const source = Array.from({ length: 9 }, (_, index) => ({
    weekday: 2,
    period: index + 1,
    subject: `원본${index + 1}`,
    teacher: "원본교사",
  }));
  const regularTuesday = applyTimetablePolicy(source, { dateKey: "2026-09-29", timetableWeekday: 2 });
  const clubTuesday = applyTimetablePolicy(source, { dateKey: "2026-09-22", timetableWeekday: 2 });
  const wednesday = applyTimetablePolicy(source, { dateKey: "2026-09-02", timetableWeekday: 3 });

  assert.deepEqual(regularTuesday.filter((row) => row.period >= 7).map((row) => row.subject), ["창체", "창체", "창체"]);
  assert.deepEqual(clubTuesday.filter((row) => row.period >= 7).map((row) => row.subject), ["창체", "동아리", "동아리"]);
  assert.deepEqual(wednesday.filter((row) => row.period >= 5 && row.period <= 7).map((row) => row.subject), ["자율연구", "자율연구", "자율연구"]);
  assert.equal(wednesday.find((row) => row.period === 5).teacher, "");
});

test("학사일정의 월·목·금요일 대체수업은 해당 요일의 개인 시간표를 사용한다", async () => {
  const store = new MemoryStore(config);
  const member = store.members[0];
  await store.replaceMemberTimetable({
    memberId: member.id,
    rows: [
      { weekday: 1, period: 1, subject: "월요일 과목", effective_from: "2026-08-01" },
      { weekday: 3, period: 1, subject: "수요일 과목", effective_from: "2026-08-01" },
      { weekday: 4, period: 1, subject: "목요일 과목", effective_from: "2026-08-01" },
      { weekday: 5, period: 1, subject: "금요일 과목", effective_from: "2026-08-01" },
    ],
  });

  const mondayOnTuesday = await getDaySchedule(store, new Date("2026-08-18T12:00:00+09:00"), { targetMemberId: member.id });
  const fridayOnWednesday = await getDaySchedule(store, new Date("2026-09-23T12:00:00+09:00"), { targetMemberId: member.id });
  const thursdayOnMonday = await getDaySchedule(store, new Date("2026-11-09T12:00:00+09:00"), { targetMemberId: member.id });
  const thursdayInDecember = await getDaySchedule(store, new Date("2026-12-21T12:00:00+09:00"), { targetMemberId: member.id });

  assert.equal(mondayOnTuesday.timetableWeekday, 1);
  assert.equal(mondayOnTuesday.timetable[0].subject, "월요일 과목");
  assert.equal(fridayOnWednesday.timetableWeekday, 5);
  assert.equal(fridayOnWednesday.timetable[0].subject, "금요일 과목");
  assert.equal(thursdayOnMonday.timetableWeekday, 4);
  assert.equal(thursdayOnMonday.timetable[0].subject, "목요일 과목");
  assert.equal(thursdayInDecember.timetableWeekday, 4);
  assert.equal(thursdayInDecember.timetable[0].subject, "목요일 과목");
  assert.match(formatDayTimetable(fridayOnWednesday), /학사일정: 금요일 수업 · 퇴사/);
});

test("공휴일·시험·수능·행사·방학식에는 정규 시간표를 반환하지 않는다", async () => {
  const store = new MemoryStore(config);
  const cases = [
    ["2026-09-24", "추석 연휴", "정규 수업이 없습니다"],
    ["2026-10-13", "중간고사", "시험 일정이 적용됩니다"],
    ["2026-11-19", "수능일", "정규 수업이 없습니다"],
    ["2026-11-27", "술개한마당", "학사일정이 진행됩니다"],
    ["2026-12-18", "재량휴업일", "정규 수업이 없습니다"],
    ["2026-12-23", "1·2학년 방학식", "학사일정이 진행됩니다"],
  ];

  for (const [dateKey, label, emptyText] of cases) {
    const bundle = await getDaySchedule(store, new Date(`${dateKey}T12:00:00+09:00`));
    assert.deepEqual(bundle.timetable, []);
    assert.match(formatDayTimetable(bundle), new RegExp(label));
    assert.match(formatDayTimetable(bundle), new RegExp(emptyText));
  }
});
