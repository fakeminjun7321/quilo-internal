// AI 스튜디오 공용 코어 — Pro 회원 전용(게이트는 라우트) + 토큰 사용량 비례 크레딧 차감 JSON 생성 도구.
//
// "바이브 코딩 생성기"(/api/vibe)와 "고급 물리 문제 스튜디오"(/api/physics-studio)는
// 둘 다 "사용자 입력 → 모델 호출 → 구조화 JSON 응답"이라는 동일한 모양이다.
// 모델 선택/제공자 분기(Anthropic·GPT)·JSON 파싱·잔액 확인·크레딧 차감 같은 공통 로직을
// 이 모듈에 모으고, 각 도구는 시스템 프롬프트·입력 검증·출력 정규화(spec)만 제공한다.
//
// 보고서 파이프라인과 동일한 헬퍼를 재사용한다:
//  - lib/model-call.js   : GPT 호출(callGptReport), isGptModel, gptConfigured
//  - lib/json-sanitize.js: 모델이 string 안에 raw 제어문자를 넣은 JSON 복구(parseJsonLenient)
//  - lib/pricing.js      : 모델별 크레딧 단가(getModelCredits) — 단일 소스
//  - lib/supabase.js     : getCredits / spendCredits (원자적 RPC 우선)

const Anthropic = require("@anthropic-ai/sdk");
const { callGptReport, isGptModel, gptConfigured } = require("./model-call");
const { sanitizeJson } = require("./json-sanitize");
const byok = require("./byok");

// 셀렉터에 노출하는 모델. 크레딧 단가는 pricing.getModelCredits 가 단일 소스이므로
// 여기서는 id·label·provider 만 둔다(보고서 타입과 동일 정책: Opus 기본, GPT 선택 가능).
const STUDIO_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai" },
];
const MODEL_IDS = new Set(STUDIO_MODELS.map((m) => m.id));
const DEFAULT_MODEL = "claude-opus-4-8";

function anthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}
function modelConfigured(id) {
  const m = STUDIO_MODELS.find((x) => x.id === id);
  if (!m) return false;
  return m.provider === "openai" ? gptConfigured() : anthropicConfigured();
}

// 키가 설정된 제공자의 모델만 노출. pricing 을 주입받아 크레딧 단가를 함께 돌려준다.
function availableModels(pricing) {
  return STUDIO_MODELS.filter((m) => modelConfigured(m.id)).map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    credits: pricing ? pricing.getModelCredits(m.id) : undefined,
  }));
}

// 요청 모델을 화이트리스트로 정규화. 미지정/미지원/키없음이면 설정된 모델로 폴백.
function resolveModel(requested) {
  const r = String(requested || "").trim();
  if (MODEL_IDS.has(r) && modelConfigured(r)) return r;
  if (modelConfigured(DEFAULT_MODEL)) return DEFAULT_MODEL;
  const alt = STUDIO_MODELS.find((m) => modelConfigured(m.id));
  return alt ? alt.id : DEFAULT_MODEL;
}

// 모델 출력에서 JSON 객체만 추출 (```json 펜스/앞뒤 잡담 제거).
function extractJsonBlock(text) {
  let s = String(text || "").trim();
  // ```json ... ``` 또는 ``` ... ``` 펜스 제거
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 가장 바깥 중괄호 블록
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return s;
}

// 문자열 내부의 "유효하지 않은 백슬래시 escape"를 이스케이프한다.
// LaTeX 수식(\theta, \frac, \( 등)을 JSON string 안에 single backslash 로 쓰면
// JSON.parse 가 깨진다(\t, \f 는 제어문자, \( 는 invalid escape). 모델이 흔히 이렇게
// 출력하므로, JSON escape 로 유효한 문자(" \ / b f n r t u)로 시작하지 않는 백슬래시만
// \\ 로 바꿔 복구한다. (구조적 백슬래시는 string 밖에 없으므로 inString 일 때만 처리.)
function repairBackslashes(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      const next = s[i + 1];
      if (inString && !'"\\/bfnrtu'.includes(next)) {
        out += "\\\\"; // 유효하지 않은 escape → 백슬래시를 이스케이프
        continue; // next 는 다음 루프에서 일반 문자로 처리
      }
      out += c;
      escaped = true; // 유효한 escape → 다음 문자는 그대로
      continue;
    }
    if (c === '"') {
      inString = !inString;
    }
    out += c;
  }
  return out;
}

// LaTeX·raw 제어문자가 섞인 모델 JSON 을 최대한 복구해서 파싱.
function robustJsonParse(text) {
  const block = extractJsonBlock(text);
  const candidates = [
    block,
    sanitizeJson(block),
    repairBackslashes(block),
    sanitizeJson(repairBackslashes(block)),
  ];
  let lastErr;
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("JSON 파싱 실패");
}

async function callAnthropicJson({ model, system, userText, maxTokens, signal }) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 5 * 60 * 1000,
  });
  const msg = await client.messages.create(
    {
      model,
      max_tokens: maxTokens,
      // temperature 미지정 — 일부 최신 모델(Opus 4.8 등)이 temperature 파라미터를
      // deprecated 로 400 을 반환한다(보고서 파이프라인도 temperature 를 보내지 않음).
      system,
      messages: [{ role: "user", content: userText }],
    },
    signal ? { signal } : undefined,
  );
  if (msg.stop_reason === "max_tokens") {
    throw new Error(
      "출력이 최대 길이에 도달해 잘렸습니다. 문항 수를 줄이거나 다시 시도해 주세요.",
    );
  }
  const text = (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, usage: msg.usage || {} };
}

// 제공자-인지 JSON 생성. → { data(파싱된 객체), raw(원문), usage }
async function callModelJson({ model, system, userText, maxTokens = 8000, signal }) {
  let text, usage;
  if (isGptModel(model)) {
    const r = await callGptReport({
      model,
      system,
      content: [{ type: "text", text: userText }],
      maxTokens,
      jsonObject: true,
      signal,
    });
    text = r.text;
    usage = r.usage;
  } else {
    const r = await callAnthropicJson({ model, system, userText, maxTokens, signal });
    text = r.text;
    usage = r.usage;
  }
  if (!text || !text.trim()) throw new Error("AI가 빈 응답을 반환했습니다.");
  let data;
  try {
    data = robustJsonParse(text);
  } catch (e) {
    throw new Error("AI 응답을 JSON으로 해석하지 못했습니다. 다시 시도해 주세요.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("AI가 올바른 형식(JSON 객체)을 반환하지 않았습니다.");
  }
  return { data, raw: text, usage };
}

// 도구용 express 핸들러 팩토리.
// spec: { feature, parseInput(body)->input, buildSystem(input)->str,
//         buildUserText(input)->str, maxTokens?, shapeResult?(data,input)->result }
// deps: { getSessionUser, refreshSessionUser, supa, pricing }
function createStudioHandler(spec, deps) {
  const { getSessionUser, refreshSessionUser, supa, pricing } = deps;
  if (typeof getSessionUser !== "function")
    throw new Error("ai-studio-core: getSessionUser 의존성이 필요합니다.");
  if (!supa || !pricing)
    throw new Error("ai-studio-core: supa·pricing 의존성이 필요합니다.");

  return async function studioHandler(req, res) {
    const userInfo = getSessionUser(req);
    if (!userInfo || !userInfo.id) {
      return res.status(401).json({ error: "로그인이 필요합니다." });
    }

    // 입력 검증
    let input;
    try {
      input = spec.parseInput(req.body || {});
    } catch (e) {
      return res.status(400).json({ error: e.message || "입력이 올바르지 않습니다." });
    }

    // BYOK: 본인 API 키 등록 사용자는 해당 제공자 호출을 본인 키로 실행 + 크레딧 미차감.
    const byokKeys = await byok.loadUserKeys(supa, userInfo.id);
    const requested = String((req.body && req.body.model) || "").trim();
    let model = resolveModel(requested);
    if (
      requested &&
      requested !== model &&
      MODEL_IDS.has(requested) &&
      byokKeys &&
      byokKeys[byok.activeProvider(requested)]
    ) {
      model = requested; // 서버에 키가 없는 제공자라도 본인 키가 있으면 요청 모델 존중
    }
    const byokActive = !!(byokKeys && byokKeys[byok.activeProvider(model)]);
    if (!modelConfigured(model) && !byokActive) {
      return res
        .status(503)
        .json({ error: "AI 모델 키가 서버에 설정되지 않았습니다. 관리자에게 문의하세요." });
    }

    // 관리자·무제한 계정·BYOK 는 과금 면제. fresh row 로 권한 확인(세션 staleness 방지).
    let fresh = userInfo;
    try {
      if (typeof refreshSessionUser === "function") {
        fresh = (await refreshSessionUser(req)) || userInfo;
      }
    } catch {
      /* 권한 새로고침 실패 → 세션 값 사용 */
    }
    const exempt = !!(fresh.isAdmin || fresh.unlimited) || byokActive;
    // 토큰 사용량 비례 차감(pricing.creditsForUsage) — 무료 모델(단가 0)은 계속 무료.
    const chargeable =
      !exempt && supa.isEnabled() && pricing.getModelCredits(model) > 0;

    // 잔액 사전 확인 (정확한 비용은 생성 후 사용량으로 확정 — 최소 1크레딧 필요)
    if (chargeable) {
      try {
        const have = await supa.getCredits(userInfo.id);
        if (have < 1) {
          return res.status(402).json({
            error: `🚫 크레딧이 없습니다 (보유 ${have}). 이 도구는 토큰 사용량에 비례해 차감됩니다(호출당 최소 1크레딧). 관리자에게 충전을 요청하세요.`,
          });
        }
      } catch (e) {
        console.error(`[${spec.feature}] credit check:`, e.message);
        return res.status(500).json({ error: "잔액 확인 중 오류가 발생했습니다." });
      }
    }

    // 생성 (BYOK 키가 있으면 그 키의 컨텍스트에서 호출)
    let result;
    let usage = null;
    try {
      const system = spec.buildSystem(input);
      const userText = spec.buildUserText(input);
      const r = await byok.run(byokKeys || {}, () =>
        callModelJson({
          model,
          system,
          userText,
          maxTokens: spec.maxTokens || 8000,
        }),
      );
      usage = r.usage;
      result = spec.shapeResult ? spec.shapeResult(r.data, input) : r.data;
    } catch (e) {
      console.error(`[${spec.feature}] generate:`, e.message);
      const status = /빈 응답|JSON|형식/.test(e.message || "") ? 502 : 502;
      return res
        .status(status)
        .json({ error: "AI 생성 중 오류가 발생했습니다: " + (e.message || "알 수 없는 오류") });
    }

    // 생성 성공 후 토큰 사용량 비례 차감. (보고서 흐름과 동일하게 '완료 시 차감'.)
    // 차감 실패는 사용자 결과를 막지 않는다 — 결과는 이미 만들어졌으므로 로그만 남긴다.
    let creditsCharged = 0;
    let newBalance;
    if (chargeable) {
      const cost = pricing.creditsForUsage
        ? pricing.creditsForUsage({ usage, model })
        : pricing.getModelCredits(model);
      if (cost > 0) {
        try {
          const s = await supa.spendCredits(userInfo.id, cost);
          creditsCharged = cost;
          newBalance = s.newBalance;
        } catch (e) {
          console.error(`[${spec.feature}] spendCredits FAILED (결과는 반환):`, e.message);
        }
      }
    }

    // 실비 계측 로깅(usage_logs) — 기능·모델별 원가 대시보드의 데이터 소스(2026-07-02 지혈 결정).
    try {
      if (supa.isEnabled() && typeof supa.recordUsage === "function") {
        await supa.recordUsage({
          userId: userInfo.id,
          jobId: `${spec.feature}-${Date.now()}`,
          textCostUsd: pricing.calcCost
            ? pricing.calcCost({ usage: usage || {}, model }).total
            : 0,
          meta: { feature: spec.feature, model, byok: byokActive, creditsCharged },
        });
      }
    } catch (e) {
      console.warn(`[${spec.feature}] usage log 실패:`, e.message);
    }

    return res.json({
      ok: true,
      result,
      model,
      creditsCharged,
      newBalance,
      byok: byokActive,
    });
  };
}

module.exports = {
  STUDIO_MODELS,
  DEFAULT_MODEL,
  availableModels,
  modelConfigured,
  anthropicConfigured,
  resolveModel,
  extractJsonBlock,
  callModelJson,
  createStudioHandler,
};
