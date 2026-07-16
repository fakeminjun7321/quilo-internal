import {
  extractKakaoUser,
  personalizedQuickReplies,
  registeredQuickReplies,
  simpleImageResponse,
  simpleTextResponse,
  textCardResponse,
} from "./kakao.js";
import {
  formatEventRows,
  formatTimetableRows,
  formatWeekTimetable,
  getDaySchedule,
  getUpcomingEvents,
  getWeekEvents,
  getWeekTimetable,
} from "./schedule.js";
import { dateForSeoulOffset, formatKoreanDate, getSeoulParts } from "../time.js";

const TRAILING_REQUEST_WORDS = new Set([
  "알려줘", "알려주세요", "보여줘", "보여주세요", "확인", "확인해줘", "확인해주세요",
  "조회", "조회해줘", "조회해주세요", "뭐야", "있어", "있나요", "부탁해", "부탁해요",
  "해줘", "해주세요", "일정", "시간표", "수업표", "수행평가", "시험", "과제", "숙제", "스케줄",
  "전체", "요약", "통합요약", "남은일정", "이번달", "이달", "다음일정",
  "자료", "목록", "자료목록", "파일", "pdf", "이미지",
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
  return command.match(/(?:가입|초대|이름등록)\s*([A-Z0-9]{4}-?[A-Z0-9]{4})/i)?.[1] || "";
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

function looksLikeFileCommand(command) {
  return /^(?:자료\s*(?:목록|리스트)|파일(?:\s|$)|pdf(?:\s|$)|이미지(?:\s|$))/iu.test(normalizedText(command));
}

function readFileCommand(command) {
  const text = normalizedText(command);
  if (/^자료\s*(?:목록|리스트)$/u.test(text)) return { kind: "list" };
  const match = text.match(/^(파일|pdf|이미지)\s+(.+)$/iu);
  if (!match) return null;
  const requestedType = match[1].toLowerCase() === "pdf"
    ? "pdf"
    : match[1] === "이미지"
      ? "image"
      : "file";
  return { kind: "open", requestedType, alias: normalizedText(match[2]) };
}

function readIntent(command) {
  const compact = compactText(command);
  if (compact.includes("시간표") || compact.includes("수업표")) return "timetable";
  const asksAssessment = compact.includes("수행평가") || compact.includes("시험") || compact.includes("테스트");
  const asksAssignment = compact.includes("과제") || compact.includes("숙제") || compact.includes("제출물");
  if ((asksAssessment && asksAssignment) || compact.includes("통합요약") || compact.includes("학업요약")) return "study-summary";
  if (asksAssessment) return "assessment";
  if (asksAssignment) return "assignment";
  if (["일정", "스케줄", "할일", "할것", "뭐있", "해야할"].some((word) => compact.includes(word))) return "schedule";
  return null;
}

function readPeriod(command, intent) {
  const compact = compactText(command);
  if (intent === "timetable" && (compact.includes("전체") || compact.includes("월금"))) {
    return { kind: "full-timetable", label: "전체" };
  }
  if (compact.includes("다음일정") || compact.includes("가장가까운일정") || compact.includes("제일빠른일정")) {
    return { kind: "next", label: "다음" };
  }
  if (compact.includes("이번달") || compact.includes("이달")) return { kind: "month", label: "이번 달" };
  if ((compact.includes("이번주") || compact.includes("금주")) && compact.includes("남은")) {
    return { kind: "remaining-week", label: "이번 주 남은" };
  }
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

function resolveTargetMember(command, members, { defaultMember } = {}) {
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
    return { member, query: text.slice(0, -member.display_name.length).trim(), implicit: false };
  }

  const misplaced = registered.find((member) => appearsAsSeparateName(text, member.display_name));
  if (misplaced) {
    throw new Error(`구성원 이름 '${misplaced.display_name}'은(는) 질문의 맨 뒤에 붙여 주세요. 예: '오늘 일정 ${misplaced.display_name}'`);
  }

  const tail = text.split(" ").at(-1) || "";
  const tailCompact = compactText(tail);
  const looksLikeQueryWord = TRAILING_REQUEST_WORDS.has(tailCompact)
    || ["오늘", "금일", "내일", "명일", "모레", "이번주", "다음주", "금주", "차주", "주간"].includes(tailCompact);
  if (looksLikeQueryWord && defaultMember) return { member: defaultMember, query: text, implicit: true };
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
    "최초 1회 관리자에게 받은 코드로 ‘이름등록 ABCD-EFGH’를 입력해 주세요.",
    "등록 후 본인 일정·시간표·자료 조회에는 이름을 붙이지 않아도 됩니다.",
    "• 오늘 일정 / 내일 일정 / 다음 일정",
    "• 이번 주 남은 일정 / 이번 달 일정",
    "• 수행평가 과제 통합 요약 / 다음 주 시험",
    "• 오늘 시간표 / 시간표 전체",
    "• 자료 목록 / PDF 가정통신문 / 이미지 좌석표",
    "다른 구성원의 일정은 기존처럼 질문 맨 뒤에 등록 이름을 붙여 조회할 수 있어요.",
    "자료는 카카오 가입이 완료된 본인만 열 수 있어요.",
    "• 공지",
    "• 이름등록 ABCD-EFGH (기존 ‘가입 ABCD-EFGH’도 가능)",
    "• 알림 설정 / 알림 켜기 / 알림 끄기",
  ].join("\n");
}

function eventKind(intent) {
  if (intent === "assessment") return { label: "수행평가", category: "assessment", empty: "등록된 수행평가가 없습니다." };
  if (intent === "assignment") return { label: "과제", category: "assignment", empty: "등록된 과제가 없습니다." };
  if (intent === "study-summary") {
    return {
      label: "수행평가·과제 통합 요약",
      categories: new Set(["assessment", "assignment"]),
      empty: "등록된 수행평가나 과제가 없습니다.",
    };
  }
  return { label: "일정", category: null, empty: "등록된 일정이 없습니다." };
}

function monthBounds(date) {
  const { year, month } = getSeoulParts(date);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+09:00`);
  const next = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`);
  return { start, end: new Date(next.getTime() - 1), label: `${year}년 ${month}월` };
}

function availableFiles(items, memberId) {
  return (Array.isArray(items) ? items : [])
    .filter((file) => file?.member_id == null || file.member_id === memberId)
    .filter((file) => String(file.status || "").toLowerCase() === "active")
    .sort((a, b) => String(a.alias || a.filename || "").localeCompare(String(b.alias || b.filename || ""), "ko"));
}

function isImageFile(file) {
  return String(file.mime_type || "").toLowerCase().startsWith("image/");
}

function isPdfFile(file) {
  return String(file.mime_type || "").toLowerCase() === "application/pdf"
    || String(file.filename || "").toLowerCase().endsWith(".pdf");
}

function fileSizeLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fileListText(files, displayName) {
  if (!files.length) return `${displayName}님이 조회할 수 있는 자료가 없습니다.`;
  const rows = files.map((file) => {
    const type = isImageFile(file) ? "이미지" : isPdfFile(file) ? "PDF" : "파일";
    const scope = file.member_id == null ? "반 전체" : "개인";
    const detail = [file.description, file.filename, fileSizeLabel(file.size_bytes)].filter(Boolean).join(" · ");
    return `• [${scope} ${type}] ${file.alias || file.filename}${detail ? `\n  ${detail}` : ""}`;
  });
  return `${displayName}님의 자료 목록\n\n${rows.join("\n")}`;
}

async function answerFileQuery({ command, requester, store, makeFileUrl, quickReplies }) {
  const replies = quickReplies || registeredQuickReplies();
  if (typeof store.listFiles !== "function") {
    return simpleTextResponse("현재 자료 조회 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", replies);
  }
  const spec = readFileCommand(command);
  if (!spec) return simpleTextResponse("‘자료 목록 이름’ 또는 ‘파일 별칭 이름’처럼 입력해 주세요.", replies);

  const files = availableFiles(await store.listFiles({ targetMemberId: requester.id }), requester.id);
  if (spec.kind === "list") return simpleTextResponse(fileListText(files, requester.display_name), replies);

  const alias = normalizedText(spec.alias).toLowerCase();
  const matches = files.filter((file) => normalizedText(file.alias || file.filename).toLowerCase() === alias);
  const typedMatches = matches.filter((file) => spec.requestedType === "file"
    || (spec.requestedType === "pdf" && isPdfFile(file))
    || (spec.requestedType === "image" && isImageFile(file)));
  if (typedMatches.length !== 1) return simpleTextResponse("요청한 자료를 찾을 수 없습니다. ‘자료 목록’에서 별칭을 확인해 주세요.", replies);
  if (typeof makeFileUrl !== "function") {
    return simpleTextResponse("현재 자료 열기 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", replies);
  }

  const file = typedMatches[0];
  let url;
  try {
    url = await makeFileUrl(file);
  } catch {
    return simpleTextResponse("현재 자료 열기 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", replies);
  }
  const title = file.alias || file.filename || "Quilo 자료";
  if (isImageFile(file) && file.member_id == null) {
    try {
      return simpleImageResponse({ imageUrl: url, altText: `${title} 이미지` }, replies);
    } catch {
      return simpleTextResponse("현재 자료 열기 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", replies);
    }
  }
  try {
    return textCardResponse({
      title,
      description: [file.description, file.filename, fileSizeLabel(file.size_bytes)].filter(Boolean).join("\n"),
      url,
      buttonLabel: isPdfFile(file) ? "PDF 열기" : "파일 열기",
    }, replies);
  } catch {
    return simpleTextResponse("현재 자료 열기 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", replies);
  }
}

async function answerReadQuery({ command, intent, member, store, now, quickReplies }) {
  const period = readPeriod(command, intent);
  const replies = quickReplies || personalizedQuickReplies(member.display_name);

  if (intent === "timetable") {
    if (period.kind === "full-timetable") {
      const bundle = await getWeekTimetable(store, now);
      return simpleTextResponse(
        `${member.display_name}님의 월~금 전체 시간표\n\n${formatWeekTimetable(bundle)}`,
        replies,
      );
    }
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
  } else if (period.kind === "remaining-week") {
    events = (await getWeekEvents(store, now, { targetMemberId: member.id }))
      .filter((event) => new Date(event.due_at).getTime() >= now.getTime());
    rangeLabel = period.label;
  } else if (period.kind === "month") {
    const bounds = monthBounds(now);
    events = await store.listEvents({
      from: bounds.start.toISOString(),
      to: bounds.end.toISOString(),
      status: "scheduled",
      targetMemberId: member.id,
    });
    rangeLabel = bounds.label;
  } else if (period.kind === "next") {
    events = await store.listEvents({
      from: now.toISOString(),
      status: "scheduled",
      targetMemberId: member.id,
    });
    events = events.slice(0, 1);
    rangeLabel = period.label;
  } else {
    events = await getUpcomingEvents(store, now, period.days, { targetMemberId: member.id });
    rangeLabel = `앞으로 ${period.days}일`;
  }

  const kind = eventKind(intent);
  if (kind.category) events = events.filter((event) => event.category === kind.category);
  if (kind.categories) events = events.filter((event) => kind.categories.has(event.category));
  return simpleTextResponse(
    `${member.display_name}님의 ${rangeLabel} ${kind.label}\n\n${formatEventRows(events, now, kind.empty)}`,
    replies,
  );
}

export async function handleKakaoCommand({ payload, store, now = new Date(), makeFileUrl }) {
  const command = extractCommand(payload);
  const normalized = compactText(command);
  const user = extractKakaoUser(payload);
  let targetDisplayName = "";
  let targetQuickReplies;
  let requesterLoaded = false;
  let requesterMember = null;
  const getRequester = async () => {
    if (!requesterLoaded) {
      requesterLoaded = true;
      requesterMember = user ? await store.findMemberByUserKey(user.id) : null;
    }
    return requesterMember;
  };

  try {
    if (/^(가입|초대|이름등록)/.test(command)) {
      const code = extractInviteCode(payload, command);
      if (!user) return simpleTextResponse("카카오 사용자 식별값을 확인할 수 없어 가입할 수 없습니다.");
      if (!code) return simpleTextResponse("관리자에게 받은 코드로 ‘이름등록 ABCD-EFGH’처럼 입력해 주세요. 기존 ‘가입’ 명령도 사용할 수 있습니다.");
      const member = await store.claimInvite({ code, userKey: user.id, userKeyType: user.type });
      const isFriend = String(payload.userRequest?.user?.properties?.isFriend ?? "").toLowerCase();
      const friendGuide = isFriend === "false" ? "\n알림을 받으려면 이 카카오톡 채널을 친구 추가해 주세요." : "";
      return simpleTextResponse(
        `${member.display_name}님, 이름 등록과 2학년 4반 가입이 완료되었습니다.\n이제 ‘오늘 일정’처럼 이름 없이 물어볼 수 있어요. 알림 설정에서 수신 여부도 바꿀 수 있습니다.${friendGuide}`,
        registeredQuickReplies(),
      );
    }

    if (looksLikeFileCommand(command)) {
      const requester = await getRequester();
      const text = normalizedText(command);
      const requesterName = normalizedText(requester?.display_name);
      if (!requester || requester.status !== "active" || !requesterName) {
        return simpleTextResponse("자료를 조회할 권한이 없습니다. 먼저 관리자에게 받은 코드로 이름등록을 완료해 주세요.");
      }
      const registered = (await store.listMembers()).filter((member) => member.status !== "left");
      const trailingMatches = registered.filter((member) => {
        const name = normalizedText(member.display_name);
        return name && (text === name || text.endsWith(` ${name}`));
      });
      if (trailingMatches.some((member) => member.id !== requester.id)) {
        return simpleTextResponse("자료를 조회할 권한이 없습니다. 자료는 가입된 본인만 조회할 수 있습니다.");
      }
      const explicitSelf = trailingMatches.some((member) => member.id === requester.id);
      targetDisplayName = requesterName;
      targetQuickReplies = explicitSelf ? personalizedQuickReplies(requesterName) : registeredQuickReplies();
      const query = explicitSelf ? text.slice(0, -requesterName.length).trim() : text;
      return await answerFileQuery({ command: query, requester, store, makeFileUrl, quickReplies: targetQuickReplies });
    }

    const intent = readIntent(command);
    if (intent) {
      const requester = await getRequester();
      const defaultMember = requester?.status === "active" ? requester : null;
      const target = resolveTargetMember(command, await store.listMembers(), { defaultMember });
      targetDisplayName = target.member.display_name;
      const targetIntent = readIntent(target.query);
      if (!targetIntent) throw new Error("조회할 일정 종류가 필요합니다. 예: '오늘 일정 홍길동'");
      targetQuickReplies = target.implicit ? registeredQuickReplies() : personalizedQuickReplies(target.member.display_name);
      return await answerReadQuery({
        command: target.query,
        intent: targetIntent,
        member: target.member,
        store,
        now,
        quickReplies: targetQuickReplies,
      });
    }

    const member = await getRequester();
    const requiresMembership = normalized.includes("알림") || normalized.includes("공지");
    if (requiresMembership && !member) {
      return simpleTextResponse("2학년 4반 구성원만 조회할 수 있습니다. 먼저 ‘가입 초대코드’를 입력해 주세요.");
    }

    const memberReplies = member ? registeredQuickReplies() : undefined;
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
    const replies = targetQuickReplies || (targetDisplayName ? personalizedQuickReplies(targetDisplayName) : undefined);
    return simpleTextResponse(`요청을 처리하지 못했습니다. ${friendly}`, replies);
  }
}
