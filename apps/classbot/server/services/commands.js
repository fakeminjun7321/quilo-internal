import { extractKakaoUser, personalizedQuickReplies, simpleTextResponse } from "./kakao.js";
import {
  formatEventRows,
  formatTimetableRows,
  formatWeekTimetable,
  getDaySchedule,
  getUpcomingEvents,
  getWeekEvents,
  getWeekTimetable,
} from "./schedule.js";
import { dateForSeoulOffset, formatKoreanDate } from "../time.js";

const TRAILING_REQUEST_WORDS = new Set([
  "알려줘", "알려주세요", "보여줘", "보여주세요", "확인", "확인해줘", "확인해주세요",
  "조회", "조회해줘", "조회해주세요", "뭐야", "있어", "있나요", "부탁해", "부탁해요",
  "해줘", "해주세요", "일정", "시간표", "수업표", "수행평가", "시험", "과제", "숙제", "스케줄",
]);

function parameterValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return String(value.value ?? value.origin ?? "");
  return String(value);
}

function extractCommand(payload) {
  const params = payload.action?.params || {};
  return parameterValue(params.command || params.action || payload.userRequest?.utterance).trim();
}

function extractInviteCode(payload, command) {
  const params = payload.action?.params || {};
  const explicit = parameterValue(params.inviteCode || params.invite_code || params.code).trim();
  if (explicit) return explicit;
  return command.match(/(?:가입|초대)\s*([A-Z0-9]{4}-?[A-Z0-9]{4})/i)?.[1] || "";
}

function normalizedText(value) {
  return String(value || "")
    .trim()
    .replace(/[?!.,。]+$/u, "")
    .replace(/\s+/g, " ");
}

function compactText(value) {
  return normalizedText(value).replace(/\s+/g, "").toLowerCase();
}

function readIntent(command) {
  const compact = compactText(command);
  if (compact.includes("시간표") || compact.includes("수업표")) return "timetable";
  if (compact.includes("수행평가") || compact.includes("시험") || compact.includes("테스트")) return "assessment";
  if (compact.includes("과제") || compact.includes("숙제") || compact.includes("제출물")) return "assignment";
  if (["일정", "스케줄", "할일", "할것", "뭐있", "해야할"].some((word) => compact.includes(word))) return "schedule";
  return null;
}

function readPeriod(command, intent) {
  const compact = compactText(command);
  if (compact.includes("다음주") || compact.includes("차주")) return { kind: "week", offset: 1, label: "다음 주" };
  if (compact.includes("이번주") || compact.includes("금주") || compact.includes("주간")) return { kind: "week", offset: 0, label: "이번 주" };
  if (compact.includes("모레")) return { kind: "day", offset: 2 };
  if (compact.includes("내일") || compact.includes("명일") || compact.startsWith("낼")) return { kind: "day", offset: 1 };
  if (compact.includes("오늘") || compact.includes("금일")) return { kind: "day", offset: 0 };
  return intent === "timetable" ? { kind: "day", offset: 0 } : { kind: "upcoming", days: 30 };
}

function appearsAsSeparateName(text, name) {
  return text === name || text.startsWith(`${name} `) || text.endsWith(` ${name}`) || text.includes(` ${name} `);
}

function resolveTargetMember(command, members) {
  const text = normalizedText(command);
  const registered = members
    .filter((member) => member.status !== "left" && String(member.display_name || "").trim())
    .map((member) => ({ ...member, display_name: normalizedText(member.display_name) }));
  const matches = registered.filter((member) => text === member.display_name || text.endsWith(` ${member.display_name}`));

  if (matches.length > 1) {
    throw new Error(`동명이인 '${matches[0].display_name}'이(가) 여러 명입니다. 관리자가 이름을 구분해 등록해야 합니다.`);
  }
  if (matches.length === 1) {
    const member = matches[0];
    return { member, query: text.slice(0, -member.display_name.length).trim() };
  }

  const misplaced = registered.find((member) => appearsAsSeparateName(text, member.display_name));
  if (misplaced) {
    throw new Error(`구성원 이름 '${misplaced.display_name}'은(는) 질문의 맨 뒤에 붙여 주세요. 예: '오늘 일정 ${misplaced.display_name}'`);
  }

  const tail = text.split(" ").at(-1) || "";
  const tailCompact = compactText(tail);
  const looksLikeQueryWord = TRAILING_REQUEST_WORDS.has(tailCompact)
    || ["오늘", "금일", "내일", "명일", "모레", "이번주", "다음주", "금주", "차주", "주간"].includes(tailCompact);
  if (!looksLikeQueryWord && tail.length >= 2 && tail.length <= 40) {
    throw new Error(`등록된 구성원 '${tail}'을(를) 찾을 수 없습니다. 이름을 확인해 주세요.`);
  }
  throw new Error("조회할 구성원 이름을 질문의 맨 뒤에 붙여 주세요. 예: '오늘 일정 홍길동'");
}

function noticeText(notices) {
  if (!notices.length) return "게시된 반 공지가 없습니다.";
  return notices
    .map((notice) => `${notice.pinned ? "📌 " : "• "}${notice.title}\n${notice.body}`)
    .join("\n\n");
}

function helpText() {
  return [
    "Quilo에서 이렇게 물어보세요.",
    "일정·시간표 조회는 등록된 구성원 이름을 항상 맨 뒤에 붙여 주세요.",
    "• 오늘 일정 홍길동 / 내일 일정 홍길동 / 모레 일정 홍길동",
    "• 이번 주 일정 홍길동 / 다음 주 시험 홍길동",
    "• 오늘 시간표 홍길동 / 숙제 홍길동",
    "• 공지",
    "• 가입 ABCD-EFGH",
    "• 알림 설정 / 알림 켜기 / 알림 끄기",
  ].join("\n");
}

function eventKind(intent) {
  if (intent === "assessment") return { label: "수행평가", category: "assessment", empty: "등록된 수행평가가 없습니다." };
  if (intent === "assignment") return { label: "과제", category: "assignment", empty: "등록된 과제가 없습니다." };
  return { label: "일정", category: null, empty: "등록된 일정이 없습니다." };
}

async function answerReadQuery({ command, intent, member, store, now }) {
  const period = readPeriod(command, intent);
  const replies = personalizedQuickReplies(member.display_name);

  if (intent === "timetable") {
    if (period.kind === "week") {
      const bundle = await getWeekTimetable(store, now, { weekOffset: period.offset });
      return simpleTextResponse(
        `${member.display_name}님의 ${period.label} 시간표\n\n${formatWeekTimetable(bundle)}`,
        replies,
      );
    }
    const target = dateForSeoulOffset(now, period.offset);
    const bundle = await getDaySchedule(store, target, { targetMemberId: member.id });
    return simpleTextResponse(
      `${member.display_name}님의 ${formatKoreanDate(target)} 시간표\n\n${formatTimetableRows(bundle.timetable)}`,
      replies,
    );
  }

  let events;
  let rangeLabel;
  if (period.kind === "day") {
    const target = dateForSeoulOffset(now, period.offset);
    events = (await getDaySchedule(store, target, { targetMemberId: member.id })).events;
    rangeLabel = formatKoreanDate(target);
  } else if (period.kind === "week") {
    events = await getWeekEvents(store, now, { weekOffset: period.offset, targetMemberId: member.id });
    rangeLabel = period.label;
  } else {
    events = await getUpcomingEvents(store, now, period.days, { targetMemberId: member.id });
    rangeLabel = `앞으로 ${period.days}일`;
  }

  const kind = eventKind(intent);
  if (kind.category) events = events.filter((event) => event.category === kind.category);
  return simpleTextResponse(
    `${member.display_name}님의 ${rangeLabel} ${kind.label}\n\n${formatEventRows(events, now, kind.empty)}`,
    replies,
  );
}

export async function handleKakaoCommand({ payload, store, now = new Date() }) {
  const command = extractCommand(payload);
  const normalized = compactText(command);
  const user = extractKakaoUser(payload);
  let targetDisplayName = "";

  try {
    if (/^(가입|초대)/.test(command)) {
      const code = extractInviteCode(payload, command);
      if (!user) return simpleTextResponse("카카오 사용자 식별값을 확인할 수 없어 가입할 수 없습니다.");
      if (!code) return simpleTextResponse("관리자에게 받은 초대 코드로 ‘가입 ABCD-EFGH’처럼 입력해 주세요.");
      const member = await store.claimInvite({ code, userKey: user.id, userKeyType: user.type });
      const isFriend = String(payload.userRequest?.user?.properties?.isFriend ?? "").toLowerCase();
      const friendGuide = isFriend === "false" ? "\n알림을 받으려면 이 카카오톡 채널을 친구 추가해 주세요." : "";
      return simpleTextResponse(
        `${member.display_name}님, 2학년 4반 가입이 완료되었습니다.\n알림 설정에서 수신 여부를 바꿀 수 있어요.${friendGuide}`,
        personalizedQuickReplies(member.display_name),
      );
    }

    const intent = readIntent(command);
    if (intent) {
      const target = resolveTargetMember(command, await store.listMembers());
      targetDisplayName = target.member.display_name;
      const targetIntent = readIntent(target.query);
      if (!targetIntent) throw new Error("조회할 일정 종류가 필요합니다. 예: '오늘 일정 홍길동'");
      return await answerReadQuery({ command: target.query, intent: targetIntent, member: target.member, store, now });
    }

    const member = user ? await store.findMemberByUserKey(user.id) : null;
    const requiresMembership = normalized.includes("알림") || normalized.includes("공지");
    if (requiresMembership && !member) {
      return simpleTextResponse("2학년 4반 구성원만 조회할 수 있습니다. 먼저 ‘가입 초대코드’를 입력해 주세요.");
    }

    const memberReplies = member ? personalizedQuickReplies(member.display_name) : undefined;
    if (normalized.includes("알림")) {
      if (normalized.includes("아침알림끄기")) {
        await store.updateMember(member.id, { daily_digest_enabled: false }, member.id);
        return simpleTextResponse("평일 아침 시간표 알림을 껐습니다. 수행평가와 공지 알림은 계속 받을 수 있어요.", memberReplies);
      }
      if (normalized.includes("아침알림켜기")) {
        await store.updateMember(member.id, { daily_digest_enabled: true }, member.id);
        return simpleTextResponse("평일 아침 시간표 알림을 켰습니다.", memberReplies);
      }
      if (normalized.includes("끄기") || normalized.includes("해제") || normalized.includes("거부")) {
        await store.updateMember(member.id, { notification_enabled: false }, member.id);
        return simpleTextResponse("모든 카카오 알림을 껐습니다. 시간표와 일정 조회는 계속 사용할 수 있어요.", memberReplies);
      }
      if (normalized.includes("켜기") || normalized.includes("신청") || normalized.includes("동의")) {
        await store.updateMember(member.id, { notification_enabled: true }, member.id);
        return simpleTextResponse("카카오 알림을 켰습니다.", memberReplies);
      }
      return simpleTextResponse(
        `${member.display_name}님의 알림\n전체 알림: ${member.notification_enabled ? "켜짐" : "꺼짐"}\n평일 아침 시간표: ${member.daily_digest_enabled ? "켜짐" : "꺼짐"}\n\n‘알림 켜기’, ‘알림 끄기’, ‘아침 알림 켜기’로 바꿀 수 있어요.`,
        memberReplies,
      );
    }

    if (normalized.includes("공지")) {
      const notices = await store.listNotices({ status: "published", limit: 5 });
      return simpleTextResponse(`2학년 4반 공지\n\n${noticeText(notices)}`, memberReplies);
    }

    return simpleTextResponse(helpText());
  } catch (error) {
    const friendly = /초대 코드|이미 다른 구성원|이미 가입|학급 정원|찾을 수 없습니다|필요합니다|구성원 이름|등록된 구성원|동명이인|맨 뒤/.test(error.message)
      ? error.message
      : "잠시 후 다시 시도해 주세요.";
    const replies = targetDisplayName ? personalizedQuickReplies(targetDisplayName) : undefined;
    return simpleTextResponse(`요청을 처리하지 못했습니다. ${friendly}`, replies);
  }
}
