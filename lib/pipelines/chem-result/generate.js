const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const {
  calcCost,
  calcImageCost,
  formatCostLine,
} = require("../../pricing");
const { parseJsonLenient } = require("../../json-sanitize");
const { parseToMarkdown } = require("./excel-parser");
const { renderChart } = require("./chart-gen");

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "32000", 10);

const SKILL_PATH = path.join(__dirname, "prompt.md");

function loadSkill() {
  return fs.readFileSync(SKILL_PATH, "utf8");
}

function buildSystemPrompt() {
  const skill = loadSkill();
  return `당신은 대구과학고등학교 학생을 위한 화학실험 결과보고서 자동 생성 도우미입니다.

아래는 결과보고서 작성에 따라야 할 스킬 명세입니다. 모든 규칙(번호 체계, 데이터 처리, JSON 출력)을 정확히 따르세요.

=========== SKILL SPEC START ===========
${skill}
=========== SKILL SPEC END ===========

## 작업 절차

1. 첨부된 사전보고서(PDF/docx)에서 실험 목표·이론·기구/시약·과정 추출.
2. 첨부된 실험 데이터(엑셀·CSV·텍스트·사진)에서 측정값 파악. 사진/스크린샷이면 vision으로 읽기.
3. 통계 자동 계산 (평균·표준편차·백분율 오차).
4. 매뉴얼이 있으면 함께 참조해 보완.
5. 결과 분석·오차 분석·개선점·PCEI 작성.
6. JSON 출력.

## 출력 형식 (매우 중요)

**최종 출력은 반드시 단 하나의 JSON 코드 블록 (\`\`\`json ... \`\`\`)입니다.** 그 외 텍스트 일체 금지.
`;
}

/**
 * Generate result report content.
 *
 * @param {Object} args
 * @param {Buffer} args.preReportBuffer  사전보고서 PDF/docx (필수)
 * @param {string} args.preReportName    파일명 (확장자 판별용)
 * @param {Buffer|null} args.dataBuffer  실험 데이터 (엑셀/csv/txt/이미지)
 * @param {string} args.dataName         파일명
 * @param {Array<{buffer: Buffer, name: string, mimetype: string}>} args.photos  실험 사진 배열
 * @param {Buffer|null} args.manualBuffer  매뉴얼 PDF (선택)
 * @param {string} args.date            날짜 YYYY/MM/DD
 * @param {string} args.temperature     실험 온도 (예: "22.5")
 * @param {string} args.pressure        기압 (예: "1013.2")
 * @param {Function} args.onProgress
 * @param {AbortSignal} args.signal
 * @param {string|null} args.model
 */
async function generateReportContent({
  preReportBuffer,
  preReportName = "",
  dataBuffer = null,
  dataName = "",
  photos = [],
  manualBuffer = null,
  date,
  temperature = "",
  pressure = "",
  onProgress = () => {},
  signal,
  model = null,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  if (!preReportBuffer) {
    throw new Error("사전보고서 파일이 필요합니다.");
  }

  const MODEL = model || DEFAULT_MODEL;
  onProgress(`🤖 모델: ${MODEL}`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt();

  // ── 사용자 메시지 구성 ─────────────────────────────────────────────────────
  const content = [];
  const attachmentSummary = [];

  // 사전보고서 — PDF만 documents 블록으로 (docx는 Phase 2-3에서 텍스트 추출 추가)
  const preExt = (preReportName.split(".").pop() || "").toLowerCase();
  if (preExt === "pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: preReportBuffer.toString("base64"),
      },
    });
    attachmentSummary.push(`사전보고서 PDF (${Math.round(preReportBuffer.length / 1024)}KB)`);
  } else {
    // .docx는 일단 안내만 — Phase 2-3에서 텍스트 추출 추가 예정
    attachmentSummary.push(
      `사전보고서 ${preExt} (${Math.round(preReportBuffer.length / 1024)}KB) — 텍스트 추출 미구현, 빈 사전보고서로 처리`,
    );
  }

  // 매뉴얼 (선택)
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

  // 실험 데이터 — 이미지면 image 블록, PDF면 document 블록, 엑셀/CSV는 Phase 2-3
  if (dataBuffer) {
    const dataExt = (dataName.split(".").pop() || "").toLowerCase();
    if (["png", "jpg", "jpeg"].includes(dataExt)) {
      const mime = dataExt === "png" ? "image/png" : "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mime, data: dataBuffer.toString("base64") },
      });
      attachmentSummary.push(`데이터 사진 ${dataExt} (${Math.round(dataBuffer.length / 1024)}KB)`);
    } else if (dataExt === "pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: dataBuffer.toString("base64"),
        },
      });
      attachmentSummary.push(`데이터 PDF (${Math.round(dataBuffer.length / 1024)}KB)`);
    } else if (dataExt === "txt") {
      // 일반 텍스트는 그대로 첨부
      const text = dataBuffer.toString("utf8").slice(0, 50000);
      content.push({
        type: "text",
        text: `=== 실험 데이터 (${dataName}) ===\n${text}\n=== 데이터 끝 ===`,
      });
      attachmentSummary.push(`데이터 ${dataExt} (텍스트 ${text.length}자)`);
    } else if (["xlsx", "xls", "csv"].includes(dataExt)) {
      // 엑셀/CSV는 markdown table로 자동 변환해서 첨부
      try {
        const parsed = parseToMarkdown(dataBuffer, dataExt);
        content.push({
          type: "text",
          text: `=== 실험 데이터 (${dataName}, 자동 파싱됨) ===

${parsed.text}

=== 데이터 끝 ===

위 데이터를 바탕으로 평균·표준편차·백분율 오차를 직접 계산하여 결과 섹션에 정확히 기록하세요. (스킬 명세의 유효숫자 규칙 준수)`,
        });
        attachmentSummary.push(
          `데이터 ${dataExt} (${parsed.sheetCount}개 시트, ${parsed.totalRows}행 자동 파싱)`,
        );
      } catch (e) {
        attachmentSummary.push(`데이터 ${dataExt} — 파싱 실패: ${e.message}`);
      }
    } else {
      attachmentSummary.push(
        `데이터 ${dataExt} — 지원하지 않는 형식, 무시됨`,
      );
    }
  }

  // 실험 사진들
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
  if (photos.length > 0) {
    attachmentSummary.push(`실험 사진 ${photos.length}장`);
  }

  // 마지막에 텍스트 지시
  content.push({
    type: "text",
    text: `위 첨부 파일을 바탕으로 결과보고서 콘텐츠를 JSON으로 생성하세요.

**헤더 정보:**
- 실험 날짜: ${date || "(미지정)"}
- 실험 온도: ${temperature ? temperature + "°C" : "(미입력)"}
- 기압: ${pressure ? pressure + " hPa" : "(미입력)"}

**첨부 파일 요약:**
${attachmentSummary.map((s) => "- " + s).join("\n")}

스킬 명세에 정의된 JSON 스키마를 정확히 따르세요. 데이터가 부족하면 \`data.summary\`에 그 사실을 명시하세요.

최종 출력은 단 하나의 \`\`\`json ... \`\`\` 코드 블록입니다.`,
  });

  const userMessage = { role: "user", content };

  onProgress(`📤 첨부: ${attachmentSummary.join(", ")}`);

  // ── Stream + heartbeat (chem-pre와 동일 패턴) ────────────────────────────
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
        ? `Claude가 첨부 파일 분석 중... (${elapsed()}초 경과)`
        : `보고서 작성 중... (${charCount}자, ${elapsed()}초 경과)`;
      onProgress("⏳ " + note);
      lastEventAt = Date.now();
    }
  }, 5000);

  let finalText;
  let cost = null;
  try {
    const stream = client.messages.stream(
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

  const stats = [];
  if (parsed.theory) stats.push(`이론 ${parsed.theory.length}개`);
  if (parsed.chemicals) stats.push(`시약 ${parsed.chemicals.length}개`);
  if (parsed.procedure) stats.push(`과정 ${parsed.procedure.length}개`);
  if (parsed.data?.experiments) stats.push(`측정 실험 ${parsed.data.experiments.length}개`);
  if (stats.length > 0) onProgress(`📋 콘텐츠 구조: ${stats.join(", ")}`);

  if (date) parsed.date = date;
  parsed.conditions = parsed.conditions || {};
  if (temperature) parsed.conditions.temperature = temperature + "°C";
  if (pressure) parsed.conditions.pressure = pressure + " hPa";

  // 사진 buffer를 docx-gen.js가 photo_indices로 매칭할 수 있게 attach
  // non-enumerable이라 JSON 직렬화/로깅에 영향 없음
  if (photos.length > 0) {
    Object.defineProperty(parsed, "__photos", {
      value: photos.map((p) => ({
        buffer: p.buffer,
        name: p.name,
        mimetype: p.mimetype,
      })),
      enumerable: false,
      writable: false,
    });
  }

  // 차트 렌더링 (chartjs-node-canvas → PNG buffer)
  const charts = Array.isArray(parsed.data?.charts) ? parsed.data.charts : [];
  if (charts.length > 0) {
    onProgress(`📊 차트 ${charts.length}개 렌더링 중...`);
    let renderedCount = 0;
    for (const chart of charts) {
      const buf = await renderChart(chart);
      if (buf) {
        // pngBuffer를 chart spec에 attach (docx-gen.js가 사용)
        // non-enumerable로 두면 다른 곳에서 JSON.stringify 시 영향 없음
        Object.defineProperty(chart, "pngBuffer", {
          value: buf,
          enumerable: false,
          writable: false,
        });
        renderedCount++;
      }
    }
    onProgress(`✓ 차트 ${renderedCount}/${charts.length}개 PNG 생성 완료`);
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

  return parsed;
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
