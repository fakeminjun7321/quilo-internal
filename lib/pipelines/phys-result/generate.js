const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const {
  calcCost,
  calcImageCost,
  formatCostLine,
} = require("../../pricing");
const { parseJsonLenient } = require("../../json-sanitize");
const { renderChart } = require("../chem-result/chart-gen");
const { parseCap, summarizeForPrompt } = require("./cap-parser");
const { parseToMarkdown } = require("../../excel-parser");

// 사용자가 폼에서 모델을 선택. 누락 시 fallback.
const DEFAULT_MODEL = "claude-opus-4-7";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "32000", 10);

const SKILL_PATH = path.join(__dirname, "prompt.md");
// 양식 PDF는 모든 보고서 동일 — 코드에 내장
const FORM_PDF_PATH = path.join(__dirname, "form.pdf");
let _formPdfBase64 = null;
function loadFormPdfBase64() {
  if (_formPdfBase64) return _formPdfBase64;
  try {
    const buf = fs.readFileSync(FORM_PDF_PATH);
    _formPdfBase64 = buf.toString("base64");
    return _formPdfBase64;
  } catch {
    return null; // form.pdf 없으면 첨부 안 함 (graceful)
  }
}

function loadSkill() {
  return fs.readFileSync(SKILL_PATH, "utf8");
}

function buildUserNotesBlock(userNotes) {
  const notes = String(userNotes || "").trim();
  if (!notes) return "";
  return `=== 사용자 참고 메모 / 실험자 의견 ===
${notes}
=== 메모 끝 ===

이 메모는 학생이 실제로 실험을 수행하면서 남긴 맥락입니다. 업로드 데이터와 명백히 충돌하지 않는 범위에서 반드시 반영하세요.

반영 위치 가이드:
- 측정 절차, 장치 세팅, 반복 측정 방식 → experiment_setup, method_summary, 각 experiments[].analysis
- 제외하거나 버린 데이터의 이유 → 해당 실험 파트의 analysis, conclusion.error_analysis
- 실험 중 발생한 문제와 해결 시도 → conclusion.problem_solving에 구체적으로 서술
- 관찰한 오차 원인 → 과학 이론과 연결하여 conclusion.error_analysis에 서술

메모 문장을 그대로 붙이지 말고, 평가기준의 "실험 결과의 표현 및 해석", "결론 및 오차 분석", "문제 인식 및 해결"에 맞는 보고서 문체로 녹여 쓰세요.`;
}

// 물리 결과보고서는 학교 양식 기본 버전만 지원한다.
const STYLE_INSTRUCTIONS = {
  default: `## 현재 양식

**기본 양식** (학교 양식 + 65점 평가 최적화)

위 스킬 명세의 default 모드 가이드 모두 적용:
- 5페이지 강제 (4.5~5p)
- experiments[] (data_table + chart + analysis) + conclusion{...} 구조
- 65점 평가기준 모두 만점 노림
- 1.1, 1.2 자동 번호 + 분석 텍스트 안에 가./나./(1)/(2)`,
};

function buildSystemPrompt() {
  const skill = loadSkill();
  const styleSection = STYLE_INSTRUCTIONS.default;
  const fivePageWarning = `

⚠️ **반드시 5페이지 이내이지만 4.5~5페이지를 거의 채워야 합니다** (빈 공간 많으면 평가 감점). 학교 평가기준 65점 만점 노림 (3가지 평가 항목 모두 최고점).

⚠️ **번호 매기기**: 1.1 / 1.2 같은 dot 번호는 자동 생성. 분석 텍스트 안에서 더 세부 항목 필요하면 \`가.\`, \`나.\` → \`(1)\`, \`(2)\` 순서로 사용 (analysis 필드 안에 직접 작성).`;

  return `당신은 대구과학고등학교 일반물리학실험 결과보고서 자동 생성 도우미입니다.

서버가 입력 데이터(.cap 파일 또는 엑셀)를 자동 파싱해서 텍스트로 제공합니다. 이 정보와 학생이 업로드한 실험 사진(있으면), 매뉴얼 PDF(있으면)를 바탕으로 보고서를 작성하세요.${fivePageWarning}

=========== SKILL SPEC START ===========
${skill}
=========== SKILL SPEC END ===========

## 작업 절차

1. 첨부 파일 분석 (.cap 파싱 결과 또는 엑셀 markdown table, 매뉴얼 PDF, 사진).
2. 실험 사진이 있으면 vision으로 직접 보고 어느 단계에 적합한지 판단.
3. 기본 양식 JSON 스키마로 작성.
4. JSON 출력.

${styleSection}

## 출력 형식 (매우 중요)

**최종 출력은 반드시 단 하나의 JSON 코드 블록 (\`\`\`json ... \`\`\`)입니다.** 그 외 텍스트 일체 금지.
`;
}

/**
 * Generate physics result report content.
 *
 * 입력 시나리오 (둘 중 하나는 있어야 함):
 *   A) .cap 파일 (PASCO Capstone) — 자동 파싱
 *   B) 엑셀/CSV 데이터 + (선택) 매뉴얼 PDF
 *
 * 양식 PDF·평가기준은 모든 보고서 동일이라 코드에 내장 (사용자 입력 X).
 *
 * @param {Object} args
 * @param {Buffer|null} args.capBuffer       PASCO Capstone .cap (선택)
 * @param {string} args.capName              파일명
 * @param {Buffer|null} args.dataBuffer      엑셀/CSV 데이터 (선택, .cap 없을 때 사용)
 * @param {string} args.dataName             파일명
 * @param {Buffer|null} args.manualBuffer    실험 매뉴얼 PDF (선택)
 * @param {Array<{buffer, name, mimetype}>} args.photos  실험 사진들 (선택)
 * @param {string} args.userNotes            사용자 참고 메모/의견
 * @param {string} args.date
 * @param {Function} args.onProgress
 * @param {AbortSignal} args.signal
 * @param {string|null} args.model
 */
async function generateReportContent({
  capBuffer = null,
  capName = "",
  dataBuffer = null,
  dataName = "",
  manualBuffer = null,
  photos = [],
  userNotes = "",
  date,
  onProgress = () => {},
  signal,
  model = null,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  if (!capBuffer && !dataBuffer) {
    throw new Error(".cap 파일 또는 엑셀/CSV 데이터 중 하나는 업로드해야 합니다.");
  }

  const MODEL = model || DEFAULT_MODEL;
  const system = buildSystemPrompt();
  onProgress(`🤖 모델: ${MODEL} | 양식: 기본`);

  // ── 사용자 메시지 구성 ──────────────────────────────────────────────────────
  const content = [];
  const attachmentSummary = [];

  // ── 시나리오 A: .cap 파싱 ───────────────────────────────────────────────────
  if (capBuffer) {
    onProgress(`📦 .cap 파일 파싱 중... (${Math.round(capBuffer.length / 1024)}KB)`);
    let parsedCap;
    try {
      parsedCap = await parseCap(capBuffer);
    } catch (e) {
      throw new Error(`.cap 파일 파싱 실패: ${e.message}`);
    }
    const datasetCount = Object.keys(parsedCap.datasets).length;
    onProgress(
      `✓ .cap 파싱 완료 — 페이지 ${parsedCap.pages.length}, 센서 ${parsedCap.sensors.length}, dataset ${datasetCount}, 내장이미지 ${parsedCap.images.length}`,
    );
    const capSummary = summarizeForPrompt(parsedCap);
    content.push({
      type: "text",
      text: `=== PASCO Capstone 파일 파싱 결과 (${capName}) ===

${capSummary}

=== 파싱 결과 끝 ===

위 정보는 서버가 .cap ZIP을 풀고 main.xml과 binary 데이터를 읽어 추출한 것입니다.

⚠️ **데이터 사용 가이드 (반드시 준수)**:

1. **"## 캡스톤 사용자 입력 표" 섹션이 있으면 그게 최우선 데이터**입니다. 그 표의 각 행은 한 시편(측정 회차)에 해당하고, 보고서의 측정 데이터 표는 그 값을 **그대로 옮겨** 쓰세요. 행 순서를 바꾸거나 임의 매칭하지 마세요.

2. 사용자 입력 표에 Pendulum Type 같은 라벨 column이 있으면 그게 시편 식별자입니다. 같은 row index = 같은 시편.

3. dataset 파일명(Z_*.tmp)은 의미 없습니다. **measurement 이름으로만 판단**하세요.

4. 일부 measurement는 캡스톤이 자동 계산하는 column (Ipivot, Icm, %Diff 등) — 이 값들은 .cap에 저장되지 않으므로 보고서에서 **직접 공식으로 다시 계산**하세요. 예: I_pivot = m·g·d·T²/(4π²), I_cm = I_pivot − m·d².

5. "측정 데이터 상세" 섹션의 다회차 run은 시계열 측정(센서 자동 기록) 또는 시편별 반복 측정입니다. 짧은 단일 run은 보통 위 사용자 입력 표와 같은 데이터의 다른 표현이므로 **표를 우선** 참조하고, 시계열은 그래프·통계 분석용으로 쓰세요.

6. 측정값은 sensor 방향성으로 음수일 수 있습니다. 보고서 표에는 **절대값**.

7. 평균값은 제공된 mean을 그대로 쓰세요 — 일부 sample로 평균 추정 금지.

8. 부호와 단위, 유효숫자(보통 3~4자리)에 주의하세요. 사용자 입력 값의 정밀도를 그대로 보존하세요 (예: 0.089663 → 0.0897 또는 0.089663, 임의로 0.09로 반올림하지 말 것).`,
    });
    attachmentSummary.push(`.cap 파싱 결과 텍스트`);
  }

  // ── 시나리오 B: 엑셀/CSV 파싱 ───────────────────────────────────────────────
  if (dataBuffer) {
    const dataExt = (dataName.split(".").pop() || "").toLowerCase();
    if (["xlsx", "xls", "csv"].includes(dataExt)) {
      try {
        const parsed = parseToMarkdown(dataBuffer, dataExt);
        content.push({
          type: "text",
          text: `=== 실험 데이터 (${dataName}, 자동 파싱됨) ===

${parsed.text}

=== 데이터 끝 ===

위 데이터를 바탕으로 분석·통계 계산·차트 생성을 수행하세요.`,
        });
        attachmentSummary.push(
          `엑셀/CSV (${parsed.sheetCount}개 시트, ${parsed.totalRows}행 자동 파싱)`,
        );
      } catch (e) {
        throw new Error(`엑셀/CSV 파싱 실패: ${e.message}`);
      }
    } else {
      throw new Error(`지원하지 않는 데이터 형식: ${dataExt}. xlsx/xls/csv만 가능합니다.`);
    }
  }

  // ── 매뉴얼 PDF (선택) — 엑셀로 입력 시 특히 권장 ──────────────────────────
  if (manualBuffer) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: manualBuffer.toString("base64"),
      },
    });
    attachmentSummary.push(`매뉴얼 PDF (${Math.round(manualBuffer.length / 1024)}KB)`);
  }

  // 양식 PDF — 모든 보고서 동일이라 코드에 내장
  const formBase64 = loadFormPdfBase64();
  if (formBase64) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: formBase64,
      },
    });
    attachmentSummary.push(`양식 PDF (내장)`);
  }

  // 평가기준은 prompt.md에 점수표로 직접 명시 — 별도 첨부 없음

  // 실험 사진들 (vision)
  for (const photo of photos) {
    const ext = (photo.name.split(".").pop() || "").toLowerCase();
    if (["png", "jpg", "jpeg"].includes(ext)) {
      const mime = ext === "png" ? "image/png" : "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mime, data: photo.buffer.toString("base64") },
      });
    }
  }
  if (photos.length) attachmentSummary.push(`실험 사진 ${photos.length}장`);

  const notesBlock = buildUserNotesBlock(userNotes);
  if (notesBlock) {
    content.push({ type: "text", text: notesBlock });
    attachmentSummary.push("사용자 참고 메모");
  }

  // 마지막에 텍스트 지시
  const styleHints =
    `⚠️ **5페이지 이내**, **65점 만점 평가** (① 표/그래프 + 경향성 ② 이론연결 + 오차분석 ③ 문제 인식·해결) 모두 노립니다. 각 실험 파트마다 표 + 차트 spec(서버가 PNG 렌더) + 분석을 반드시 포함하세요.`;
  content.push({
    type: "text",
    text: `위 첨부를 바탕으로 일반물리학실험 결과보고서 콘텐츠를 JSON으로 생성하세요.

**실험 날짜: ${date || "(미지정)"}**

**첨부 파일 요약:**
${attachmentSummary.map((s) => "- " + s).join("\n")}

스킬 명세에 정의된 JSON 스키마를 정확히 따르세요.

${styleHints}

최종 출력은 단 하나의 \`\`\`json ... \`\`\` 코드 블록입니다.`,
  });

  const userMessage = { role: "user", content };

  onProgress(`📤 첨부: ${attachmentSummary.join(", ")}`);

  // ── Stream + heartbeat ─────────────────────────────────────────────────────
  const startedAt = Date.now();
  let charCount = 0;
  let lastReportedChars = 0;
  let lastEventAt = Date.now();
  let textBlocksStarted = 0;
  let firstTokenSeen = false;

  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);

  const heartbeat = setInterval(() => {
    const sinceLast = (Date.now() - lastEventAt) / 1000;
    if (sinceLast >= 12) {
      const note = !firstTokenSeen
        ? `Claude가 분석 중... (${elapsed()}초 경과)`
        : `보고서 작성 중... (${charCount}자, ${elapsed()}초 경과)`;
      onProgress("⏳ " + note);
      lastEventAt = Date.now();
    }
  }, 5000);

  let finalText;
  let cost = null;
  try {
    const stream = client_messages_stream(MODEL, system, userMessage, signal);
    stream.on("streamEvent", (event) => {
      lastEventAt = Date.now();
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block?.type === "text") {
          textBlocksStarted++;
          if (textBlocksStarted === 1) {
            onProgress(`✍️ 보고서 작성 시작 (${elapsed()}초)`);
            firstTokenSeen = true;
          }
        }
      }
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        event.delta.text
      ) {
        charCount += event.delta.text.length;
        if (charCount - lastReportedChars >= 1500) {
          onProgress(`보고서 작성 중... (${charCount}자, ${elapsed()}초)`);
          lastReportedChars = charCount;
        }
      }
    });

    const finalMessage = await stream.finalMessage();
    if (finalMessage.stop_reason === "max_tokens") {
      throw new Error("응답이 너무 길어 잘렸습니다. MAX_TOKENS를 늘려야 합니다.");
    }
    finalText = finalMessage.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    cost = calcCost({
      usage: finalMessage.usage,
      webSearchCount: 0,
      model: MODEL,
    });
  } finally {
    clearInterval(heartbeat);
  }

  // helper: 위에서 stream을 만들 수 없으니 inline. 아래 정의로 분리하지 말고 직접.
  // (위 client_messages_stream 호출은 closure 내부에서 처리되도록 아래에서 wrapping)

  onProgress(`✓ Claude 응답 완료 (총 ${charCount}자, ${elapsed()}초) — JSON 파싱 중`);
  onProgress(formatCostLine(cost));

  const json = extractJson(finalText);
  if (!json) {
    throw new Error(
      "JSON 코드 블록을 찾을 수 없습니다. 응답 앞부분: " + finalText.slice(0, 300),
    );
  }

  let parsed;
  try {
    parsed = parseJsonLenient(json);
  } catch (e) {
    throw new Error("JSON 파싱 실패: " + e.message);
  }
  // Claude 출력에 섞일 수 있는 비정상 마크업 제거.
  parsed = require("../../output-sanitize").sanitize(parsed);

  // 통계 메시지
  const stats = [];
  if (Array.isArray(parsed.experiments)) stats.push(`실험 파트 ${parsed.experiments.length}개`);

  let chartCount = 0;
  if (Array.isArray(parsed.experiments)) {
    for (const e of parsed.experiments) if (e.chart) chartCount++;
  }
  if (chartCount) stats.push(`차트 ${chartCount}개`);
  if (stats.length) onProgress(`📋 콘텐츠: ${stats.join(", ")}`);

  if (date) parsed.date = date;

  // 사진을 parsed에 attach (docx-gen이 photo_indices로 매칭)
  if (photos.length > 0) {
    Object.defineProperty(parsed, "__photos", {
      value: photos.map((p) => ({
        buffer: p.buffer,
        name: p.name,
        mimetype: p.mimetype,
      })),
      enumerable: false,
    });
  }

  // 차트 렌더링
  if (chartCount > 0) {
    onProgress(`📊 차트 ${chartCount}개 렌더링 중...`);
    let renderedCount = 0;
    if (Array.isArray(parsed.experiments)) {
      for (const exp of parsed.experiments) {
        if (exp.chart) {
          const buf = await renderChart(exp.chart);
          if (buf) {
            Object.defineProperty(exp.chart, "pngBuffer", {
              value: buf,
              enumerable: false,
            });
            renderedCount++;
          }
        }
      }
    }
    onProgress(`✓ 차트 ${renderedCount}/${chartCount}개 PNG 생성 완료`);
  }

  const imageCost = calcImageCost({ searchCount: 0, generationCount: 0 });

  Object.defineProperty(parsed, "__cost", {
    value: cost,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(parsed, "__imageCost", {
    value: imageCost,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(parsed, "__style", {
    value: "default",
    enumerable: false,
    writable: false,
  });

  return parsed;
}

// 위 generateReportContent 안에서 사용한 stream wrapper.
// 호이스팅을 활용해 함수 선언 후 위에서 호출.
function client_messages_stream(MODEL, system, userMessage, signal) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [userMessage],
    },
    signal ? { signal } : undefined,
  );
}

function extractJson(text) {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const anyFence = text.match(/```\s*([\s\S]*?)```/);
  if (anyFence) return anyFence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return null;
}

module.exports = { generateReportContent };
