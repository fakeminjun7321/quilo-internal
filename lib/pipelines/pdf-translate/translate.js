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

// 본문 글꼴: Pretendard(고가독성) 있으면 우선, 없으면 NanumGothic.
const FONT_DIR = path.join(__dirname, "../../fonts");
const FONT_PATH = fs.existsSync(path.join(FONT_DIR, "Pretendard-Regular.ttf"))
  ? path.join(FONT_DIR, "Pretendard-Regular.ttf")
  : path.join(FONT_DIR, "NanumGothic-Regular.ttf");

// 번역 기본 모델: 문서 번역엔 Sonnet 으로 충분하고 빠르다(비용↓). 환경변수로 변경 가능.
const DEFAULT_MODEL = process.env.PDF_TRANSLATE_MODEL || "claude-sonnet-4-6";
// 페이지 절대 상한 — 비용/시간 폭주 방지. 이 이내면 자동 분할·병렬·병합으로 처리한다
// (예: 150쪽 → 50쪽씩 3구간). env 로 조절.
const MAX_PAGES = parseInt(process.env.PDF_TRANSLATE_MAX_PAGES || "300", 10);
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
const BATCH_CHARS = parseInt(process.env.PDF_TRANSLATE_BATCH_CHARS || "4500", 10);
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
  "- For technical / domain-specific terms and named methods, write the Korean translation followed by the original English term in parentheses on first occurrence, e.g. 어텐션(attention), 잔차 연결(residual connection), 계층 정규화(layer normalization). Do this consistently for non-obvious terms. Keep well-known acronyms (BLEU, GPU, RNN, CNN) and proper nouns (제품·논문·사람 이름) as-is.",
  "- EXCEPTION: in short segments that are clearly a heading, section title, or table column header / cell (few words, no full sentence), do NOT add the parenthetical English gloss — give only the concise Korean so it fits the layout.",
  "- Keep the translation concise; do not pad. Avoid adding words that are not in the source.",
  "- Output literal characters directly (<, >, &, ≤, ≥, /). NEVER use HTML entities such as &gt; &lt; &amp; in the output.",
  "- Translate each id independently.",
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

async function translateBatch(caller, blocks, signal) {
  const items = blocks.map((b) => ({ id: b.id, text: b.text }));
  const user =
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

// 동시성 게이트(공유 세마포어). 여러 구간을 병렬 번역해도 전체 API 동시 호출 수가
// 한도를 넘지 않도록 한 곳에서 상한을 건다(레이트리밋 폭주 방지).
function makeGate(max) {
  const cap = Math.max(1, max | 0);
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < cap && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
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

// 단일 PDF(또는 한 페이지 구간)를 한국어로 통번역한다. caller·gate·progress 를 외부에서
// 주입받아 여러 구간이 동시성·진행률을 공유하게 한다. cost 가 아닌 usage 를 돌려주어
// 호출부가 구간별 usage 를 합산한 뒤 한 번에 비용을 계산한다.
async function translateSinglePdf({
  pdfBuffer,
  caller,
  gate,
  progress,
  onProgress = () => {},
  signal,
  verbose = true,
}) {
  const base = path.join(
    os.tmpdir(),
    `pdftr-${crypto.randomBytes(8).toString("hex")}`,
  );
  const inPath = `${base}.pdf`;
  const outPath = `${base}.ko.pdf`;
  fs.writeFileSync(inPath, pdfBuffer);

  try {
    const { page_count, scanned, blocks, fig_regions, fitz } =
      await tool.extractBlocks(inPath, { signal });
    // 진단: 그림 영역 감지 여부 + PDF 엔진 버전(로컬과 동작 비교용). 분할 구간에선 생략.
    if (verbose) {
      onProgress(
        `🔍 그림 영역 ${fig_regions ?? "?"}개 감지 · PDF엔진 ${fitz ?? "?"}`,
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
    if (scanned && verbose) {
      onProgress(
        "⚠ 텍스트가 매우 적습니다 — 일부가 스캔 이미지일 수 있어 그 부분은 번역되지 않습니다.",
      );
    }
    if (verbose) onProgress(`✓ ${page_count}쪽, 번역 대상 ${blocks.length}개 문단`);

    const batches = buildBatches(blocks);
    const translations = {};
    const usageSum = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const mergeResult = (map, usage) => {
      for (const [k, v] of Object.entries(map || {})) {
        if (typeof v === "string" && v.trim()) translations[String(k)] = v;
      }
      if (usage) {
        usageSum.input_tokens += usage.input_tokens || 0;
        usageSum.output_tokens += usage.output_tokens || 0;
        usageSum.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
        usageSum.cache_creation_input_tokens +=
          usage.cache_creation_input_tokens || 0;
      }
    };

    // 모든 묶음을 gate(공유 세마포어)에 넣어 동시에 번역한다. 동시 실행 수는 gate 가
    // 상한을 건다 — 단일 PDF 면 CONCURRENCY, 분할 PDF 면 전체 구간이 CONCURRENCY 를 공유.
    const runBatches = async (batchList) => {
      progress.addTotal(batchList.length);
      await Promise.all(
        batchList.map((batch) =>
          gate(async () => {
            if (signal?.aborted) return; // 바깥에서 최종적으로 throw
            try {
              const { map, usage } = await translateBatch(caller, batch, signal);
              mergeResult(map, usage);
            } catch (e) {
              // 중단은 조용히 빠지고(아래에서 throw), 그 외 일시 오류는 누락 재시도가 잡는다
              // (다른 묶음이 계속 돌아 청구·진행이 멈추지 않게).
              if (!signal?.aborted) {
                onProgress("⚠ 묶음 실패 — 누락분 재시도에서 다시 시도");
              }
            }
            progress.tick();
          }),
        ),
      );
      if (signal?.aborted) throw new Error("작업이 중단되었습니다.");
    };

    await runBatches(batches);

    // 누락 문단 재시도 — 점점 작은 묶음으로 여러 번(파싱 실패가 묶음 전체를 날리지
    // 않도록), 마지막엔 문단당 1개씩. 결과물에 원문(영어)이 남지 않도록.
    let missingBlocks = blocks.filter((b) => !translations[String(b.id)]);
    for (const size of [1500, 600, 1, 1, 1]) {
      if (!missingBlocks.length) break;
      if (verbose) onProgress(`🔁 누락 ${missingBlocks.length}개 문단 재번역 시도...`);
      await runBatches(buildBatches(missingBlocks, size));
      missingBlocks = blocks.filter((b) => !translations[String(b.id)]);
    }

    if (Object.keys(translations).length === 0) {
      throw new Error(
        "번역 결과를 받지 못했습니다(모델 응답 파싱 실패). 잠시 후 다시 시도하세요.",
      );
    }

    const missing = missingBlocks.length;
    if (missing && verbose) {
      onProgress(`⚠ ${missing}개 문단은 번역 실패로 원문 유지`);
    }

    if (verbose) onProgress("🖋 번역문을 원본 레이아웃에 삽입 중...");
    const stats = await tool.renderTranslated(
      inPath,
      outPath,
      FONT_PATH,
      translations,
      { signal },
    );
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

// 대용량 PDF: 페이지 구간(기본 50쪽)으로 나눠 병렬 번역한 뒤 원래 순서로 합친다.
// API 동시 호출 수는 gate 로 전체에서 CONCURRENCY 공유(레이트리밋 방지), 동시에 처리하는
// 구간 수는 CHUNK_CONCURRENCY 로 제한(python 프로세스·메모리 보호).
async function translateLargePdf({
  pdfBuffer,
  caller,
  model,
  pageCount,
  onProgress = () => {},
  signal,
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
    const { chunks = [] } = await tool.splitPdf(inPath, dir, {
      pagesPerChunk: CHUNK_PAGES,
      signal: ctrl.signal,
    });
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
      });
      return { ...r, cost: calcCost({ usage: r.usage, model }) };
    }

    onProgress(
      `📚 ${pageCount}쪽이 많아 ${CHUNK_PAGES}쪽씩 ${chunks.length}개 구간으로 나눠 병렬 번역합니다.`,
    );

    const gate = makeGate(CONCURRENCY); // API 동시성: 전체 구간이 공유하는 상한
    const chunkGate = makeGate(CHUNK_CONCURRENCY); // 동시에 처리할 구간 수
    const progress = makeBatchProgress(onProgress);

    let chunksDone = 0;
    const results = await Promise.all(
      chunks.map((c, i) =>
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
            ctrl.abort();
            throw e;
          }
        }),
      ),
    );

    if (isAborted()) throw new Error("작업이 중단되었습니다.");

    // 구간들을 원래 페이지 순서대로 합친다(Promise.all 은 순서 보존이지만 명시적으로 정렬).
    onProgress(`🧩 ${results.length}개 구간을 하나의 PDF로 합치는 중...`);
    const ordered = results.slice().sort((a, b) => a.i - b.i);
    await tool.mergePdf(
      outPath,
      ordered.map((r) => r.partPath),
      { signal: ctrl.signal },
    );
    const buffer = fs.readFileSync(outPath);

    const usageSum = emptyUsage();
    let blockCount = 0;
    let missing = 0;
    const stats = { replaced: 0, shrunk: 0 };
    for (const r of results) {
      usageSum.input_tokens += r.usage.input_tokens || 0;
      usageSum.output_tokens += r.usage.output_tokens || 0;
      usageSum.cache_read_input_tokens += r.usage.cache_read_input_tokens || 0;
      usageSum.cache_creation_input_tokens +=
        r.usage.cache_creation_input_tokens || 0;
      blockCount += r.blockCount || 0;
      missing += r.missing || 0;
      stats.replaced += r.stats?.replaced || 0;
      stats.shrunk += r.stats?.shrunk || 0;
    }

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
 *                    blockCount:number, missing:number, stats:{replaced:number, shrunk:number}}>}
 */
async function translatePdf({
  pdfBuffer,
  model = null,
  pageCount = null,
  onProgress = () => {},
  signal,
}) {
  const MODEL = model || DEFAULT_MODEL;
  const caller = makeCaller(MODEL); // 키 누락이면 여기서 즉시 실패(GPT/Claude 자동 분기)

  onProgress(`🤖 번역 모델: ${MODEL}`);
  onProgress("📄 PDF 분석 중 (텍스트 추출)...");

  // 페이지 수 확인(호출부가 알려주면 재분석 생략). 상한/분할 판단에 쓴다.
  const pages =
    Number.isFinite(pageCount) && pageCount > 0
      ? pageCount
      : await peekPageCount(pdfBuffer, signal);

  if (pages > MAX_PAGES) {
    throw new Error(
      `페이지가 너무 많습니다 (${pages}쪽 > 상한 ${MAX_PAGES}쪽). 파일을 나눠서 시도하세요.`,
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
  });
}

module.exports = {
  translatePdf,
  translateSinglePdf,
  translateLargePdf,
  DEFAULT_MODEL,
  MAX_PAGES,
  CHUNK_PAGES,
  makeCaller,
  isGptModel,
  translateBatch,
};
