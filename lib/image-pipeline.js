// Image acquisition pipeline: Google Image Search first, Nano Banana fallback.
//
// fetchOrGenerate(figure, opts) -> { buffer, contentType, source, sourceUrl?, displayLink? } | null
//
//   source: "search" | "nano-banana"
//
// Returns null if both fail (caller falls back to placeholder).

const { searchImage } = require("./image-search");
const { generateImage } = require("./nano-banana");

const SEARCH_AVAILABLE = () =>
  !!(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);
const GEN_AVAILABLE = () => !!process.env.GEMINI_API_KEY;

async function fetchOrGenerate(figure, { onProgress = () => {}, signal } = {}) {
  const tag = `[그림 ${figure.number}]`;
  // ── 1) Google image search (if configured) ─────────────────────────────
  if (SEARCH_AVAILABLE()) {
    const query =
      figure.search_query ||
      figure.caption ||
      figure.description ||
      "";
    if (query.trim()) {
      onProgress(`🔎 ${tag} 이미지 검색 중: "${truncate(query, 40)}"`);
      try {
        const result = await searchImage(query, { onProgress });
        if (result) {
          onProgress(`✓ ${tag} 검색 결과 사용 (${result.displayLink})`);
          return {
            buffer: result.buffer,
            contentType: result.contentType,
            source: "search",
            sourceUrl: result.sourceUrl,
            displayLink: result.displayLink,
          };
        } else {
          onProgress(`· ${tag} 검색 결과 없음, AI 생성으로 대체`);
        }
      } catch (e) {
        onProgress(`⚠ ${tag} 검색 오류: ${e.message}`);
      }
    }
  }

  // ── 2) Nano Banana generation ─────────────────────────────────────────
  if (GEN_AVAILABLE()) {
    const prompt = buildImagePrompt(figure);
    onProgress(`🎨 ${tag} Google AI Studio로 생성 중...`);
    try {
      const result = await generateImage(prompt, { signal });
      onProgress(`✓ ${tag} AI 생성 완료`);
      return {
        buffer: result.buffer,
        contentType: result.contentType,
        source: "nano-banana",
      };
    } catch (e) {
      onProgress(`⚠ ${tag} AI 생성 실패: ${e.message}`);
    }
  } else if (!SEARCH_AVAILABLE()) {
    // 둘 다 미설정
    onProgress(
      `· ${tag} 이미지 검색·생성 키 미설정 — placeholder 유지`,
    );
  }

  return null;
}

function buildImagePrompt(figure) {
  const caption = figure.caption || "";
  const description = figure.description || "";
  // Make the prompt strong for chemistry diagrams: educational, clean, white BG
  return [
    `Educational chemistry illustration: ${caption}.`,
    description,
    "Style: clean, simple, scientific diagram with white background, suitable for a high school chemistry lab report. No text labels, no watermark.",
  ]
    .filter(Boolean)
    .join("\n");
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

module.exports = { fetchOrGenerate, SEARCH_AVAILABLE, GEN_AVAILABLE };
