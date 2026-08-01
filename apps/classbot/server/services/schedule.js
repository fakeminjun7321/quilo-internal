import {
  dateForSeoulOffset,
  endOfSeoulDay,
  formatKoreanDate,
  formatKoreanDateTime,
  getSeoulParts,
  startOfSeoulDay,
} from "../time.js";
import {
  applyTimetablePolicy,
  formatTimetableSubject,
  getAcademicDayPolicy,
  normalizeTimetableRow,
} from "./timetable-policy.js";

const CATEGORY_LABELS = {
  assessment: "수행평가",
  assignment: "과제",
  class: "수업",
  schedule_change: "일정 변경",
  notice: "공지",
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || "일정";
}

async function timetableForMemberOrClass(store, { targetMemberId, weekday, date }) {
  if (targetMemberId && typeof store.listMemberTimetable === "function") {
    const personal = await store.listMemberTimetable(targetMemberId, { weekday, date });
    if (personal.length) return personal;
  }
  return store.listTimetable({ weekday });
}

export async function getTimetableForDate(
  store,
  date = new Date(),
  { targetMemberId, respectAcademicCalendar = true } = {},
) {
  const parts = getSeoulParts(date);
  const academicDay = respectAcademicCalendar ? getAcademicDayPolicy(parts.dateKey) : null;
  const timetableWeekday = academicDay?.timetableWeekday ?? parts.weekday;
  const rawTimetable = !academicDay?.noRegularClasses && timetableWeekday >= 1 && timetableWeekday <= 5
    ? await timetableForMemberOrClass(store, { targetMemberId, weekday: timetableWeekday, date: parts.dateKey })
    : [];
  const timetable = academicDay?.noRegularClasses
    ? []
    : applyTimetablePolicy(rawTimetable, { dateKey: parts.dateKey, timetableWeekday });
  return { date, parts, timetable, academicDay, timetableWeekday };
}

export async function getDaySchedule(store, date = new Date(), { targetMemberId } = {}) {
  const timetableBundle = await getTimetableForDate(store, date, { targetMemberId });
  const events = await store.listEvents({
    from: startOfSeoulDay(date).toISOString(),
    to: endOfSeoulDay(date).toISOString(),
    status: "scheduled",
    targetMemberId,
  });
  return { ...timetableBundle, events };
}

export function getWeekBounds(date = new Date(), weekOffset = 0) {
  const parts = getSeoulParts(date);
  const mondayOffset = parts.weekday === 0 ? -6 : 1 - parts.weekday;
  const monday = dateForSeoulOffset(date, mondayOffset + Number(weekOffset || 0) * 7);
  const sunday = dateForSeoulOffset(monday, 6);
  return { monday, sunday };
}

export async function getWeekEvents(store, date = new Date(), { weekOffset = 0, targetMemberId } = {}) {
  const { monday, sunday } = getWeekBounds(date, weekOffset);
  return store.listEvents({
    from: startOfSeoulDay(monday).toISOString(),
    to: endOfSeoulDay(sunday).toISOString(),
    status: "scheduled",
    targetMemberId,
  });
}

export async function getUpcomingEvents(store, date = new Date(), days = 30, { targetMemberId } = {}) {
  return store.listEvents({
    from: date.toISOString(),
    to: dateForSeoulOffset(date, days).toISOString(),
    status: "scheduled",
    targetMemberId,
  });
}

export async function getWeekTimetable(
  store,
  date = new Date(),
  { weekOffset = 0, targetMemberId, respectAcademicCalendar = true } = {},
) {
  const { monday } = getWeekBounds(date, weekOffset);
  const days = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const day = await getTimetableForDate(store, dateForSeoulOffset(monday, index), {
      targetMemberId,
      respectAcademicCalendar,
    });
    return { ...day, weekday: index + 1, rows: day.timetable };
  }));
  return { monday, days };
}

export function formatTimetableRows(rows) {
  if (!rows.length) return "등록된 수업이 없습니다.";
  return rows
    .map((row) => {
      const normalized = normalizeTimetableRow(row);
      const detail = [normalized.activity, normalized.room].filter(Boolean).join(" · ");
      return `${normalized.period}교시 ${formatTimetableSubject(normalized)}${detail ? ` — ${detail}` : ""}${normalized.memo ? `\n  준비: ${normalized.memo}` : ""}`;
    })
    .join("\n");
}

export function formatDayTimetable(bundle) {
  const timetable = formatTimetableRows(bundle.timetable || bundle.rows || []);
  if (!bundle.academicDay) return timetable;
  const notice = `학사일정: ${bundle.academicDay.label}`;
  if (bundle.academicDay.noRegularClasses) {
    return `${notice}\n${bundle.academicDay.emptyText || "정규 수업이 없습니다."}`;
  }
  return `${notice}\n${timetable}`;
}

export function formatWeekTimetable(bundle) {
  return bundle.days
    .map((day) => `${formatKoreanDate(day.date)}\n${formatDayTimetable(day)}`)
    .join("\n\n");
}

export function formatEventRows(events, baseDate = new Date(), emptyText = "예정된 수행평가나 과제가 없습니다.") {
  if (!events.length) return emptyText;
  const base = startOfSeoulDay(baseDate).getTime();
  return events
    .map((event) => {
      const due = new Date(event.due_at);
      const days = Math.ceil((startOfSeoulDay(due).getTime() - base) / 86_400_000);
      const dday = days === 0 ? "오늘" : days === 1 ? "내일" : days > 1 ? `D-${days}` : "마감";
      return `• [${categoryLabel(event.category)}] ${event.subject ? `${event.subject} ` : ""}${event.title} · ${dday}\n  ${formatKoreanDateTime(due)}`;
    })
    .join("\n");
}

export function buildDailyDigestText(bundle) {
  const title = `[Quilo] ${formatKoreanDate(bundle.date)}`;
  const timetable = formatDayTimetable(bundle);
  const events = bundle.events.length ? `\n\n오늘 마감\n${formatEventRows(bundle.events, bundle.date)}` : "";
  return `${title}\n\n${timetable}${events}`;
}

export function buildEventReminderText(event, offsetMinutes, now = new Date()) {
  const due = new Date(event.due_at);
  const label = offsetMinutes === 0 ? "오늘 마감" : offsetMinutes === 1440 ? "D-1" : `D-${Math.round(offsetMinutes / 1440)}`;
  const description = event.description ? `\n${event.description}` : "";
  return `[Quilo] ${label} ${categoryLabel(event.category)}\n${event.subject ? `${event.subject} · ` : ""}${event.title}\n마감: ${formatKoreanDateTime(due)}${description}`;
}
