const CLUB_ACTIVITY_DATES = new Set([
  "2026-09-01",
  "2026-09-08",
  "2026-09-15",
  "2026-09-22",
  "2026-10-20",
  "2026-10-27",
  "2026-11-17",
  "2026-11-24",
]);

const ACADEMIC_DAY_POLICIES = new Map(Object.entries({
  "2026-08-17": closedDay("대체 공휴일 · 입사"),
  "2026-08-18": replacementDay("개학 · 월요일 수업", 1),
  "2026-09-23": replacementDay("금요일 수업 · 퇴사", 5),
  "2026-09-24": closedDay("추석 연휴"),
  "2026-09-25": closedDay("추석"),
  "2026-09-26": closedDay("추석 연휴"),
  "2026-10-03": closedDay("개천절"),
  "2026-10-05": closedDay("대체 공휴일"),
  "2026-10-09": closedDay("한글날"),
  "2026-11-09": replacementDay("목요일 수업", 4),
  "2026-11-19": closedDay("수능일"),
  "2026-11-27": specialDay("술개한마당"),
  "2026-12-18": closedDay("재량휴업일"),
  "2026-12-21": replacementDay("목요일 수업 · 10시 입사 · 3학년 방학식", 4),
  "2026-12-23": specialDay("1·2학년 방학식 · 퇴사"),
  "2026-12-25": closedDay("크리스마스"),
  "2026-12-28": specialDay("졸업식 · 겨울방학"),
  "2027-01-01": closedDay("신정"),
}));

const NO_REGULAR_CLASS_RANGES = [
  { from: "2026-08-01", to: "2026-08-16", policy: closedDay("여름방학", "방학 중에는 정규 수업이 없습니다.") },
  { from: "2026-10-13", to: "2026-10-16", policy: examDay("중간고사") },
  { from: "2026-12-14", to: "2026-12-16", policy: examDay("기말고사") },
  { from: "2026-12-17", to: "2026-12-17", policy: examDay("기말고사 · 성적 확인 · 퇴사") },
  { from: "2026-12-24", to: "2027-01-02", policy: closedDay("겨울방학", "방학 중에는 정규 수업이 없습니다.") },
];

function closedDay(label, emptyText = "정규 수업이 없습니다.") {
  return { label, noRegularClasses: true, emptyText };
}

function specialDay(label) {
  return { label, noRegularClasses: true, emptyText: "정규 시간표 대신 학사일정이 진행됩니다." };
}

function examDay(label) {
  return { label, noRegularClasses: true, emptyText: "정규 시간표 대신 시험 일정이 적용됩니다." };
}

function replacementDay(label, timetableWeekday) {
  return { label, noRegularClasses: false, timetableWeekday };
}

function inDateRange(dateKey, { from, to }) {
  return dateKey >= from && dateKey <= to;
}

export function getAcademicDayPolicy(dateKey) {
  const normalized = String(dateKey || "").trim();
  const explicit = ACADEMIC_DAY_POLICIES.get(normalized);
  if (explicit) return { ...explicit };
  const range = NO_REGULAR_CLASS_RANGES.find((item) => inDateRange(normalized, item));
  return range ? { ...range.policy } : null;
}

function normalizedSubject(value) {
  const subject = String(value || "").trim().replace(/\s+/g, "");
  if (/^수(?:1|2|3|Ⅰ|Ⅱ|Ⅲ)$/u.test(subject)) return "수학";
  if (subject === "독서") return "국어";
  if (/^영(?:1|2|Ⅰ|Ⅱ)$/u.test(subject)) return "영어";
  if (/^체(?:2|Ⅱ)$/u.test(subject)) return "체육";
  if (/^확통(?:1|Ⅰ)$/u.test(subject)) return "확통";
  if (/^공(?:강|1|2|3|Ⅰ|Ⅱ|Ⅲ)$/u.test(subject)) return "공강";
  return String(value || "").trim();
}

export function normalizeTimetableRow(row = {}) {
  const subject = normalizedSubject(row.subject);
  return {
    ...row,
    subject,
    teacher: subject === "공강" ? "" : String(row.teacher || "").trim(),
    activity: subject === "공강" ? "" : String(row.activity || "").trim(),
    room: subject === "공강" ? "" : String(row.room || "").trim(),
  };
}

function replacePeriods(rows, timetableWeekday, replacements) {
  const byPeriod = new Map(rows.map((row) => [Number(row.period), row]));
  for (const [period, subject] of replacements) {
    const current = byPeriod.get(period) || { period, weekday: timetableWeekday };
    byPeriod.set(period, {
      ...current,
      weekday: timetableWeekday,
      period,
      subject,
      teacher: "",
      activity: "",
      room: "",
      memo: "",
      derived_timetable_rule: true,
    });
  }
  return [...byPeriod.values()].sort((a, b) => Number(a.period) - Number(b.period));
}

export function applyTimetablePolicy(rows, { dateKey, timetableWeekday }) {
  let result = (Array.isArray(rows) ? rows : []).map(normalizeTimetableRow);

  if (Number(timetableWeekday) === 3) {
    // 후속 자율연구 일정이 제공되면 외출 여부를 자율연구(O)/자율연구(X)로 반영한다.
    // 현재는 외출 여부를 추정하지 않고 5~7교시를 자율연구로만 표시한다.
    result = replacePeriods(result, 3, [[5, "자율연구"], [6, "자율연구"], [7, "자율연구"]]);
  }

  if (Number(timetableWeekday) === 2) {
    const replacements = [[7, "창체"], [8, "창체"], [9, "창체"]];
    if (CLUB_ACTIVITY_DATES.has(String(dateKey || ""))) {
      replacements[1][1] = "동아리";
      replacements[2][1] = "동아리";
    }
    result = replacePeriods(result, 2, replacements);
  }

  return result;
}

export function formatTimetableSubject(row) {
  const normalized = normalizeTimetableRow(row);
  if (!normalized.teacher) return normalized.subject;
  const teacher = /T$/iu.test(normalized.teacher) ? normalized.teacher : `${normalized.teacher}T`;
  return `${normalized.subject}(${teacher})`;
}

export function isClubActivityDate(dateKey) {
  return CLUB_ACTIVITY_DATES.has(String(dateKey || ""));
}
