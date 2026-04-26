const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const {
  calcCost,
  calcImageCost,
  formatCostLine,
} = require("../../pricing");
const { parseJsonLenient } = require("../../json-sanitize");

// 기본은 Sonnet 4.6. 사용자가 폼에서 모델을 선택하면 그게 우선되고,
// 선택 없으면 환경변수, 그것도 없으면 Sonnet 4.6.
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
// Opus 4.7 모델 최대 출력(32K)에 맞춤. Sonnet 4.6은 64K까지 가능하지만
// 두 모델 공통 안전선으로 32K 사용. 실제 사용량은 모델이 필요한 만큼만 출력.
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "32000", 10);

const SKILL_PATH = path.join(__dirname, "prompt.md");

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
        { "figure": 1 },
        "그림 다음에 이어지는 설명 단락"
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
      "description": "CO_{2}의 온도-압력 상평형도. 삼중점(-56.6°C, 5.11 atm)과 임계점(31.1°C, 72.8 atm) 표시.",
      "search_query": "CO2 phase diagram triple point critical point"
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

## 그림 (figures_needed) — 학교 평가 기준 준수 ⭐

**대구과학고 화실 보고서 작성 요령에 따르면, 사전보고서에서 사진/그림은 "기구 중 특별한 것"에만 첨부한다.** 그 외엔 학교가 요구하지 않는다.

### 그림 추가 기준 (이 기준에 해당하지 않으면 절대 추가 금지)

**O 추가**:
1. **특수 분석기기**: UV-Vis 분광계, GC, HPLC, NMR, AA, IR, MS, 회전증발기, 적외선 분광기 등 평소 보지 못하는 장비
2. **복잡한 실험 setup**: 분별증류 장치, 환류 장치, soxhlet 추출기, 가스 포집 setup, 계면 중합 setup 등 — 글로만 묘사하면 학생이 이해 못 할 정도로 복잡한 경우
3. (드물게) 메커니즘이 매우 복잡하고 시각화 없이는 학습이 불가능한 경우 — 단, 학생이 이미 알 수 있는 단순 메커니즘은 제외

**X 추가 금지**:
- 일반 유리기구: 비커, 삼각플라스크, 시험관, 매스실린더, 피펫, 뷰렛, 시계접시, 깔때기, 거름종이 등
- 표준 화학 반응식 (텍스트로 충분히 설명되면 그림 불필요)
- 단순 화합물 구조 (이름·화학식만으로 충분)
- 보편적 개념의 모식도 (PV=nRT 그래프, 일반적인 평형 곡선 등)

**기본값은 figures_needed = []**. 단순 실험(적정, 결정화, 단순 합성 등)은 거의 모두 빈 배열.
복잡한 실험이라도 figures_needed는 보통 **0~2개를 넘지 않는다**.

각 항목의 \`search_query\`는 영어 키워드 4~8개로, 구글 이미지 검색에 바로 쓸 수 있게 작성 (예: "rotary evaporator setup", "interfacial polycondensation nylon rope apparatus").

### 그림 본문 배치 (필수, 절대 규칙)

**figures_needed 배열의 모든 그림은 반드시 theory 섹션의 \`items\` 배열 안에 \`{ "figure": N }\` 마커로 인라인 배치되어야 한다.** 마커가 없는 그림은 보고서에서 자동으로 누락된다 (별도의 "필요한 그림 목록" 섹션은 존재하지 않는다).

배치 방법: 그림이 들어갈 위치에 \`{ "figure": N }\` 객체를 \`items\`에 끼워넣는다 (N은 figures_needed의 number와 일치). 그림 앞뒤로 그림과 연결된 설명 텍스트가 자연스럽게 흐르도록 단락을 배치한다.

**검증 체크리스트** (출력 전 반드시 확인):
- figures_needed에 number=1, 2, 3이 있다면 → theory의 어느 섹션이든 items 안에 \`{ "figure": 1 }\`, \`{ "figure": 2 }\`, \`{ "figure": 3 }\`이 모두 등장해야 함.
- 어떤 그림도 inline 배치 안 됐는데 figures_needed에 들어있으면 → 그 그림은 figures_needed에서 제거하거나 inline 마커 추가.

예시:
\`\`\`json
"items": [
  "이상기체 상태방정식 *PV* = *nRT* 는 이상기체의 거동을 기술한다.",
  "여기서 P는 압력, V는 부피, T는 절대온도이다.",
  { "figure": 1 },
  "그림 1과 같이 분자 간 충돌이 무작위로 일어나며, 분자 부피와 인력은 무시된다."
]
\`\`\`

→ figures_needed[0].number == 1 이고, 본문에는 단락 사이에 그림이 인라인으로 들어간다.
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
async function generateReportContent({
  pdfBuffer,
  date,
  onProgress = () => {},
  signal,
  useImages = false,
  model = null,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const MODEL = model || DEFAULT_MODEL;
  onProgress(`🤖 모델: ${MODEL}`);

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
  let cost = null;
  try {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // 시스템 프롬프트는 정적이므로 ephemeral 캐시 (5분 TTL).
        // 같은 사용자가 연속해서 보고서 만들 때 입력 비용 ~90% 절감.
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [
          // Sonnet은 회수율 높아 5번까지 안 가도 충분. 3으로 줄여서 비용·시간 절감.
          { type: "web_search_20250305", name: "web_search", max_uses: 3 },
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

    // ── Cost calculation ──
    cost = calcCost({
      usage: finalMessage.usage,
      webSearchCount,
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
      "JSON 코드 블록을 찾을 수 없습니다. 응답 앞부분: " +
        finalText.slice(0, 300),
    );
  }

  let parsed;
  try {
    parsed = parseJsonLenient(json);
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

  // 이미지 자동 첨부는 비활성화 — figures_needed 항목은 docx에서 점선 박스 placeholder로 렌더됨
  const imageCost = calcImageCost({ searchCount: 0, generationCount: 0 });
  const figCount = Array.isArray(parsed.figures_needed)
    ? parsed.figures_needed.length
    : 0;
  if (figCount > 0) {
    onProgress(
      `📷 그림 ${figCount}장 — 자동 첨부 비활성화. 보고서 안 점선 박스의 검색 링크로 직접 채워넣으세요.`,
    );
  }

  // Attach metadata (docx generator ignores keys it doesn't know)
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
