const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-5";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "16000", 10);

const SKILL_PATH = path.join(__dirname, "..", "skills", "chem-pre-lab-report.md");

function loadSkill() {
  return fs.readFileSync(SKILL_PATH, "utf8");
}

function buildSystemPrompt() {
  const skill = loadSkill();
  return `당신은 대구과학고등학교 학생을 위한 화학실험 사전보고서 자동 생성 도우미입니다.

아래는 사전보고서 작성에 따라야 할 스킬 명세입니다. 모든 규칙(번호 체계, 분량, 이론 깊이, 시약 데이터, 그림 처리)을 정확히 따르세요.

=========== SKILL SPEC START ===========
${skill}
=========== SKILL SPEC END ===========

## 작업 절차

1. 첨부된 PDF(실험 매뉴얼)을 분석합니다 — Purpose, Theory & Principle 키워드, Apparatus, Chemicals, Procedure.
2. Theory & Principle 키워드 각각에 대해 대구과학고 2학년 일반화학 수준의 상세 이론을 전개합니다 (수식·반응식 포함).
3. 각 시약의 정확한 물성 데이터(IUPAC명, 화학식, 몰질량, 녹는점/끓는점, 밀도, 독성)를 확보합니다.
   - 확신이 없는 데이터는 web_search 도구로 PubChem/NIST 등을 검색하여 확인하세요.
4. 매뉴얼의 실험 과정에 "왜 그렇게 하는지" 이유와 원리를 덧붙여 풀어 씁니다.
5. 그림이 필요한 경우 figures_needed 배열에 상세 설명과 함께 나열합니다.

## 출력 형식 (매우 중요)

**최종 출력은 반드시 단 하나의 JSON 코드 블록 (\`\`\`json ... \`\`\`)입니다.** 그 외의 설명·인사·마크다운 본문은 일체 출력하지 마세요. JSON 외 텍스트는 무시됩니다.

JSON 스키마:

\`\`\`json
{
  "title_kr": "한글 실험 제목",
  "title_en": "English experiment title",
  "purpose": [
    "구체적으로 확장된 실험 목표 1",
    "구체적으로 확장된 실험 목표 2"
  ],
  "theory": [
    {
      "topic": "이론 주제명 (예: 이상기체 상태방정식)",
      "items": [
        "첫 번째 단락 — 수식·반응식 포함, 최소 2~5문장",
        "두 번째 단락",
        "..."
      ],
      "figures": [
        { "number": 1, "caption": "그림 캡션" }
      ]
    }
  ],
  "apparatus": [
    {
      "name": "기구명",
      "name_en": "English name",
      "description": "용도 + 원리/주의사항"
    }
  ],
  "chemicals": [
    {
      "name": "시약명",
      "iupac": "IUPAC명",
      "formula": "화학식 (마커 사용: H_{2}O, CO_{2}, Ca^{2+})",
      "molar_mass": "18.02 g/mol",
      "mp_bp": "0°C / 100°C",
      "density": "1.00 g/mL (선택)",
      "properties": "주요 물리/화학적 특성",
      "toxicity": "독성·취급 주의사항"
    }
  ],
  "chemicals_summary_table": [
    {
      "name": "시약명",
      "formula": "화학식",
      "molar_mass": "몰질량",
      "mp_bp": "녹는점/끓는점",
      "properties": "주요 특성"
    }
  ],
  "procedure": [
    {
      "title": "실험 A: 제목",
      "steps": [
        { "text": "절차 설명 — 이유·원리 포함", "notes": ["세부 주의사항 1"] },
        "또는 단순 문자열 절차"
      ]
    }
  ],
  "data_table": [
    { "item": "공기의 분자량 (MW_{air})", "value": "28.96 g/mol" },
    { "item": "기체상수 (R)", "value": "0.08206 L·atm/(mol·K)" }
  ],
  "figures_needed": [
    {
      "number": 1,
      "caption": "CO_{2} 상평형도",
      "description": "CO_{2}의 온도-압력 상평형도. 삼중점(-56.6°C, 5.11 atm)과 임계점(31.1°C, 72.8 atm) 표시."
    }
  ]
}
\`\`\`

## 화학식·수식 마커 규칙 (반드시 준수)

JSON 안의 모든 텍스트 필드에서 다음 마커를 사용하세요:

- 아래첨자: \`_{내용}\` — \`H_{2}O\`, \`CO_{2}\`, \`P_{1}V_{1}\`
- 위첨자: \`^{내용}\` — \`Ca^{2+}\`, \`10^{-3}\`, \`m^{3}\`
- 이탤릭: \`*내용*\` — 변수·상수: \`*PV* = *nRT*\`
- 볼드: \`**내용**\` — 중요 강조
- 그리스문자: 유니코드 직접 (\`α\`, \`Δ\`, \`π\`, \`ρ\`, \`μ\`)

## 분량 가이드

- 이론 섹션이 보고서 전체의 50~60%를 차지하도록 키워드별로 충분히 전개
- 각 이론 키워드는 최소 3~5개의 items
- 시약은 매뉴얼에 나온 모든 시약을 포함
- 실험 과정은 매뉴얼의 모든 단계를 포함하되 이유/원리 추가

## 데이터 정확성

- 물리 상수 (R, N_A, h 등)는 정확한 값
- 시약 물성은 PubChem/NIST 기준
- 확신이 없으면 web_search 도구를 적극 사용
`;
}

/**
 * Generate report content from a manual PDF.
 *
 * @param {Object} args
 * @param {Buffer} args.pdfBuffer  Manual PDF as Buffer
 * @param {string} args.date       Experiment date (YYYY/MM/DD)
 * @param {Function} args.onProgress  (msg) => void  status callback
 * @returns {Promise<Object>}      Parsed report JSON
 */
async function generateReportContent({ pdfBuffer, date, onProgress = () => {} }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt();

  const userMessage = {
    role: "user",
    content: [
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
        text: `첨부된 실험 매뉴얼 PDF를 바탕으로 사전보고서 콘텐츠를 JSON으로 생성하세요.

실험 예정일: ${date || "(미지정)"}

위에서 명시한 JSON 스키마와 마커 규칙을 정확히 따르세요. 시약의 정확한 물성 데이터가 확신이 없으면 web_search 도구를 적극적으로 사용하세요.

최종 출력은 단 하나의 \`\`\`json ... \`\`\` 코드 블록입니다.`,
      },
    ],
  };

  const pdfSizeKB = Math.round(pdfBuffer.length / 1024);
  onProgress(`PDF 수신 (${pdfSizeKB}KB) — Claude Opus에게 전송`);

  // ── Stream + heartbeat ────────────────────────────────────────────────────
  const startedAt = Date.now();
  let charCount = 0;
  let lastReportedChars = 0;
  let lastEventAt = Date.now();
  let webSearchCount = 0;
  let textBlocksStarted = 0;
  let firstTokenSeen = false;

  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);

  // Heartbeat: every 5s, if nothing else has fired in last 12s, emit a tick
  const heartbeat = setInterval(() => {
    const sinceLast = (Date.now() - lastEventAt) / 1000;
    if (sinceLast >= 12) {
      const note = !firstTokenSeen
        ? `Claude가 PDF 분석 중... (${elapsed()}초 경과)`
        : `보고서 작성 중... (${charCount}자, ${elapsed()}초 경과)`;
      onProgress("⏳ " + note);
      lastEventAt = Date.now();
    }
  }, 5000);

  let finalText;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ],
      messages: [userMessage],
    });

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
        } else if (block?.type === "server_tool_use" && block?.name === "web_search") {
          webSearchCount++;
          onProgress(`🔍 시약 데이터 웹 검색 중... (${webSearchCount}번째)`);
        } else if (block?.type === "web_search_tool_result") {
          onProgress(`✓ 검색 결과 수신`);
        }
      }

      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        event.delta.text
      ) {
        charCount += event.delta.text.length;
        // Emit every ~1500 chars
        if (charCount - lastReportedChars >= 1500) {
          onProgress(`보고서 작성 중... (${charCount}자, ${elapsed()}초)`);
          lastReportedChars = charCount;
        }
      }

      if (event.type === "message_delta" && event.delta?.stop_reason) {
        if (event.delta.stop_reason === "max_tokens") {
          // Will throw downstream
          onProgress("⚠ 응답 토큰 한도 도달");
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
  } finally {
    clearInterval(heartbeat);
  }

  onProgress(`✓ Claude 응답 완료 (총 ${charCount}자, ${elapsed()}초) — JSON 파싱 중`);

  const json = extractJson(finalText);
  if (!json) {
    throw new Error(
      "JSON 코드 블록을 찾을 수 없습니다. 응답 앞부분: " +
        finalText.slice(0, 300),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error("JSON 파싱 실패: " + e.message);
  }

  // Quick content stats for the user
  const stats = [];
  if (parsed.theory) stats.push(`이론 ${parsed.theory.length}개 섹션`);
  if (parsed.chemicals) stats.push(`시약 ${parsed.chemicals.length}개`);
  if (parsed.procedure) stats.push(`실험 과정 ${parsed.procedure.length}개`);
  if (stats.length > 0) onProgress(`📋 콘텐츠 구조: ${stats.join(", ")}`);

  // Inject the date the user picked (override if Claude guessed)
  if (date) parsed.date = date;

  return parsed;
}

function extractJson(text) {
  // Prefer fenced ```json ... ``` block
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Generic ``` block
  const anyFence = text.match(/```\s*([\s\S]*?)```/);
  if (anyFence) return anyFence[1].trim();

  // Fallback: first { ... last }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return null;
}

module.exports = { generateReportContent };
