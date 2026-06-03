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

const FONT_PATH = path.join(__dirname, "../../fonts/NanumGothic-Regular.ttf");

// 번역 기본 모델: 문서 번역엔 Sonnet 으로 충분하고 빠르다(비용↓). 환경변수로 변경 가능.
const DEFAULT_MODEL = process.env.PDF_TRANSLATE_MODEL || "claude-sonnet-4-6";
// 페이지 상한 — 비용/시간 폭주 방지(관리자 테스트 기본 80쪽).
const MAX_PAGES = parseInt(process.env.PDF_TRANSLATE_MAX_PAGES || "80", 10);
// 한 번의 Claude 요청에 묶을 대략적 글자 수.
const BATCH_CHARS = parseInt(process.env.PDF_TRANSLATE_BATCH_CHARS || "3500", 10);

const SYSTEM_PROMPT = [
  "You are a professional translator specializing in academic and technical/scientific documents",
  "(lab manuals, papers, textbooks). Translate each given text segment into natural, fluent Korean (한국어).",
  "",
  "Rules:",
  "- Translate faithfully. Do NOT summarize, add, drop, or merge content.",
  "- Preserve exactly: numbers, units, math/chemical formulas, variable names, equation symbols, code, URLs, citations,",
  "  and proper nouns that are conventionally left untranslated.",
  "- Use accurate Korean scientific/technical terminology.",
  "- Translate each id independently.",
  "- If a segment is already Korean, or is only symbols/numbers, return it unchanged.",
  '- Output MUST be a single JSON object and nothing else: {"t": {"<id>": "<korean>", ...}} including every id given.',
].join("\n");

function buildBatches(blocks) {
  const batches = [];
  let cur = [];
  let curChars = 0;
  for (const b of blocks) {
    cur.push(b);
    curChars += (b.text || "").length;
    if (curChars >= BATCH_CHARS) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function translateBatch(client, model, blocks, signal) {
  const items = blocks.map((b) => ({ id: b.id, text: b.text }));
  const userContent =
    "Translate the following segments to Korean. Return only the JSON object described.\n\n" +
    JSON.stringify(items, null, 0);

  const message = await client.messages.create(
    {
      model,
      max_tokens: 8000,
      system: [
        // 정적 시스템 프롬프트 → 5분 ephemeral 캐시로 묶음 간 입력 비용 절감.
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userContent }],
    },
    signal ? { signal } : undefined,
  );

  const text = (message.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let map = {};
  try {
    const parsed = parseJsonLenient(text);
    map = (parsed && parsed.t) || parsed || {};
  } catch {
    map = {};
  }
  return { map: map || {}, usage: message.usage };
}

/**
 * PDF 를 한국어로 통번역한다.
 * @returns {Promise<{buffer:Buffer, cost:Object, pageCount:number, scanned:boolean,
 *                    blockCount:number, missing:number, stats:{replaced:number, shrunk:number}}>}
 */
async function translatePdf({
  pdfBuffer,
  model = null,
  onProgress = () => {},
  signal,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  const MODEL = model || DEFAULT_MODEL;

  const base = path.join(
    os.tmpdir(),
    `pdftr-${crypto.randomBytes(8).toString("hex")}`,
  );
  const inPath = `${base}.pdf`;
  const outPath = `${base}.ko.pdf`;
  fs.writeFileSync(inPath, pdfBuffer);

  try {
    onProgress(`🤖 번역 모델: ${MODEL}`);
    onProgress("📄 PDF 분석 중 (텍스트 추출)...");
    const { page_count, scanned, blocks } = await tool.extractBlocks(inPath, {
      signal,
    });

    if (page_count > MAX_PAGES) {
      throw new Error(
        `페이지가 너무 많습니다 (${page_count}쪽 > 상한 ${MAX_PAGES}쪽). 파일을 나눠서 시도하세요.`,
      );
    }
    if (!blocks.length) {
      if (scanned) {
        throw new Error(
          "추출 가능한 텍스트가 없습니다. 스캔본(글자가 이미지인 PDF)으로 보입니다 — 현재 버전은 텍스트 레이어가 있는 PDF만 지원합니다(OCR 미지원).",
        );
      }
      throw new Error("번역할 텍스트를 찾지 못했습니다.");
    }
    if (scanned) {
      onProgress(
        "⚠ 텍스트가 매우 적습니다 — 일부가 스캔 이미지일 수 있어 그 부분은 번역되지 않습니다.",
      );
    }
    onProgress(`✓ ${page_count}쪽, 번역 대상 ${blocks.length}개 문단`);

    const batches = buildBatches(blocks);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const translations = {};
    const usageSum = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    for (let i = 0; i < batches.length; i++) {
      if (signal?.aborted) throw new Error("작업이 중단되었습니다.");
      onProgress(`🌐 번역 중... (${i + 1}/${batches.length} 묶음)`);
      const { map, usage } = await translateBatch(
        client,
        MODEL,
        batches[i],
        signal,
      );
      for (const [k, v] of Object.entries(map)) {
        if (typeof v === "string" && v.trim()) translations[String(k)] = v;
      }
      if (usage) {
        usageSum.input_tokens += usage.input_tokens || 0;
        usageSum.output_tokens += usage.output_tokens || 0;
        usageSum.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
        usageSum.cache_creation_input_tokens +=
          usage.cache_creation_input_tokens || 0;
      }
    }

    if (Object.keys(translations).length === 0) {
      throw new Error(
        "번역 결과를 받지 못했습니다(모델 응답 파싱 실패). 잠시 후 다시 시도하세요.",
      );
    }

    const missing = blocks.filter(
      (b) => !translations[String(b.id)],
    ).length;
    if (missing) {
      onProgress(
        `⚠ ${missing}개 문단은 번역 결과를 받지 못해 원문 유지`,
      );
    }

    onProgress("🖋 번역문을 원본 레이아웃에 삽입 중...");
    const stats = await tool.renderTranslated(
      inPath,
      outPath,
      FONT_PATH,
      translations,
      { signal },
    );
    const buffer = fs.readFileSync(outPath);
    onProgress(
      `✓ 레이아웃 삽입 완료 (교체 ${stats.replaced}곳${stats.shrunk ? `, 자동 축소 ${stats.shrunk}곳` : ""})`,
    );

    const cost = calcCost({ usage: usageSum, model: MODEL });

    return {
      buffer,
      cost,
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

module.exports = { translatePdf, DEFAULT_MODEL, MAX_PAGES };
