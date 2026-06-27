// 독서활동 기록지 (독서록) — 콘텐츠 생성
//
// 입력: 도서명(+선택 저자/출판사/영역/교과/대출/날짜) + 참고 메모(userNotes)
// 출력: prompt.md 스키마를 따르는 JSON (author / publisher / selection_reason /
//        content_summary / reflection) + 양식 채우기에 필요한 메타데이터.
//
// 출력 분량이 짧아(세 서술 항목) 단일 non-stream messages.create 로 충분하다.
// 호스팅 스트림 수명 컷오프(~150s) 위험 구간에 한참 못 미친다.

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { calcCost, formatCostLine } = require("../../pricing");
const { parseJsonLenient } = require("../../json-sanitize");
const { extractJson } = require("../../claude-stream");

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "claude-opus-4-8";
const MAX_TOKENS = Math.min(parseInt(process.env.MAX_TOKENS || "32000", 10), 8000);

const SKILL_PATH = path.join(__dirname, "prompt.md");
function loadSkill() {
  return fs.readFileSync(SKILL_PATH, "utf8");
}

// 영역 코드 → (큰 분류, 표시 라벨). index.html 의 select 값과 일치해야 한다.
const DOMAIN_MAP = {
  "major-math": ["전공도서", "수학"],
  "major-physics": ["전공도서", "물리"],
  "major-chemistry": ["전공도서", "화학"],
  "major-biology": ["전공도서", "생명과학"],
  "major-earth": ["전공도서", "지구과학"],
  "major-cs": ["전공도서", "정보과학"],
  "general-philosophy": ["일반도서", "교양·철학·종교"],
  "general-social": ["일반도서", "사회과학"],
  "general-science-art": ["일반도서", "과학·예술·언어"],
  "general-literature": ["일반도서", "문학"],
  "general-history": ["일반도서", "역사"],
  "general-classics": ["일반도서", "고전"],
};

// YYYY-MM-DD → "YYYY년 M월 D일". 형식이 어긋나면 원문 그대로.
function fmtKoreanDate(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return String(s || "").trim();
  return `${m[1]}년 ${parseInt(m[2], 10)}월 ${parseInt(m[3], 10)}일`;
}

function buildDateRange(startDate, endDate) {
  const a = fmtKoreanDate(startDate);
  const b = fmtKoreanDate(endDate);
  if (a && b) return `${a} ~ ${b}`;
  if (a) return a;
  if (b) return b;
  return "";
}

function toParas(v) {
  if (Array.isArray(v)) {
    return v.map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  }
  const s = String(v == null ? "" : v).trim();
  if (!s) return [];
  return s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

async function generateReportContent({
  bookTitle = "",
  author = "",
  publisher = "",
  recordArea = "",
  subject = "",
  domain = "",
  borrowed = "",
  startDate = "",
  endDate = "",
  userNotes = "",
  fontFace,
  date,
  model = null,
  signal,
  onProgress = () => {},
}) {
  const title = String(bookTitle || "").trim();
  if (!title) throw new Error("도서명이 비어 있습니다.");

  const [domainGroup, domainLabel] = DOMAIN_MAP[domain] || ["", ""];
  const dateRange = buildDateRange(startDate, endDate);

  const MODEL = model || DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 10 * 60 * 1000,
  });

  // ── 사용자 입력 → 프롬프트 컨텍스트 ──────────────────────────────────
  const lines = [];
  lines.push(`도서명: ${title}`);
  if (author) lines.push(`저자(사용자 입력): ${author}`);
  if (publisher) lines.push(`출판사(사용자 입력): ${publisher}`);
  if (domainGroup) lines.push(`독서 영역: ${domainGroup} - ${domainLabel}`);
  if (recordArea === "subject")
    lines.push(`학생부 기록: 과목별 독서기록${subject ? ` (교과명: ${subject})` : ""}`);
  else if (recordArea === "common") lines.push("학생부 기록: 공통 독서기록");

  let userMessage =
    "아래 책에 대한 독서활동 기록지를 작성한다.\n\n" + lines.join("\n");
  if (String(userNotes || "").trim()) {
    userMessage +=
      "\n\n[참고 메모 — 학생 본인의 감상·관점. 최우선 반영하되 과장·날조 금지]\n" +
      String(userNotes).trim().slice(0, 8000);
  }
  userMessage +=
    "\n\n위 정보를 바탕으로 prompt.md 스키마(author/publisher/selection_reason/content_summary/reflection)를 따르는 JSON 한 블록만 출력하라.";

  onProgress("📖 독서록 초안을 작성하는 중…");

  const resp = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: loadSkill(),
      messages: [{ role: "user", content: userMessage }],
    },
    { signal },
  );

  try {
    const cost = calcCost({ usage: resp.usage, model: MODEL });
    if (cost) onProgress(formatCostLine(cost));
  } catch (_) {
    /* 비용 표기는 부가 정보 — 실패해도 무시 */
  }

  const finalText = (resp.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let parsed;
  try {
    parsed = parseJsonLenient(extractJson(finalText));
  } catch (e) {
    throw new Error(
      "AI 응답을 JSON 으로 해석하지 못했습니다. 다시 시도해 주세요. (" +
        (e && e.message ? e.message : e) +
        ")",
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 응답이 비어 있습니다. 다시 시도해 주세요.");
  }

  const selectionReason = toParas(parsed.selection_reason);
  const contentSummary = toParas(parsed.content_summary);
  const reflection = toParas(parsed.reflection);
  if (!selectionReason.length && !contentSummary.length && !reflection.length) {
    throw new Error("AI 가 본문 내용을 만들지 못했습니다. 다시 시도해 주세요.");
  }

  onProgress("✅ 독서록 초안 작성 완료 — 양식에 채우는 중…");

  // 사용자 입력값을 우선하고, 비었으면 AI 추정값으로 보완(불확실하면 빈 문자열).
  const finalAuthor = author || String(parsed.author || "").trim();
  const finalPublisher = publisher || String(parsed.publisher || "").trim();

  return {
    title, // 파일명용
    book_title: title,
    author: finalAuthor,
    publisher: finalPublisher,
    record_area: recordArea, // "subject" | "common" | ""
    subject: String(subject || "").trim(),
    domain_group: domainGroup, // "전공도서" | "일반도서" | ""
    domain_label: domainLabel, // "물리" 등 | ""
    borrowed: borrowed, // "yes" | "no" | ""
    date_range: dateRange, // "YYYY년 M월 D일 ~ ..." | ""
    selection_reason: selectionReason,
    content_summary: contentSummary,
    reflection: reflection,
    __fontFace: fontFace,
    __style: "default",
  };
}

module.exports = { generateReportContent };
