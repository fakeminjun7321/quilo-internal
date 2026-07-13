// PDF 통번역 오케스트레이션.
//   1) translate_pdf.py 로 번역 대상 문단 추출
//   2) Claude 로 문단을 묶음 단위 번역 (한국어)
//   3) translate_pdf.py 로 번역문을 원본 레이아웃에 삽입
// 그림·도표·벡터 그래픽은 건드리지 않으므로 그대로 보존된다.
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { calcCost } = require("../../pricing");
const { parseJsonLenient } = require("../../json-sanitize");
const tool = require("./pdf-tool");
const {
  assertCompleteTranslations,
  assertCompleteRender,
} = require("./quality-gate");
const {
  createFifoSemaphore,
  createPdfTranslateResourceLimits,
  getProcessWidePdfTranslateResourceLimits,
} = require("./resource-gate");

// 본문 글꼴: Pretendard(고가독성) 있으면 우선, 없으면 NanumGothic.
const FONT_DIR = path.join(__dirname, "../../fonts");
const FONT_PATH = fs.existsSync(path.join(FONT_DIR, "Pretendard-Regular.ttf"))
  ? path.join(FONT_DIR, "Pretendard-Regular.ttf")
  : path.join(FONT_DIR, "NanumGothic-Regular.ttf");

// 번역 기본 모델: 문서 번역엔 Sonnet 으로 충분하고 빠르다(비용↓). 환경변수로 변경 가능.
const DEFAULT_MODEL = process.env.PDF_TRANSLATE_MODEL || "claude-sonnet-5";
// 페이지 절대 상한 — 비용/시간 폭주 방지. 이 이내면 자동 분할·병렬·병합으로 처리한다
// (예: 150쪽 → 50쪽씩 3구간). env 로 조절.
const rawMaxPages = String(process.env.PDF_TRANSLATE_MAX_PAGES || "700").trim();
const MAX_PAGES = /^\d+$/.test(rawMaxPages) && Number(rawMaxPages) > 0
  ? Number(rawMaxPages)
  : 700;
// 분할 기준: 이 쪽수를 넘는 PDF 는 구간으로 나눠 병렬 번역한 뒤 하나로 합친다.
const CHUNK_PAGES = Math.max(
  1,
  parseInt(process.env.PDF_TRANSLATE_CHUNK_PAGES || "50", 10),
);
// 동시에 처리할 구간 수(python 프로세스·메모리 보호). API 동시성은 아래 gate 가 따로 상한.
const CHUNK_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.PDF_TRANSLATE_CHUNK_CONCURRENCY || "4", 10),
);
// 한 번의 요청에 묶을 대략적 글자 수. 키울수록 API 호출(왕복) 수가 줄어 빨라진다.
// (병목은 모델 API 왕복이므로 가장 직접적인 코드레벨 속도 레버. JSON 강제 출력 +
// 누락 재시도가 있어 묶음을 키워도 안전.) env 로 더 키울 수 있다.
// 한 묶음당 글자 수. 키울수록 모델 왕복(=병목) 수가 줄어 빨라진다. maxTokens=글자×2.5 라
// 9000 이면 출력 한도 ~22.5k 로 32k 상한에 여유가 있어 잘림 위험이 낮다(누락 재시도가
// 안전망). 더 키우면 잘림 위험이 비선형으로 커진다. env 로 조절.
const BATCH_CHARS = parseInt(process.env.PDF_TRANSLATE_BATCH_CHARS || "9000", 10);
// 묶음 동시 번역 수(상한). 분할 PDF 는 모든 구간이 이 상한을 '공유'한다(레이트리밋 방지).
// 큰 문서일수록 동시성이 속도를 좌우 — 12 로 상향(rate limit 여유 내). env 로 조절.
const CONCURRENCY = Math.max(
  1,
  parseInt(process.env.PDF_TRANSLATE_CONCURRENCY || "12", 10),
);

const SYSTEM_PROMPT = [
  "You are a professional translator specializing in academic and technical/scientific documents",
  "(lab manuals, papers, textbooks). Translate each given text segment into natural, fluent Korean (한국어).",
  "",
  "Rules:",
  "- The input may contain <sub>...</sub> and <sup>...</sup> tags marking subscripts/superscripts in formulas (e.g. H<sub>2</sub><sup>+</sup>, ψ<sub>el</sub>, σ<sub>g</sub>1s, r<sub>AB</sub>). PRESERVE these tags EXACTLY — keep them around the very same characters, do not remove, move, reorder, translate, or alter them, and do not add new ones. They are markup, not content.",
  "- Translate faithfully. Do NOT summarize, add, drop, or merge content.",
  "- Translate the segment EXACTLY as given. If a segment appears to end mid-sentence (no final period), translate ONLY the text provided — do NOT continue, complete, guess, or invent the rest of the sentence.",
  "- Always translate the natural-language (prose) parts, even when the segment also contains equations, symbols, chemical/electron configurations, or formulas. Return a segment unchanged ONLY if it is ENTIRELY symbols/numbers/formula with no translatable words (and never return English prose untranslated).",
  "- Preserve exactly: numbers, units, math/chemical formulas, variable names, equation symbols, code, URLs, citations,",
  "  and proper nouns that are conventionally left untranslated.",
  "- Use accurate Korean scientific/technical terminology.",
  "- Read ALL segments in the batch as parts of one document. Use their shared context to keep repeated terminology, domain meaning, and Korean register consistent across IDs. IDs are separate only for output mapping and completeness checks: return exactly one translation for every input ID, without merging, splitting, or dropping segments.",
  "- Context-sensitive terminology guidance: translate born-digital as 디지털 원본 or 처음부터 디지털로 생성된; translate reflow text/prose as 텍스트/문단 재배치 or 줄바꿈 재조정 (never 재흐름); translate an internal jump in a PDF as 문서 내 이동 링크 (never 내부 점프); translate heading as 제목 or 표제 and distinguish it from header/머리글; translate a test/regression fixture as 테스트 픽스처 (never 고정물 or 실험 템플릿); translate measurement ledger as 측정값 기록부 or 측정값 목록.",
  "- Context overrides a glossary example when the domain meaning differs. In particular, a physical/mechanical fixture that holds an object is 장치 or 고정구, while a test/regression fixture remains 테스트 픽스처.",
  "- Match the source register, then choose one coherent Korean ending style for the document (해라체 or 하십시오체) and do not mix the two within the same document unless the source itself clearly requires a change.",
  "- For technical / domain-specific terms and named methods, write the Korean translation followed by the original English term in parentheses on first occurrence, e.g. 어텐션(attention), 잔차 연결(residual connection), 계층 정규화(layer normalization). Do this consistently for non-obvious terms. Keep well-known acronyms (BLEU, GPU, RNN, CNN) and proper nouns (제품·논문·사람 이름) as-is.",
  "- Outside those parenthetical English glosses, translate ordinary English adjectives and noun phrases completely. Do not produce mixed literal phrases such as '이 born-digital 페이지' or leave 'ordinary paragraph' in English; use natural Korean wording instead.",
  "- The target language is Korean. Never introduce Devanagari, Arabic, Thai, Cyrillic, Han, emoji, or any other unrelated writing-system characters that were not present in that source segment. Retain a non-Korean proper noun or formula symbol only when its exact characters occur in the source.",
  "- Do not output emoji or other non-BMP Unicode characters; the PDF renderer cannot safely embed them.",
  "- Before returning JSON, check that every number and URL is byte-for-byte unchanged and that every <sub>/<sup> tag and its enclosed literal occur in the same order as the source.",
  "- EXCEPTION: in short segments that are clearly a heading, section title, or table column header / cell (few words, no full sentence), do NOT add the parenthetical English gloss — give only concise Korean so it fits the layout. Still translate lowercase English common nouns such as fixture and page; preserve only proper nouns, IDs, acronyms, code, and other required literals.",
  "- Keep the translation concise; do not pad. Avoid adding words that are not in the source.",
  "- Output literal characters directly (<, >, &, ≤, ≥, /). NEVER use HTML entities such as &gt; &lt; &amp; in the output.",
  "- If a segment is already Korean, return it unchanged.",
  '- Output MUST be a single JSON object and nothing else: {"t": {"<id>": "<korean>", ...}} including every id given.',
].join("\n");

function buildBatches(blocks, maxChars = BATCH_CHARS) {
  const batches = [];
  let cur = [];
  let curChars = 0;
  for (const b of blocks) {
    cur.push(b);
    curChars += (b.text || "").length;
    if (curChars >= maxChars) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function isGptModel(m) {
  return /^gpt/i.test(String(m || ""));
}

const RESPONSE_RETRY_SIZES = Object.freeze([1500, 600, 1, 1, 1]);
const ENGLISH_TOKEN_RE = /[A-Za-z]+(?:-[A-Za-z]+)*/g;
const NUMERIC_TOKEN_RE = /[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?%?/g;
// Stop at non-ASCII Korean particles (".../path에서") while retaining RFC URL punctuation.
const URL_RE = /(?:https?:\/\/|www\.)[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi;
const ALWAYS_ALLOWED_TARGET_SCRIPT_RE = /^(?:\p{Script=Hangul}|\p{Script=Latin}|\p{Script=Common}|\p{Script=Inherited})$/u;

// Units and lowercase product names are literals, not untranslated prose. Single-letter
// units are handled by looksLikeUnitsOrFormulaOnly() instead of being ignored globally:
// otherwise the English article "a" would split a genuine untranslated phrase.
const LOWERCASE_LITERAL_WORDS = new Set([
  "cm", "mm", "km", "nm", "pm", "kg", "mg", "mmol", "mol", "ml", "dl",
  "ms", "ns", "hz", "khz", "mhz", "ghz", "mv", "ma", "kw", "kj", "kpa",
  "mpa", "rpm", "fps", "dpi", "ppi", "bit", "byte", "kb", "mb", "gb", "tb",
  "px", "pt", "db", "bar",
  "numpy", "pandas", "scikit-learn", "tensorflow", "pytorch", "github", "latex",
  "linux", "unix",
]);
const UNIT_WORDS = new Set([
  ...LOWERCASE_LITERAL_WORDS,
  "a", "c", "f", "g", "i", "j", "k", "l", "m", "s", "v", "w",
]);
const ALLOWED_LOWERCASE_PHRASES = [
  "et al", "in situ", "in vitro", "in vivo", "ex vivo", "per se", "vice versa",
];

function sameStringArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameStringMultiset(a, b) {
  return sameStringArray(a.slice().sort(), b.slice().sort());
}

function extractNumericTokens(text) {
  return String(text || "").match(NUMERIC_TOKEN_RE) || [];
}

function extractUrls(text) {
  return (String(text || "").match(URL_RE) || []).map((url) =>
    // Sentence punctuation is not part of an otherwise valid URL. Do not strip ')' because
    // it may legitimately occur in a URL path and exact preservation is safer here.
    url.replace(/[.,;:!?]+$/g, ""),
  );
}

function extractScientificMarkup(text) {
  const value = String(text || "");
  const tags = value.match(/<\/?(?:sub|sup)>/gi) || [];
  const literals = [];
  const re = /<(sub|sup)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(value))) {
    literals.push(`${match[1]}:${match[2]}`);
  }
  return { tags, literals };
}

function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Return unsupported target code points without normalization or text excerpts.
 *
 * The bundled renderer supports BMP Korean/Latin/Common/Inherited characters. Other BMP
 * scripts are retained only when that exact raw code point occurs in the source (formulae and
 * proper nouns). Every non-BMP code point is rejected even if present in the source because the
 * renderer currently cannot guarantee a glyph. Deliberately comparing raw code points prevents
 * NFC/NFKC normalization from laundering a source-absent character into the allow-list.
 */
function findUnsupportedTargetCodePoints(sourceText, targetText) {
  const sourceCodePoints = new Set(
    Array.from(String(sourceText || ""), (char) => char.codePointAt(0)),
  );
  const unsupported = new Map();
  for (const char of Array.from(String(targetText || ""))) {
    const codePoint = char.codePointAt(0);
    const isNonBmp = codePoint > 0xffff;
    const isAlwaysAllowedBmp = !isNonBmp && ALWAYS_ALLOWED_TARGET_SCRIPT_RE.test(char);
    if (isNonBmp || (!isAlwaysAllowedBmp && !sourceCodePoints.has(codePoint))) {
      unsupported.set(codePoint, formatCodePoint(codePoint));
    }
  }
  return Array.from(unsupported.values());
}

function maskRange(chars, start, end) {
  for (let i = Math.max(0, start); i < Math.min(chars.length, end); i += 1) chars[i] = " ";
}

// Keep string length stable so token offsets remain meaningful while excluding explicitly
// allowed English contexts: URLs, code literals, scientific markup, and parenthetical glosses.
function maskAllowedEnglishRegions(text) {
  const value = String(text || "");
  // Regex offsets are UTF-16 code-unit offsets, so split("") (not Array.from) keeps indices
  // aligned even when Korean text or astral math symbols precede a masked range.
  const chars = value.split("");
  const maskMatches = (re) => {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(value))) maskRange(chars, match.index, match.index + match[0].length);
  };
  maskMatches(/```[\s\S]*?```/g);
  maskMatches(/`[^`]*`/g);
  maskMatches(/<(sub|sup)>[\s\S]*?<\/\1>/gi);
  maskMatches(URL_RE);
  maskMatches(/\b[A-Za-z][A-Za-z0-9]*(?:[_./:@\\][A-Za-z0-9_-]+)+\b/g);
  maskMatches(/\b(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g);
  maskMatches(/\b(?:ID|No\.?)\s*[:#]?\s*[A-Za-z0-9][\w.-]*/gi);
  maskMatches(/\bcode\s*[:#]\s*[A-Za-z0-9][\w.-]*/gi);

  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "(" || ch === "（") {
      depth += 1;
      chars[i] = " ";
    } else if ((ch === ")" || ch === "）") && depth > 0) {
      chars[i] = " ";
      depth -= 1;
    } else if (depth > 0) {
      chars[i] = " ";
    }
  }

  let masked = chars.join("");
  for (const phrase of ALLOWED_LOWERCASE_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    masked = masked.replace(new RegExp(`\\b${escaped}\\b`, "gi"), (m) => " ".repeat(m.length));
  }
  return masked;
}

function englishTokens(text) {
  const tokens = [];
  const re = new RegExp(ENGLISH_TOKEN_RE.source, "g");
  let match;
  while ((match = re.exec(String(text || "")))) {
    tokens.push({ raw: match[0], value: match[0].toLowerCase(), start: match.index, end: re.lastIndex });
  }
  return tokens;
}

function looksLikeUnitsOrFormulaOnly(text) {
  const value = maskAllowedEnglishRegions(text).trim();
  if (!value) return true;
  const tokens = englishTokens(value);
  if (!tokens.length) return true;
  return tokens.every(({ raw, value: token }) =>
    UNIT_WORDS.has(token) || raw === raw.toUpperCase() || raw.length === 1,
  );
}

function looksLikeCodeOnly(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/^```[\s\S]*```$/.test(value) || /^`[^`]*`$/.test(value)) return true;
  if (/^(?:npm|pnpm|yarn|pip|python3?|node|git|curl|wget|docker|kubectl|brew|sudo)\s+[-\w./:=@]+(?:\s+[-\w./:=@]+)*$/i.test(value)) return true;
  if (/^(?:const|let|var|def|class|function|import|from|select|insert|update)\b/i.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*\s*(?:=|=>|==|!=|<=|>=)\s*\S+/.test(value)) return true;
  if (/[{};]\s*$/.test(value) && /[=_$.()]/.test(value)) return true;
  return false;
}

function containsTokenSequence(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Conservatively find source English prose that survived in the target. We intentionally do
 * not flag isolated lowercase words: they may be an identifier, unit, or proper noun. A match
 * requires either a lowercase hyphenated word or two adjacent lowercase words, and the same
 * token sequence must occur in the source. Parenthetical glosses and literal regions are masked.
 */
function findUntranslatedEnglishProse(sourceText, targetText) {
  if (looksLikeCodeOnly(sourceText) || looksLikeUnitsOrFormulaOnly(sourceText)) return [];
  const sourceScan = maskAllowedEnglishRegions(sourceText);
  const targetScan = maskAllowedEnglishRegions(targetText);
  const sourceValues = englishTokens(sourceScan).map((token) => token.value);
  const targetTokens = englishTokens(targetScan);
  const suspects = [];
  const seen = new Set();

  const add = (tokens) => {
    const values = tokens.map((token) => token.value);
    if (!containsTokenSequence(sourceValues, values)) return;
    const phrase = tokens.map((token) => token.raw).join(" ");
    const key = phrase.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      suspects.push(phrase);
    }
  };

  for (const token of targetTokens) {
    const lowercase = token.raw === token.raw.toLowerCase();
    if (
      lowercase &&
      token.value.includes("-") &&
      token.value.split("-").every((part) => part.length >= 2) &&
      !LOWERCASE_LITERAL_WORDS.has(token.value)
    ) {
      add([token]);
    }
  }

  let run = [];
  const flush = () => {
    if (run.length >= 2) add(run);
    run = [];
  };
  for (const token of targetTokens) {
    const lowercase = token.raw === token.raw.toLowerCase();
    const allowed = LOWERCASE_LITERAL_WORDS.has(token.value);
    const gap = run.length ? targetScan.slice(run[run.length - 1].end, token.start) : "";
    if (!lowercase || allowed || (run.length && !/^\s+$/.test(gap))) {
      flush();
    }
    if (lowercase && !allowed) run.push(token);
  }
  flush();
  return suspects;
}

function responseReason(code, message, details = {}) {
  return { code, message, ...details };
}

/** Deterministic response-stage validation; no model self-attestation is trusted. */
function validateTranslationCandidate(block, candidate) {
  const source = String(block?.text || "");
  const target = typeof candidate === "string" ? candidate : "";
  const reasons = [];
  if (!target.trim()) {
    reasons.push(responseReason("missing_response", "번역 응답이 비어 있음"));
    return { ok: false, reasons };
  }

  const sourceMarkup = extractScientificMarkup(source);
  const targetMarkup = extractScientificMarkup(target);
  if (
    !sameStringArray(sourceMarkup.tags, targetMarkup.tags) ||
    !sameStringArray(sourceMarkup.literals, targetMarkup.literals)
  ) {
    reasons.push(responseReason(
      "scientific_markup_changed",
      "<sub>/<sup> 태그의 순서 또는 태그 안의 literal이 원문과 다름",
      { source: sourceMarkup, target: targetMarkup },
    ));
  }

  const sourceNumbers = extractNumericTokens(source);
  const targetNumbers = extractNumericTokens(target);
  if (!sameStringMultiset(sourceNumbers, targetNumbers)) {
    reasons.push(responseReason(
      "preserved_numbers_changed",
      "보존해야 할 숫자의 값 또는 개수가 원문과 다름",
      { source: sourceNumbers, target: targetNumbers },
    ));
  }

  const sourceUrls = extractUrls(source);
  const targetUrls = extractUrls(target);
  if (!sameStringMultiset(sourceUrls, targetUrls)) {
    reasons.push(responseReason(
      "preserved_urls_changed",
      "보존해야 할 URL의 값 또는 개수가 원문과 다름",
      { source: sourceUrls, target: targetUrls },
    ));
  }

  const unsupportedCodePoints = findUnsupportedTargetCodePoints(source, target);
  if (unsupportedCodePoints.length) {
    reasons.push(responseReason(
      "unsupported_target_characters",
      `지원하지 않거나 원문에 없던 문자 코드포인트 포함: ${unsupportedCodePoints.join(", ")}`,
      { codePoints: unsupportedCodePoints },
    ));
  }

  const untranslated = findUntranslatedEnglishProse(source, target);
  if (untranslated.length) {
    reasons.push(responseReason(
      "untranslated_english_prose",
      `괄호·코드 밖에 미번역 영어 prose가 남음: ${untranslated.join(", ")}`,
      { phrases: untranslated },
    ));
  }
  return { ok: reasons.length === 0, reasons };
}

function validateTranslationMap(blocks, map) {
  const sourceMap = isPlainObject(map) ? map : {};
  const accepted = {};
  const rejected = {};
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const id = String(block?.id);
    const candidate = sourceMap[id];
    const result = validateTranslationCandidate(block, candidate);
    if (result.ok) accepted[id] = candidate;
    else rejected[id] = { candidate: typeof candidate === "string" ? candidate : null, reasons: result.reasons };
  }
  return { accepted, rejected };
}

// 모델 제공자 추상화. GPT(OpenAI) 면 chat/completions(OpenAI 호환, fetch), 그 외는
// Claude(Anthropic SDK). 반환을 {text, usage} 로 통일하고 usage 는 Anthropic 형식
// (input/output/cache_read/cache_creation)으로 맞춰 calcCost 가 그대로 쓰게 한다.
function makeCaller(model) {
  if (isGptModel(model)) {
    const base = process.env.GPT_API_BASE || "https://api.openai.com/v1";
    const key = process.env.GPT_API_KEY || process.env.OPENAI_API_KEY || "";
    if (!key) {
      throw new Error("GPT_API_KEY(OpenAI) 환경변수가 설정되지 않았습니다.");
    }
    return async ({ system, user, maxTokens, signal }) => {
      const resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // gpt-5.x 계열은 max_completion_tokens 사용. JSON 강제로 펜스/설명 누락 방지.
          max_completion_tokens: Math.min(maxTokens, 32000),
          response_format: { type: "json_object" },
        }),
        signal,
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 200)}`);
      }
      // 빈/비-JSON 응답이면 "Unexpected end of JSON input" 대신 분명한 메시지로.
      const rawBody = await resp.text();
      let j;
      try {
        j = JSON.parse(rawBody);
      } catch {
        throw new Error(
          `OpenAI 응답을 해석할 수 없습니다(status ${resp.status}, ${rawBody.length}바이트)${rawBody ? ": " + rawBody.slice(0, 160) : " — 빈 응답"}`,
        );
      }
      const text = j.choices?.[0]?.message?.content || "";
      const u = j.usage || {};
      const cached = u.prompt_tokens_details?.cached_tokens || 0;
      return {
        text,
        usage: {
          input_tokens: Math.max(0, (u.prompt_tokens || 0) - cached),
          output_tokens: u.completion_tokens || 0,
          cache_read_input_tokens: cached,
          cache_creation_input_tokens: 0, // OpenAI 는 캐시 write 비용 없음
        },
      };
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 50 * 60 * 1000 /* Fable 등 장시간 스트림 — 작업 타임아웃(45분)보다 길게 */ });
  return async ({ system, user, maxTokens, signal }) => {
    const message = await client.messages.create(
      {
        model,
        max_tokens: Math.min(maxTokens, 32000),
        // Sonnet 5는 thinking 생략 시 추론 ON이 기본 → 기존 추론 OFF 동작 유지(Fable은 disabled 400이라 제외).
        ...(/fable/i.test(model || "") ? {} : { thinking: { type: "disabled" } }),
        system: [
          // 정적 시스템 프롬프트 → 5분 ephemeral 캐시로 묶음 간 입력 비용 절감.
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: user }],
      },
      signal ? { signal } : undefined,
    );
    const text = (message.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { text, usage: message.usage };
  };
}

async function translateBatch(
  caller,
  blocks,
  signal,
  { rejectionReasons = {} } = {},
) {
  const items = blocks.map((b) => ({ id: b.id, text: b.text }));
  const correctionLines = blocks
    .map((block) => {
      const reasons = rejectionReasons[String(block.id)];
      if (!Array.isArray(reasons) || !reasons.length) return null;
      return `- ID ${String(block.id)}: ${reasons.map((reason) => reason.message || reason.code || String(reason)).join("; ")}`;
    })
    .filter(Boolean);
  const corrective = correctionLines.length
    ? [
        "This is a targeted correction retry. The previous answers below were rejected by deterministic validation.",
        "Produce fresh corrected translations; do not repeat the rejected wording.",
        "While correcting only these IDs, keep terminology, domain meaning, and Korean ending style consistent with the surrounding document context.",
        ...correctionLines,
        "",
      ].join("\n")
    : "";
  const user =
    corrective +
    "Translate the following segments to Korean. Return only the JSON object described.\n\n" +
    JSON.stringify(items, null, 0);

  // 출력이 잘리면 JSON 파싱 실패로 묶음 전체가 누락된다. 입력 길이에 맞춰 출력 한도를
  // 키운다(실제 출력 토큰만 과금되므로 비용 영향 없음).
  const inputChars = items.reduce((s, it) => s + (it.text || "").length, 0);
  const maxTokens = Math.min(32000, Math.max(8000, Math.ceil(inputChars * 2.5)));

  const { text, usage } = await caller({
    system: SYSTEM_PROMPT,
    user,
    maxTokens,
    signal,
  });

  // {"t":{id:ko}} 가 정상. 모델이 {id:ko} 를 바로 주면 그것도 받되, 배열 등 예상 외
  // 형태는 무시. 펜스/앞뒤 설명이 붙어도 JSON 범위만 추출(누락 주원인 방어).
  let map = {};
  try {
    const parsed = parseJsonLenient(extractJsonText(text));
    if (isPlainObject(parsed) && isPlainObject(parsed.t)) map = parsed.t;
    else if (isPlainObject(parsed)) map = parsed;
  } catch {
    map = {};
  }
  return { map, usage };
}

// 모델 응답에서 JSON 만 뽑는다: ```json 펜스 → 펜스 내부, 아니면 첫 '{'~마지막 '}'.
function extractJsonText(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first !== -1 && last > first) return body.slice(first, last + 1).trim();
  return body.trim();
}

// 작업 내부 동시성 게이트. 프로세스 전체 상한은 resource-gate의 별도 FIFO 세마포어가
// 담당하며, 이 게이트는 한 작업/대형 문서 내부의 기존 상한과 진행률 동작을 유지한다.
function makeGate(max) {
  const semaphore = createFifoSemaphore(max);
  const gate = (fn, options) => semaphore.run(fn, options);
  gate.stats = () => semaphore.stats();
  return gate;
}

// 묶음 번역 진행률 집계기. 단일 PDF 면 자체적으로, 분할 PDF 면 모든 구간이 같은 집계기를
// 공유해 "(done/total 묶음)" 한 줄로 합산 표시한다(병렬 로그 난잡 방지).
function makeBatchProgress(onProgress, label = "🌐 번역 중...") {
  let total = 0;
  let done = 0;
  let last = "";
  const emit = () => {
    if (!total) return;
    const line = `${label} (${done}/${total} 묶음)`;
    if (line !== last) {
      last = line;
      onProgress(line);
    }
  };
  return {
    addTotal(n) {
      total += n;
      emit();
    },
    tick() {
      done += 1;
      emit();
    },
  };
}

function emptyTranslationUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function buildTranslationReusePlan(blocks) {
  const pending = [];
  const direct = {};
  const aliases = new Map();
  const canonicalIdByText = new Map();
  let koreanCount = 0;
  let duplicateCount = 0;

  for (const block of Array.isArray(blocks) ? blocks : []) {
    const id = String(block?.id);
    const text = String(block?.text || "");

    // 시스템 프롬프트도 이미 한국어 구간은 그대로 반환하도록 요구한다. 모델을
    // 왕복하지 않고 같은 문자열을 넣으면 의미·숫자·수식이 byte-for-byte 보존된다.
    const hangulCount = (text.match(/[\uac00-\ud7a3]/g) || []).length;
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;
    const koreanDominant = hangulCount > 0 && hangulCount / (hangulCount + latinCount) >= 0.7;
    if (koreanDominant && validateTranslationCandidate(block, text).ok) {
      direct[id] = text;
      koreanCount += 1;
      continue;
    }

    // 같은 문서의 반복 머리글·꼬리글·섹션명은 한 번만 번역한다. exact text만
    // 묶으므로 문맥이 다른 유사 문장은 합치지 않으며, 결과는 모든 원래 ID로 복제한다.
    const reuseKey = `${String(block?.kind || "page")}\u0000${text}`;
    const canReuseDuplicate = text.trim().length >= 12;
    const canonicalId = canReuseDuplicate ? canonicalIdByText.get(reuseKey) : null;
    if (canonicalId != null) {
      if (!aliases.has(canonicalId)) aliases.set(canonicalId, []);
      aliases.get(canonicalId).push(id);
      duplicateCount += 1;
      continue;
    }

    if (canReuseDuplicate) canonicalIdByText.set(reuseKey, id);
    pending.push(block);
  }

  return { pending, direct, aliases, koreanCount, duplicateCount };
}

/**
 * Translate and deterministically validate text blocks before they can reach the renderer.
 * Invalid answers are deliberately not inserted into translations, so the existing missing-id
 * retry and final assertCompleteTranslations gate remain fail-closed.
 */
async function translateBlocksWithRetries({
  blocks,
  caller,
  gate = (fn) => Promise.resolve().then(fn),
  progress = { addTotal() {}, tick() {} },
  onProgress = () => {},
  signal,
  verbose = true,
  batchChars = BATCH_CHARS,
  retrySizes = RESPONSE_RETRY_SIZES,
  context = "PDF 빠른 번역",
  resourceLimits = getProcessWidePdfTranslateResourceLimits(),
}) {
  const sourceBlocks = Array.isArray(blocks) ? blocks : [];
  const reuse = buildTranslationReusePlan(sourceBlocks);
  const modelBlocks = reuse.pending;
  const translations = { ...reuse.direct };
  const usageSum = emptyTranslationUsage();
  const rejectionReasons = {};
  const lastRejectedCandidate = {};

  const addUsage = (usage) => {
    if (!usage) return;
    usageSum.input_tokens += usage.input_tokens || 0;
    usageSum.output_tokens += usage.output_tokens || 0;
    usageSum.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
    usageSum.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
  };

  const mergeValidatedResult = (batch, map, usage) => {
    addUsage(usage);
    const { accepted, rejected } = validateTranslationMap(batch, map);
    for (const [id, candidate] of Object.entries(accepted)) {
      translations[id] = candidate;
      delete rejectionReasons[id];
      delete lastRejectedCandidate[id];
    }
    for (const [id, rejection] of Object.entries(rejected)) {
      const reasons = rejection.reasons.slice();
      if (
        rejection.candidate != null &&
        Object.prototype.hasOwnProperty.call(lastRejectedCandidate, id) &&
        rejection.candidate === lastRejectedCandidate[id]
      ) {
        reasons.push(responseReason(
          "repeated_rejected_answer",
          "이전 품질 거부 응답을 그대로 반복함 — 다른 자연스러운 한국어로 다시 번역할 것",
        ));
      }
      rejectionReasons[id] = reasons;
      if (rejection.candidate != null) lastRejectedCandidate[id] = rejection.candidate;
    }
    return Object.keys(rejected).length;
  };

  const runBatches = async (batchList) => {
    progress.addTotal(batchList.length);
    await Promise.all(
      batchList.map((batch) =>
        gate(
          () => resourceLimits.runApi(async () => {
            if (signal?.aborted) return;
            try {
              const { map, usage } = await translateBatch(caller, batch, signal, {
                rejectionReasons,
              });
              const rejectedCount = mergeValidatedResult(batch, map, usage);
              if (rejectedCount && verbose) {
                onProgress(`⚠ 응답 품질 검증에서 ${rejectedCount}개 문단 거부 — 해당 문단만 다시 번역합니다.`);
              }
            } catch (e) {
              // An API/parse failure and a rejected answer both remain absent from translations;
              // the same bounded targeted retry schedule handles them without accepting partials.
              if (!signal?.aborted) {
                onProgress("⚠ 묶음 실패 — 누락/품질 미통과 문단 재시도에서 다시 시도");
              }
            }
            progress.tick();
          }, { signal }),
          { signal },
        ),
      ),
    );
    if (signal?.aborted) throw new Error("작업이 중단되었습니다.");
  };

  if (verbose && (reuse.koreanCount || reuse.duplicateCount)) {
    onProgress(
      `♻️ 모델 호출 절약 — 기존 한국어 ${reuse.koreanCount}개, 동일 반복 구간 ${reuse.duplicateCount}개 재사용`,
    );
  }

  await runBatches(buildBatches(modelBlocks, batchChars));

  let pendingBlocks = modelBlocks.filter(
    (block) => !translations[String(block.id)],
  );
  for (const size of Array.from(retrySizes || [])) {
    if (!pendingBlocks.length) break;
    if (verbose) onProgress(`🔁 누락/품질 미통과 ${pendingBlocks.length}개 문단 재번역 시도...`);
    await runBatches(buildBatches(pendingBlocks, size));
    pendingBlocks = modelBlocks.filter(
      (block) => !translations[String(block.id)],
    );
  }

  // 정식 번역·품질 검증을 통과한 canonical 결과만 반복 ID에 복제한다. canonical이
  // 실패했다면 alias도 비워 둬 아래 completeness gate가 문서 전체를 fail-closed한다.
  for (const [canonicalId, aliasIds] of reuse.aliases.entries()) {
    const translated = translations[canonicalId];
    if (typeof translated !== "string" || !translated.trim()) continue;
    for (const aliasId of aliasIds) translations[aliasId] = translated;
  }

  // Invalid responses were never merged, so exhausting retries turns them into deterministic
  // missing IDs and reuses the shared fail-closed contract instead of rendering source prose.
  assertCompleteTranslations(sourceBlocks, translations, { context });
  return {
    translations,
    usage: usageSum,
    rejectionReasons,
    reuse: {
      korean: reuse.koreanCount,
      duplicates: reuse.duplicateCount,
      modelBlocks: modelBlocks.length,
    },
  };
}

// 단일 PDF(또는 한 페이지 구간)를 한국어로 통번역한다. caller·gate·progress 를 외부에서
// 주입받아 여러 구간이 동시성·진행률을 공유하게 한다. cost 가 아닌 usage 를 돌려주어
// 호출부가 구간별 usage 를 합산한 뒤 한 번에 비용을 계산한다.
async function translateSinglePdf(options = {}) {
  const resourceLimits =
    options.resourceLimits || getProcessWidePdfTranslateResourceLimits();
  return resourceLimits.runDocument(
    () => translateSinglePdfWithinDocumentPermit({
      ...options,
      resourceLimits,
    }),
    { signal: options.signal },
  );
}

async function translateSinglePdfWithinDocumentPermit({
  pdfBuffer,
  caller,
  gate,
  progress,
  onProgress = () => {},
  signal,
  verbose = true,
  allowBlankPassThrough = false,
  resourceLimits,
  pdfTool = tool,
}) {
  const base = path.join(
    os.tmpdir(),
    `pdftr-${crypto.randomBytes(8).toString("hex")}`,
  );
  const inPath = `${base}.pdf`;
  const outPath = `${base}.ko.pdf`;
  fs.writeFileSync(inPath, pdfBuffer);

  try {
    const {
      page_count,
      scanned,
      truly_blank: trulyBlank,
      blocks,
      page_block_count,
      fig_regions,
      fitz,
    } = await pdfTool.extractBlocks(inPath, { signal });
    // 진단: 그림 영역 감지 여부 + PDF 엔진 버전(로컬과 동작 비교용). 분할 구간에선 생략.
    if (verbose) {
      onProgress(
        `🔍 그림 영역 ${fig_regions ?? "?"}개 감지 · PDF엔진 ${fitz ?? "?"}`,
      );
    }

    const pageBlockCount = Number.isInteger(page_block_count)
      ? page_block_count
      : blocks.filter((block) => !["outline", "metadata"].includes(block?.kind)).length;
    if (!pageBlockCount) {
      // A split chunk may consist only of genuinely blank separator pages.  It is
      // safe to carry that chunk through unchanged, but never use the coarse
      // low-text/scanned hint for this decision: raster/vector content still needs
      // OCR or an explicit fail-closed route.
      if (allowBlankPassThrough && trulyBlank === true && !blocks.length) {
        return {
          buffer: Buffer.from(pdfBuffer),
          usage: emptyUsage(),
          pageCount: page_count,
          scanned: false,
          blockCount: 0,
          missing: 0,
          stats: emptyRenderStats(),
        };
      }
      // A truly blank page may still have reader-visible outline/metadata virtual
      // blocks in the non-split path.  Translate those instead of misclassifying
      // the document as a scanned page.
      if (scanned && trulyBlank !== true) {
        throw new Error(
          "추출 가능한 텍스트가 없습니다. 스캔본(글자가 이미지인 PDF)으로 보입니다 — 현재 버전은 텍스트 레이어가 있는 PDF만 지원합니다(OCR 미지원).",
        );
      }
      if (!blocks.length) throw new Error("번역할 텍스트를 찾지 못했습니다.");
    }
    if (scanned && verbose) {
      onProgress(
        "⚠ 텍스트가 매우 적습니다 — 일부가 스캔 이미지일 수 있어 그 부분은 번역되지 않습니다.",
      );
    }
    if (verbose) onProgress(`✓ ${page_count}쪽, 번역 대상 ${blocks.length}개 구간`);

    const { translations, usage: usageSum } = await translateBlocksWithRetries({
      blocks,
      caller,
      gate,
      progress,
      onProgress,
      signal,
      verbose,
      context: "PDF 빠른 번역",
      resourceLimits,
    });
    const missing = 0;

    if (verbose) onProgress("🖋 번역문을 원본 레이아웃에 삽입 중...");
    const stats = await pdfTool.renderTranslated(
      inPath,
      outPath,
      FONT_PATH,
      translations,
      { signal },
    );
    assertCompleteRender(stats, blocks.length, {
      context: "PDF 빠른 번역 렌더링",
    });
    const buffer = fs.readFileSync(outPath);
    if (verbose) {
      onProgress(
        `✓ 레이아웃 삽입 완료 (교체 ${stats.replaced}곳${stats.shrunk ? `, 자동 축소 ${stats.shrunk}곳` : ""})`,
      );
    }

    return {
      buffer,
      usage: usageSum,
      pageCount: page_count,
      scanned: !!scanned,
      blockCount: blocks.length,
      missing,
      stats,
    };
  } finally {
    for (const p of [inPath, outPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

// PDF 페이지 수만 빠르게 확인(분할/상한 판단용). 호출부가 이미 알면 이 함수는 건너뛴다.
async function peekPageCount(pdfBuffer, signal) {
  const p = path.join(
    os.tmpdir(),
    `pdfpk-${crypto.randomBytes(6).toString("hex")}.pdf`,
  );
  fs.writeFileSync(p, pdfBuffer);
  try {
    const meta = await tool.analyzePdf(p, { signal });
    return Math.max(0, Number(meta.page_count) || 0);
  } finally {
    try {
      fs.unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
}

const emptyUsage = () => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

const emptyRenderStats = () => ({
  ok: true,
  expected: 0,
  replaced: 0,
  drawn: 0,
  page_expected: 0,
  page_drawn: 0,
  font_expected: 0,
  virtual_replaced: 0,
  outline_expected: 0,
  outline_replaced: 0,
  metadata_expected: 0,
  metadata_replaced: 0,
  shrunk: 0,
  overflow: 0,
  failed: 0,
  overflow_ids: [],
  failed_ids: [],
  min_font: null,
  min_glyph_font: null,
  font_sizes: [],
});

function validateSplitPartManifest({ chunks, partManifest, pageCount, dir }) {
  if (!Array.isArray(chunks) || !partManifest || typeof partManifest !== "object") {
    throw new Error("PDF 분할 provenance manifest가 없습니다.");
  }
  if (partManifest.version !== 1 || !/^[0-9a-f]{32}$/.test(String(partManifest.document_token || ""))) {
    throw new Error("PDF 분할 provenance manifest가 손상되었습니다.");
  }
  if (!Array.isArray(partManifest.chunks) || partManifest.chunks.length !== chunks.length) {
    throw new Error("PDF 분할 provenance 구간 수가 일치하지 않습니다.");
  }
  const root = `${path.resolve(dir)}${path.sep}`;
  const tokens = new Set();
  let expectedStart = 1;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const manifestChunk = partManifest.chunks[index];
    const start = Number(chunk?.start);
    const end = Number(chunk?.end);
    const manifestStart = Number(manifestChunk?.start);
    const manifestEnd = Number(manifestChunk?.end);
    const chunkTokens = Array.isArray(chunk?.page_tokens) ? chunk.page_tokens.map(String) : null;
    const manifestTokens = Array.isArray(manifestChunk?.page_tokens)
      ? manifestChunk.page_tokens.map(String)
      : null;
    const resolvedPath = path.resolve(String(chunk?.path || ""));
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start !== expectedStart ||
      end < start ||
      start !== manifestStart ||
      end !== manifestEnd ||
      !resolvedPath.startsWith(root) ||
      !chunkTokens ||
      !manifestTokens ||
      chunkTokens.length !== end - start + 1 ||
      manifestTokens.length !== chunkTokens.length ||
      chunkTokens.some((token, tokenIndex) => token !== manifestTokens[tokenIndex])
    ) {
      throw new Error("PDF 분할 provenance 구간 정보가 손상되었습니다.");
    }
    for (const token of chunkTokens) {
      if (!/^[0-9a-f]{32}$/.test(token) || tokens.has(token)) {
        throw new Error("PDF 분할 provenance page token이 손상되었거나 중복되었습니다.");
      }
      tokens.add(token);
    }
    expectedStart = end + 1;
  }
  if (expectedStart !== Number(pageCount) + 1) {
    throw new Error("PDF 분할 provenance가 전체 페이지를 연속해서 덮지 않습니다.");
  }
  return partManifest;
}

// 대용량 PDF: 페이지 구간(기본 50쪽)으로 나눠 병렬 번역한 뒤 원래 순서로 합친다.
// API 동시 호출 수는 이 문서 내부 gate와 프로세스 전역 gate를 함께 적용하고, 구간 수도
// 문서 내부 CHUNK_CONCURRENCY와 프로세스 전역 document gate를 함께 적용한다.
async function translateLargePdf({
  pdfBuffer,
  caller,
  model,
  pageCount,
  onProgress = () => {},
  signal,
  resourceLimits = getProcessWidePdfTranslateResourceLimits(),
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdftr-chunks-"));
  const inPath = path.join(dir, "in.pdf");
  const outPath = path.join(dir, "merged.ko.pdf");
  fs.writeFileSync(inPath, pdfBuffer);

  // 내부 abort 컨트롤러: 한 구간이라도 (중단이 아닌) 실패로 죽으면 형제 구간·대기 묶음의
  // API 호출을 즉시 끊어 낭비를 막는다. 외부 signal(사용자/타임아웃 중단)에도 연동한다.
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const isAborted = () => ctrl.signal.aborted;

  try {
    const {
      page_count: splitPageCount,
      chunks = [],
      virtual_blocks: rawVirtualBlocks = [],
      part_manifest: rawPartManifest = null,
    } = await resourceLimits.runDocument(
      () => tool.splitPdf(inPath, dir, {
        pagesPerChunk: CHUNK_PAGES,
        signal: ctrl.signal,
      }),
      { signal: ctrl.signal },
    );
    if (Number(splitPageCount) !== Number(pageCount)) {
      throw new Error(
        `PDF 분할 페이지 수가 원본과 다릅니다 (${splitPageCount}/${pageCount}).`,
      );
    }
    const partManifest = validateSplitPartManifest({
      chunks,
      partManifest: rawPartManifest,
      pageCount,
      dir,
    });
    const virtualBlocks = Array.isArray(rawVirtualBlocks) ? rawVirtualBlocks : [];
    const virtualIds = new Set();
    for (const block of virtualBlocks) {
      const id = String(block?.id ?? "");
      if (
        !id ||
        !["outline", "metadata"].includes(block?.kind) ||
        virtualIds.has(id)
      ) {
        throw new Error("PDF 분할 문서 구조 블록이 손상되었거나 중복되었습니다.");
      }
      virtualIds.add(id);
    }
    // 분할이 1구간 이하면 의미 없음 → 단일 처리.
    if (chunks.length <= 1) {
      const gate = makeGate(CONCURRENCY);
      const progress = makeBatchProgress(onProgress);
      const r = await translateSinglePdf({
        pdfBuffer,
        caller,
        gate,
        progress,
        onProgress,
        signal: ctrl.signal,
        resourceLimits,
      });
      return { ...r, cost: calcCost({ usage: r.usage, model }) };
    }

    onProgress(
      `📚 ${pageCount}쪽이 많아 ${CHUNK_PAGES}쪽씩 ${chunks.length}개 구간으로 나눠 병렬 번역합니다.`,
    );

    const gate = makeGate(CONCURRENCY); // API 동시성: 전체 구간이 공유하는 상한
    const chunkGate = makeGate(CHUNK_CONCURRENCY); // 동시에 처리할 구간 수
    const progress = makeBatchProgress(onProgress);

    // 목차 제목과 title/subject/keywords는 전체 문서에 한 번만 존재한다.
    // chunk마다 번역하면 중복 청구뿐 아니라 제목이 서로 다르게 번역될 수 있으므로,
    // page 병렬 작업과 같이 실행하되 독립된 단일 translation map으로 유지한다.
    let firstFailure = null;
    const abortForFailure = (error) => {
      if (!ctrl.signal.aborted && !firstFailure) firstFailure = error;
      ctrl.abort();
    };
    const structurePromise = (
      virtualBlocks.length
        ? translateBlocksWithRetries({
            blocks: virtualBlocks,
            caller,
            gate,
            progress,
            onProgress,
            signal: ctrl.signal,
            verbose: false,
            context: "PDF 대용량 문서 목차/문서정보 번역",
            resourceLimits,
          })
        : Promise.resolve({ translations: {}, usage: emptyUsage() })
    ).catch((error) => {
      abortForFailure(error);
      throw error;
    });

    let chunksDone = 0;
    const pagePromises = chunks.map((c, i) =>
        chunkGate(async () => {
          if (isAborted()) throw new Error("작업이 중단되었습니다.");
          try {
            const buf = fs.readFileSync(c.path);
            const r = await translateSinglePdf({
              pdfBuffer: buf,
              caller,
              gate,
              progress,
              onProgress,
              signal: ctrl.signal,
              verbose: false,
              allowBlankPassThrough: true,
              resourceLimits,
            });
            const partPath = path.join(dir, `part-${i}.ko.pdf`);
            fs.writeFileSync(partPath, r.buffer); // 디스크에 쓰고 버퍼는 즉시 해제
            chunksDone += 1;
            onProgress(
              `✅ 구간 ${chunksDone}/${chunks.length} 완료 (${c.start}–${c.end}쪽)`,
            );
            return {
              i,
              partPath,
              usage: r.usage,
              blockCount: r.blockCount,
              missing: r.missing,
              stats: r.stats,
            };
          } catch (e) {
            // 첫 실패 시 형제 구간·대기 묶음을 즉시 끊는다(이미 망한 작업에 청구 방지).
            abortForFailure(e);
            throw e;
          }
        }, { signal: ctrl.signal }),
    );
    // Promise.all rejects on the first error and would let a slow sibling keep an
    // API/document permit after this function returned.  Abort immediately, then
    // drain every child before cleanup or error delivery.
    const settled = await Promise.allSettled([...pagePromises, structurePromise]);
    const rejected = settled.filter((item) => item.status === "rejected");
    if (rejected.length) {
      throw firstFailure || rejected[0].reason;
    }
    const results = settled.slice(0, pagePromises.length).map((item) => item.value);
    const structureResult = settled[settled.length - 1].value;

    if (isAborted()) throw new Error("작업이 중단되었습니다.");

    // 구간들을 원래 페이지 순서대로 합친다(Promise.all 은 순서 보존이지만 명시적으로 정렬).
    onProgress(`🧩 ${results.length}개 구간을 하나의 PDF로 합치는 중...`);
    const ordered = results.slice().sort((a, b) => a.i - b.i);
    const mergeStats = await resourceLimits.runDocument(
      () => tool.mergePdf(
        outPath,
        ordered.map((r) => r.partPath),
        {
          signal: ctrl.signal,
          sourcePdf: inPath,
          translations: structureResult.translations,
          partManifest,
        },
      ),
      { signal: ctrl.signal },
    );
    if (
      !mergeStats?.ok ||
      !mergeStats?.structure_restored ||
      Number(mergeStats?.page_count) !== Number(pageCount) ||
      Number(mergeStats?.virtual_replaced) !== virtualBlocks.length
    ) {
      throw new Error(
        "PDF 병합 후 목차/문서정보 복원 검증을 통과하지 못했습니다.",
      );
    }
    const buffer = fs.readFileSync(outPath);

    const usageSum = { ...emptyUsage() };
    usageSum.input_tokens += structureResult.usage?.input_tokens || 0;
    usageSum.output_tokens += structureResult.usage?.output_tokens || 0;
    usageSum.cache_read_input_tokens +=
      structureResult.usage?.cache_read_input_tokens || 0;
    usageSum.cache_creation_input_tokens +=
      structureResult.usage?.cache_creation_input_tokens || 0;
    let blockCount = virtualBlocks.length;
    let missing = 0;
    const stats = {
      ok: true,
      replaced: 0,
      drawn: 0,
      shrunk: 0,
      overflow: 0,
      failed: 0,
      overflow_ids: [],
      failed_ids: [],
      min_font: null,
      min_glyph_font: null,
    };
    for (const r of results) {
      usageSum.input_tokens += r.usage.input_tokens || 0;
      usageSum.output_tokens += r.usage.output_tokens || 0;
      usageSum.cache_read_input_tokens += r.usage.cache_read_input_tokens || 0;
      usageSum.cache_creation_input_tokens +=
        r.usage.cache_creation_input_tokens || 0;
      blockCount += r.blockCount || 0;
      missing += r.missing || 0;
      stats.replaced += r.stats?.replaced || 0;
      stats.drawn += r.stats?.drawn || r.stats?.replaced || 0;
      stats.shrunk += r.stats?.shrunk || 0;
      stats.overflow += r.stats?.overflow || 0;
      stats.failed += r.stats?.failed || 0;
      stats.overflow_ids.push(...(r.stats?.overflow_ids || []));
      stats.failed_ids.push(...(r.stats?.failed_ids || []));
      const partMinFont = Number(r.stats?.min_font);
      if (Number.isFinite(partMinFont) && partMinFont > 0) {
        stats.min_font =
          stats.min_font == null ? partMinFont : Math.min(stats.min_font, partMinFont);
      }
      const partMinGlyphFont = Number(r.stats?.min_glyph_font);
      if (Number.isFinite(partMinGlyphFont) && partMinGlyphFont > 0) {
        stats.min_glyph_font =
          stats.min_glyph_font == null
            ? partMinGlyphFont
            : Math.min(stats.min_glyph_font, partMinGlyphFont);
      }
    }
    stats.replaced += Number(mergeStats.virtual_replaced) || 0;
    stats.drawn += Number(mergeStats.virtual_replaced) || 0;
    stats.virtual_replaced = Number(mergeStats.virtual_replaced) || 0;
    stats.outline_expected = Number(mergeStats.outline_expected) || 0;
    stats.outline_replaced = Number(mergeStats.outline_replaced) || 0;
    stats.metadata_expected = Number(mergeStats.metadata_expected) || 0;
    stats.metadata_replaced = Number(mergeStats.metadata_replaced) || 0;
    stats.structure_restored = true;
    stats.ok = stats.overflow === 0 && stats.failed === 0;

    return {
      buffer,
      cost: calcCost({ usage: usageSum, model }),
      pageCount,
      scanned: false,
      blockCount,
      missing,
      stats,
    };
  } finally {
    if (signal) signal.removeEventListener("abort", onOuterAbort);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * PDF 를 한국어로 통번역한다. 페이지가 많으면(CHUNK_PAGES 초과) 자동으로 구간 분할·병렬
 * 번역·병합한다(예: 150쪽 → 50쪽씩 3구간 병렬 후 하나로 합침).
 * @returns {Promise<{buffer:Buffer, cost:Object, pageCount:number, scanned:boolean,
 *                    blockCount:number, missing:number, stats:Object}>}
 */
async function translatePdf({
  pdfBuffer,
  model = null,
  pageCount = null,
  maxPages = MAX_PAGES,
  onProgress = () => {},
  signal,
  resourceLimits = null,
}) {
  const MODEL = model || DEFAULT_MODEL;
  const caller = makeCaller(MODEL); // 키 누락이면 여기서 즉시 실패(GPT/Claude 자동 분기)
  const limits = resourceLimits || getProcessWidePdfTranslateResourceLimits();

  onProgress(`🤖 번역 모델: ${MODEL}`);
  onProgress("📄 PDF 분석 중 (텍스트 추출)...");

  // 페이지 수 확인(호출부가 알려주면 재분석 생략). 상한/분할 판단에 쓴다.
  const pages =
    Number.isFinite(pageCount) && pageCount > 0
      ? pageCount
      : await limits.runDocument(
          () => peekPageCount(pdfBuffer, signal),
          { signal },
        );

  const pageLimit = Number.isSafeInteger(Number(maxPages)) && Number(maxPages) > 0
    ? Number(maxPages)
    : MAX_PAGES;
  if (pages > pageLimit) {
    throw new Error(
      `페이지가 너무 많습니다 (${pages}쪽 > 상한 ${pageLimit}쪽). 파일을 나눠서 시도하세요.`,
    );
  }

  // 작은 문서는 단일 처리(기존 동작 그대로). 큰 문서만 분할·병렬·병합.
  if (pages <= CHUNK_PAGES) {
    const gate = makeGate(CONCURRENCY);
    const progress = makeBatchProgress(onProgress);
    const r = await translateSinglePdf({
      pdfBuffer,
      caller,
      gate,
      progress,
      onProgress,
      signal,
      resourceLimits: limits,
    });
    return { ...r, cost: calcCost({ usage: r.usage, model: MODEL }) };
  }

  return translateLargePdf({
    pdfBuffer,
    caller,
    model: MODEL,
    pageCount: pages,
    onProgress,
    signal,
    resourceLimits: limits,
  });
}

module.exports = {
  translatePdf,
  translateSinglePdf,
  translateLargePdf,
  makeGate,
  createPdfTranslateResourceLimits,
  getProcessWidePdfTranslateResourceLimits,
  DEFAULT_MODEL,
  MAX_PAGES,
  CHUNK_PAGES,
  makeCaller,
  isGptModel,
  translateBatch,
  translateBlocksWithRetries,
  validateTranslationCandidate,
  validateTranslationMap,
  findUntranslatedEnglishProse,
  extractNumericTokens,
  extractUrls,
  extractScientificMarkup,
  findUnsupportedTargetCodePoints,
  maskAllowedEnglishRegions,
  buildTranslationReusePlan,
};
