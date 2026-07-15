const QUICK_REPLIES = [
  { label: "도움말", action: "message", messageText: "도움말" },
  { label: "공지", action: "message", messageText: "공지" },
  { label: "알림 설정", action: "message", messageText: "알림 설정" },
];

const USER_KEY_TYPES = new Set(["botUserKey", "plusfriendUserKey", "appUserId"]);

function normalizedUsers(users) {
  if (!Array.isArray(users)) throw new Error("Kakao 발송 대상은 배열이어야 합니다.");
  const unique = new Map();
  for (const user of users) {
    const type = String(user?.type || "");
    const id = String(user?.id || "").trim();
    if (!USER_KEY_TYPES.has(type) || !id) throw new Error("Kakao 발송 대상의 사용자 키 타입 또는 값이 올바르지 않습니다.");
    const previous = unique.get(id);
    if (previous && previous.type !== type) throw new Error("같은 Kakao 사용자 키를 서로 다른 타입으로 중복 발송할 수 없습니다.");
    unique.set(id, { type, id });
  }
  const result = [...unique.values()];
  if (result.length > 100) throw new Error("Kakao Event API는 한 번에 최대 100명에게만 발송할 수 있습니다.");
  return result;
}

function normalizedEventData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Kakao event.data는 문자열 값 객체여야 합니다.");
  const entries = Object.entries(data);
  if (entries.some(([key, value]) => !key || typeof value !== "string")) {
    throw new Error("Kakao event.data의 키와 값은 모두 문자열이어야 합니다.");
  }
  return Object.fromEntries(entries);
}

export function simpleTextResponse(text, quickReplies = QUICK_REPLIES) {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: String(text).slice(0, 1000) } }],
      quickReplies,
    },
  };
}

export function personalizedQuickReplies(displayName) {
  const name = String(displayName || "").trim();
  if (!name) return QUICK_REPLIES;
  return [
    `오늘 일정 ${name}`,
    `내일 일정 ${name}`,
    `이번 주 일정 ${name}`,
    `오늘 시간표 ${name}`,
    `과제 ${name}`,
  ].map((messageText) => ({ label: messageText, action: "message", messageText }));
}

export function extractKakaoUser(payload = {}) {
  const user = payload.userRequest?.user || {};
  const properties = user.properties || {};
  const candidates = [
    ["botUserKey", properties.botUserKey],
    ["plusfriendUserKey", properties.plusfriendUserKey],
    ["appUserId", properties.appUserId],
    ["botUserKey", user.id],
  ];
  const [type, id] = candidates.find(([, value]) => typeof value === "string" && value.trim()) || [];
  return id ? { type, id } : null;
}

export class KakaoEventClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  get enabled() {
    return this.config.enabled;
  }

  async send({ users, data, eventName = this.config.eventName }) {
    if (!this.enabled) throw new Error("Kakao Event API가 아직 활성화되지 않았습니다.");
    const recipients = normalizedUsers(users);
    if (!recipients.length) return { status: "SKIPPED", taskId: null };
    const eventData = normalizedEventData(data);
    const response = await this.fetch(`${this.config.apiBase}/v2/bots/${encodeURIComponent(this.config.botId)}/talk`, {
      method: "POST",
      headers: {
        Authorization: `KakaoAK ${this.config.restApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: { name: String(eventName), data: eventData },
        user: recipients,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status !== "SUCCESS") {
      throw new Error(body.message || `Kakao Event API 요청 실패 (${response.status})`);
    }
    return body;
  }

  async getTask(taskId) {
    const response = await this.fetch(`${this.config.apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `KakaoAK ${this.config.restApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Kakao 발송 결과 조회 실패 (${response.status})`);
    return body;
  }
}
