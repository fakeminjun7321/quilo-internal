// 재조판(re-typeset) 번역: PDF 를 Claude 에게 통째로 주고 "한국어 LaTeX 본문"을
// 받아 Tectonic 으로 PDF 를 만든다. in-place(글자 교체)와 달리 문서를 다시 조판하므로
// 수식이 정준형으로 복원되어 깔끔하게 나온다(사용자가 원한 LaTeX판 품질).
const Anthropic = require("@anthropic-ai/sdk");
const { calcCost } = require("../../pricing");
const { buildTex, compileTex } = require("./latex-pdf");

const DEFAULT_MODEL = process.env.PDF_RETYPESET_MODEL || "claude-opus-4-8";
const MAX_TOKENS = parseInt(process.env.PDF_RETYPESET_MAX_TOKENS || "32000", 10);
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const SYSTEM_PROMPT = [
  "You are an expert academic translator AND LaTeX typesetter. You receive a PDF of an academic/technical document (often a physics/chemistry paper or lab manual) and produce a faithful KOREAN re-typeset of it as LaTeX.",
  "",
  "CRITICAL — equations:",
  "- The PDF's extracted text often has CORRUPTED math (Greek letters, primes, roots, subscripts lost or turned into junk). Do NOT copy garbled math. Reconstruct each formula into its mathematically-correct canonical form and typeset it in proper LaTeX. You know the standard form of well-known equations — restore them faithfully.",
  "- Use \\[ ... \\] for display equations and $...$ for inline math. amsmath/amssymb are available.",
  "",
  "Translation:",
  "- Translate ALL prose into natural, fluent academic Korean (학술 문어체). Keep numbers, units, variable names, and proper nouns accurate.",
  "- Preserve the document's structure: use \\section*{...} / \\subsection*{...} for headings, normal paragraphs for body. Footnotes via \\footnote{...}.",
  "- Translate the whole document, in order. Do not summarize or drop content.",
  "",
  "Output format — IMPORTANT:",
  "- Output ONE ```latex code block and nothing else.",
  "- The FIRST three lines must be metadata comments:",
  "    % TITLE: <Korean title>",
  "    % AUTHOR: <author, may be empty>",
  "    % DATE: <date, may be empty>",
  "- After those, output ONLY the LaTeX BODY (what goes inside \\begin{document}…\\end{document}). Do NOT include \\documentclass, \\usepackage, the preamble, \\begin{document}, \\end{document}, \\title, \\author, \\date, or \\maketitle — those are added automatically.",
  "- Use only packages already loaded: amsmath, amssymb, graphicx. Do not \\usepackage anything. Avoid figures/images (omit them or describe in text).",
].join("\n");

function parseLatexOutput(text) {
  // ```latex ... ``` 코드블록 추출(없으면 전체)
  const m = text.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  let block = (m ? m[1] : text).trim();
  const meta = { title: "", author: "", date: "" };
  const lines = block.split("\n");
  const rest = [];
  for (const line of lines) {
    const mt = line.match(/^\s*%\s*(TITLE|AUTHOR|DATE)\s*:\s*(.*)$/i);
    if (mt && !rest.length) {
      meta[mt[1].toLowerCase()] = mt[2].trim();
    } else {
      rest.push(line);
    }
  }
  return { ...meta, body: rest.join("\n").trim() };
}

/**
 * PDF → 재조판 한국어 PDF(Buffer).
 * @returns {Promise<{buffer:Buffer, cost:Object, model:string}>}
 */
async function retypesetPdf({
  pdfBuffer,
  imageBlocks = null,
  model = null,
  onProgress = () => {},
  signal,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  const useImages = Array.isArray(imageBlocks) && imageBlocks.length > 0;
  if (!useImages && pdfBuffer.length > MAX_PDF_BYTES) {
    throw new Error("PDF 가 너무 큽니다(25MB 초과).");
  }
  const MODEL = model || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  onProgress(`🤖 재조판 번역 모델: ${MODEL}`);
  onProgress(
    useImages
      ? `🔎 스캔본 OCR: 고해상도 페이지 이미지 ${imageBlocks.length}장을 읽는 중...`
      : "📖 문서를 읽고 한국어로 재조판(수식 복원) 중...",
  );

  // 입력 콘텐츠: 스캔/이미지 PDF 는 잘라낸 페이지 이미지들, 일반 PDF 는 문서 블록.
  const userContent = useImages
    ? [
        ...imageBlocks,
        {
          type: "text",
          text: "위 이미지들은 한 문서를 위에서 아래 순서로 자른 페이지 조각입니다(경계가 약간 겹칠 수 있음 — 중복 문장은 한 번만). 전체를 하나의 문서로 보고, 모든 본문을 자연스러운 한국어 학술 문어체로 번역하고 수식을 정준형 LaTeX 로 복원해 재조판하세요. 그림·도식은 본문 흐름에 맞춰 '[그림: 한 줄 설명]' 형태로 표시하세요. 위 출력 형식을 정확히 지키세요.",
        },
      ]
    : [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfBuffer.toString("base64"),
          },
        },
        {
          type: "text",
          text: "이 PDF 문서를 한국어로 충실히 번역하고, 수식을 정준형으로 복원해 LaTeX 본문으로 재조판하세요. 위 출력 형식을 정확히 지키세요.",
        },
      ];

  const message = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    },
    signal ? { signal } : undefined,
  );

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "문서가 너무 길어 LaTeX 출력이 잘렸습니다. 더 짧은 PDF로 나눠 시도하세요.",
    );
  }

  const text = (message.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const { title, author, date, body } = parseLatexOutput(text);
  if (!body || body.length < 20) {
    throw new Error("재조판 LaTeX 본문을 받지 못했습니다.");
  }

  onProgress("📐 LaTeX → PDF 컴파일 중...");
  const tex = buildTex({ body, title, author, date });
  let buffer;
  try {
    buffer = await compileTex(tex, { signal, onProgress });
  } catch (e) {
    // 컴파일 실패 시 원인 + LaTeX 일부를 로그로 남긴다(디버깅용).
    console.error("[retypeset] tectonic compile failed:", e.message);
    throw new Error(`재조판 PDF 생성 실패: ${e.message}`);
  }

  const cost = calcCost({ usage: message.usage, model: MODEL });
  onProgress(`✓ 재조판 완료 (${Math.round(buffer.length / 1024)}KB)`);
  return { buffer, cost, model: MODEL };
}

module.exports = { retypesetPdf, parseLatexOutput, DEFAULT_MODEL };
