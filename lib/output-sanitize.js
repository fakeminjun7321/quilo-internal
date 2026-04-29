// Claude 출력에 흔히 섞여 나오는 비정상 마크업을 보고서 텍스트에서 제거.
//
// 베타테스터 피드백 기반:
//   1. `<cite index="3-2">` 같은 HTML/XML 인용 태그
//   2. `{{EQN:tilde nu = ...}}` 같은 wiki/MediaWiki 스타일 수식 마커
//   3. `<NaOH가 두 가지 역할을 한다>` 같은 angle-bracket 단락 헤더
//      (보통 그 다음에 ①②③ 요약이 따라옴)
//   4. ANSI escape (혹시라도)
//
// JSON 객체의 모든 string 필드에 재귀 적용. 표 셀, 캡션, 분석 단락 모두 정제.

const HTML_TAG_RE = /<\/?(?:cite|ref|sup|sub|em|strong|b|i|u|span|div|mark)\b[^>]*>/gi;

// `{{EQN:...}}`, `{{MATH:...}}` 같은 wiki-style 수식 → 안의 내용만 평문으로.
//   예: `{{EQN:tilde nu = {1 over {2 pi c}} sqrt{k over mu}}}` → `tilde nu = ...`
const WIKI_MATH_RE = /\{\{\s*(?:EQN|MATH|FORMULA|EQUATION)\s*:\s*([\s\S]*?)\}\}/gi;

// `<...>` 형태로 단락 시작에 나오는 임의 헤더(닫는 짝 없음).
//   예: `<NaOH가 두 가지 역할을 한다> ① ...` → 헤더 제거
//   안전을 위해 **한글이 한 글자 이상 포함된** angle-bracket만 제거.
//   이유: 화학식 `<H_{2}O>` 같은 영문 전용은 보존하고, 한글 요약 헤더만
//   타깃으로 잡기 위함.
const ANGLE_HEADER_RE = /<\s*[^<>\n]*[가-힣][^<>\n]{0,80}>\s*/g;

// 특수한 케이스: `<font color=...>` 같은 인라인 스타일 태그 잔재
const STYLE_TAG_RE = /<\/?(?:font|color|style|script)\b[^>]*>/gi;

// ANSI escape sequences (혹시라도 로그에서 흘러나온 경우)
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function sanitizeString(s) {
  if (typeof s !== "string") return s;
  let out = s;
  out = out.replace(ANSI_RE, "");
  out = out.replace(STYLE_TAG_RE, "");
  out = out.replace(HTML_TAG_RE, "");
  out = out.replace(WIKI_MATH_RE, (_, body) => body.trim());
  // angle-bracket 헤더는 마지막에 (다른 태그 처리 후 남은 것만)
  out = out.replace(ANGLE_HEADER_RE, "");
  // 정제 후 양 옆 공백·중복 공백 정리 (단, 줄바꿈은 보존)
  out = out.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/gm, "");
  return out;
}

function sanitize(value) {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v);
    return out;
  }
  return value;
}

module.exports = { sanitize, sanitizeString };
