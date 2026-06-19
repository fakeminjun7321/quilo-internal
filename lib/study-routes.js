const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const rateLimit = require("./rate-limit");
const { toOpenAiContent } = require("./model-call");
const {
  prepareImageForAnthropic,
  toAnthropicImageBlock,
  describePreparedImage,
} = require("./anthropic-media");

const FEATURE_KEY = "relativity-study";
const DEFAULT_MODEL = process.env.STUDY_RELATIVITY_MODEL || "auto";
const GPT_BASE = (process.env.GPT_API_BASE || "https://api.openai.com/v1").replace(/\/+$/, "");
const GPT_REASONING_EFFORT = process.env.STUDY_RELATIVITY_GPT_REASONING_EFFORT || "low";
const MAX_TOKENS = parseInt(process.env.STUDY_RELATIVITY_MAX_TOKENS || "2400", 10);
const MAX_DESCRIPTION_CHARS = 5000;

const STUDY_MODELS = [
  { id: "auto", label: "자동 선택", provider: "auto" },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
];
const ALLOWED_MODEL_IDS = new Set(STUDY_MODELS.map((m) => m.id));
const DEFAULT_AUTO_LADDER = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "claude-sonnet-4-6", "claude-opus-4-8"];
const AUTO_LADDER = String(process.env.STUDY_RELATIVITY_AUTO_MODELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => ALLOWED_MODEL_IDS.has(s) && s !== "auto");
const EFFECTIVE_AUTO_LADDER = AUTO_LADDER.length ? AUTO_LADDER : DEFAULT_AUTO_LADDER;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.STUDY_RELATIVITY_IMAGE_MAX_MB || "12", 10) * 1024 * 1024,
    files: 1,
    parts: 8,
  },
});

const SYSTEM_PROMPT = `당신은 특수상대론 문제를 민코프스키 평면 그림 명세로 바꾸는 한국어 학습 보조 AI입니다.

반드시 JSON 객체 하나만 출력하세요. Markdown, 코드펜스, SVG, HTML, 설명 문단을 JSON 밖에 쓰면 안 됩니다.

목표:
- 사용자가 올린 문제 사진 또는 상황 설명을 읽고, 브라우저 Canvas가 그릴 수 있는 도식 명세를 만듭니다.
- 실제 그림은 서버/AI가 그리지 않습니다. 좌표, 사건, 세계선, 주석, 설명만 구조화합니다.
- 좌표계는 c=1, 가로축 x, 세로축 ct 입니다.

데이터 무결성:
- 문제에 숫자, 좌표, 속도, 시간, 거리 조건이 없으면 값을 지어내지 마세요.
- 그림 설명을 위해 임시 좌표가 필요하면 보기 좋은 정성적 좌표를 쓰되 assumptions에 "도식용 임시 좌표"라고 명시하세요.
- beta(v/c)는 명시된 값이 있으면 -0.95~0.95 범위로 넣고, 없으면 0.5를 기본 도식값으로 쓰되 assumptions에 적으세요.
- eta는 beta가 있으면 atanh(beta) 값으로 계산해 넣으세요.
- 사건/세계선 라벨은 짧은 한국어 또는 표준 기호(A, B, O, P 등)로 씁니다.
- 사용자가 "뮤온", "muon", "길이 수축", "시간 지연"처럼 정성적 상황만 말해도 오류를 내지 말고 도식용 좌표를 만들어 설명하세요.
- 예: "뮤온 입자가 떨어지고 있는 상황에서 뮤온 frame에서 길이 수축"이면 대기권 진입/지면 도달 사건, 지구계의 지면 세계선, 뮤온 세계선, 뮤온계의 짧아진 지구-대기 거리 해석을 포함하세요. 속도가 없으면 beta=0.5 도식값을 쓰고 assumptions에 적으세요.
- 그림은 "딱 보고 이해되는" 최소 도식이어야 합니다. 핵심 사건 2~4개, 핵심 세계선 2~4개만 쓰고 불필요한 빛 신호·보조선·장식 라벨을 만들지 마세요.
- 가능한 한 x>=0, ct>=0인 1사분면 도식으로 배치하세요. 원점은 입자 생성/출발 사건, 고정된 지면·벽·관찰자는 x=상수인 세로 세계선으로 두세요.
- 뮤온 길이수축 도식은 수치가 없으면 beta=0.6, 지구계 고유거리 D0=10, 뮤온계 수축거리 D0/gamma=8을 보기용 좌표로 사용해도 됩니다. 이 경우 assumptions에 "도식용 값"이라고 명시하세요.
- 첨부 예시처럼 x', ct' 축과 지면/도착 사건이 한눈에 보이게 배치하세요. 긴 계산 설명 대신 점·선·거리의 의미가 보이게 하세요.
- x', ct' 좌표축은 브라우저가 렌더링 모드에 맞춰 직접 그립니다. worldlines 안에 x'축, ct'축, 좌표축, axis를 넣지 마세요.
- 뮤온 길이수축 예시는 원점 O=(0,0), 대기 상단/생성 위치 x=0, 지면 worldline x=10, 지면 도달 사건 E=(10,8)처럼 오른쪽 위로 진행하는 도식으로 두세요.
- explanation은 그래프 바로 아래에 붙는 캡션입니다. 1~2문장, 160자 이내로 축/사건/세계선의 핵심 의미만 쓰세요.
- annotations는 그래프 안에 직접 표시되는 라벨입니다. 꼭 필요한 것만 3개 이내로, 매우 짧게 쓰세요.
- assumptions와 warnings는 실제로 필요한 항목만 넣고, "없음" 같은 항목은 쓰지 마세요.

출력 스키마:
{
  "title": "짧은 제목",
  "beta": 0.5,
  "eta": 0.5493,
  "events": [
    { "id": "A", "label": "사건 A", "x": 1.0, "t": 2.0, "color": "#0f9d6b" }
  ],
  "worldlines": [
    {
      "id": "observer",
      "label": "관찰자",
      "color": "#2563eb",
      "points": [{ "x": 0, "t": -3 }, { "x": 0, "t": 3 }]
    }
  ],
  "annotations": [
    { "label": "빛 신호", "x": 2, "t": 2, "color": "#d4453f" }
  ],
  "explanation": "그래프 아래에 붙일 1~2문장 한국어 캡션",
  "assumptions": ["문제에서 속도가 명시되지 않아 beta=0.5를 도식값으로 사용"],
  "warnings": []
}

세계선은 points 두 개 이상으로 표현하세요. 빛은 기울기 ±1 선분으로 표현합니다.`;

function gptKey() {
  return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY || "";
}

function modelInfo(id) {
  return STUDY_MODELS.find((m) => m.id === id) || null;
}

function providerAvailable(provider) {
  if (provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  if (provider === "openai") return !!gptKey();
  if (provider === "auto") return EFFECTIVE_AUTO_LADDER.some((id) => {
    const m = modelInfo(id);
    return m && providerAvailable(m.provider);
  });
  return false;
}

function availableModelPayload() {
  return STUDY_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    available: providerAvailable(m.provider),
  }));
}

function resolveRequestedModel(value) {
  const requested = String(value || DEFAULT_MODEL || "auto").trim();
  return ALLOWED_MODEL_IDS.has(requested) ? requested : "auto";
}

function candidateModels(requested) {
  if (requested === "auto") {
    return EFFECTIVE_AUTO_LADDER.filter((id) => {
      const m = modelInfo(id);
      return m && providerAvailable(m.provider);
    });
  }
  const m = modelInfo(requested);
  if (!m || !providerAvailable(m.provider)) return [];
  return [requested];
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeColor(value, fallback) {
  const s = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI가 빈 응답을 반환했습니다.");
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("AI 응답에서 JSON 객체를 찾지 못했습니다.");
  }
}

function normalizePoint(point, fallback = { x: 0, t: 0 }) {
  return {
    x: clamp(finiteOr(point && point.x, fallback.x), -20, 20),
    t: clamp(finiteOr(point && point.t, fallback.t), -20, 20),
  };
}

function isCoordinateAxisWorldline(wl) {
  const s = `${wl && wl.id ? wl.id : ""} ${wl && wl.label ? wl.label : ""}`.toLowerCase();
  return /(x['′]\s*축|ct['′]\s*축|xprime|ctprime|xp_axis|ctp_axis|coordinate axis|좌표축)/i.test(s);
}

function sanitizeSpec(input) {
  const src = input && typeof input === "object" ? input : {};
  const beta = clamp(finiteOr(src.beta, 0.5), -0.95, 0.95);
  const eta = Number.isFinite(Number(src.eta))
    ? clamp(Number(src.eta), -3, 3)
    : Math.atanh(beta);

  const events = Array.isArray(src.events)
    ? src.events.slice(0, 8).map((ev, idx) => ({
        id: safeText(ev.id || `E${idx + 1}`, 32) || `E${idx + 1}`,
        label: safeText(ev.label || ev.id || `사건 ${idx + 1}`, 44),
        ...normalizePoint(ev),
        color: normalizeColor(ev.color, "#0f9d6b"),
      }))
    : [];

  const worldlines = Array.isArray(src.worldlines)
    ? src.worldlines.filter((wl) => !isCoordinateAxisWorldline(wl)).slice(0, 4).map((wl, idx) => {
        const rawPoints = Array.isArray(wl.points) ? wl.points : [];
        const points = rawPoints.slice(0, 8).map((p) => normalizePoint(p));
        if (points.length < 2) {
          points.push({ x: 0, t: -3 }, { x: 0, t: 3 });
        }
        return {
          id: safeText(wl.id || `W${idx + 1}`, 32) || `W${idx + 1}`,
          label: safeText(wl.label || wl.id || `세계선 ${idx + 1}`, 48),
          color: normalizeColor(wl.color, idx % 2 ? "#6b7280" : "#2563eb"),
          points,
        };
      })
    : [];

  const annotations = Array.isArray(src.annotations)
    ? src.annotations.slice(0, 3).map((a, idx) => ({
        label: safeText(a.label || `주석 ${idx + 1}`, 48),
        ...normalizePoint(a),
        color: normalizeColor(a.color, "#64748b"),
      }))
    : [];

  return {
    title: safeText(src.title || "민코프스키 평면", 80) || "민코프스키 평면",
    beta,
    eta,
    events,
    worldlines,
    annotations,
    explanation: safeText(src.explanation, 260),
    assumptions: Array.isArray(src.assumptions)
      ? src.assumptions.map((x) => safeText(x, 200)).filter(Boolean).slice(0, 4)
      : [],
    warnings: Array.isArray(src.warnings)
      ? src.warnings.map((x) => safeText(x, 200)).filter(Boolean).slice(0, 4)
      : [],
  };
}

async function callAnthropicModel(model, content) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  }
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 90 * 1000,
  });
  const msg = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  return (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function postGpt(body) {
  const resp = await fetch(`${GPT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gptKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await resp.text();
  if (!resp.ok) {
    const err = new Error(`OpenAI ${resp.status}: ${raw.slice(0, 300)}`);
    err.status = resp.status;
    err.raw = raw;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI 응답을 해석할 수 없습니다: ${raw.slice(0, 200)}`);
  }
  return (((json.choices || [])[0] || {}).message || {}).content || "";
}

async function callGptModel(model, content) {
  if (!gptKey()) {
    throw new Error("GPT_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다.");
  }
  const messages = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        "\n\n[GPT 전용 추가 규칙]\nresponse_format=json_object를 사용합니다. 출력은 반드시 유효한 JSON 객체 하나여야 합니다.",
    },
    { role: "user", content: toOpenAiContent(content) },
  ];
  const body = {
    model,
    messages,
    max_completion_tokens: Math.max(MAX_TOKENS, 4000),
    reasoning_effort: GPT_REASONING_EFFORT,
    response_format: { type: "json_object" },
  };
  try {
    return await postGpt(body);
  } catch (e) {
    if (e.status === 400 && /response_format|json_object/i.test(e.raw || e.message || "")) {
      const retryBody = { ...body };
      delete retryBody.response_format;
      return await postGpt(retryBody);
    }
    throw e;
  }
}

async function callModel(model, content) {
  const info = modelInfo(model);
  if (!info) throw new Error(`지원하지 않는 모델입니다: ${model}`);
  if (info.provider === "openai") return callGptModel(model, content);
  if (info.provider === "anthropic") return callAnthropicModel(model, content);
  throw new Error(`지원하지 않는 provider입니다: ${info.provider}`);
}

module.exports = function studyRouter(deps = {}) {
  const { requireBeta, getSessionUser } = deps;
  if (typeof requireBeta !== "function") {
    throw new Error("study-routes: requireBeta 의존성이 필요합니다.");
  }
  const sessionUser = typeof getSessionUser === "function" ? getSessionUser : () => null;

  const r = express.Router();

  r.get("/relativity/models", requireBeta(FEATURE_KEY), (_req, res) => {
    res.json({
      defaultModel: ALLOWED_MODEL_IDS.has(DEFAULT_MODEL) ? DEFAULT_MODEL : "auto",
      models: availableModelPayload(),
      autoLadder: EFFECTIVE_AUTO_LADDER,
    });
  });

  r.post(
    "/relativity/analyze",
    requireBeta(FEATURE_KEY),
    upload.single("image"),
    async (req, res) => {
      const description = String(req.body.description || "")
        .trim()
        .slice(0, MAX_DESCRIPTION_CHARS);
      const modeHint = String(req.body.modeHint || "").trim().slice(0, 60);
      const requestedModel = resolveRequestedModel(req.body.model);
      const file = req.file || null;
      if (!description && !file) {
        return res.status(400).json({ error: "상황 설명을 쓰거나 문제 사진을 올려 주세요." });
      }
      if (!ALLOWED_MODEL_IDS.has(requestedModel)) {
        return res.status(400).json({ error: "지원하지 않는 모델입니다." });
      }
      const candidates = candidateModels(requestedModel);
      if (!candidates.length) {
        return res.status(503).json({
          error:
            requestedModel === "auto"
              ? "사용 가능한 AI 모델 키가 서버에 설정되지 않았습니다."
              : "선택한 모델의 API 키가 서버에 설정되지 않았습니다.",
          models: availableModelPayload(),
        });
      }

      const content = [];
      const imageNotes = [];
      if (file) {
        const prepared = await prepareImageForAnthropic(
          {
            buffer: file.buffer,
            name: file.originalname,
            mimetype: file.mimetype,
          },
          { maxEdge: 1800 },
        );
        if (!prepared.ok) {
          return res.status(400).json({ error: prepared.reason || "이미지를 처리하지 못했습니다." });
        }
        imageNotes.push(describePreparedImage(prepared));
        content.push(toAnthropicImageBlock(prepared));
      }
      content.push({
        type: "text",
        text: [
          "[사용자 상황 설명]",
          description || "(텍스트 설명 없음. 첨부 이미지에서 문제를 읽어야 함.)",
          "",
          `[선호 렌더링 모드] ${modeHint || "사용자가 화면에서 선택함"}`,
          imageNotes.length ? `[첨부 이미지] ${imageNotes.join(", ")}` : "",
          "",
          "위 내용을 민코프스키 평면 JSON 명세로 변환하세요.",
        ]
          .filter(Boolean)
          .join("\n"),
      });

      const u = sessionUser(req);
      if (u && u.id && !u.isAdmin) rateLimit.recordBetaUsage(u.id, FEATURE_KEY);

      try {
        const failures = [];
        for (const model of candidates) {
          try {
            const text = await callModel(model, content);
            const parsed = extractJson(text);
            const out = sanitizeSpec(parsed);
            const info = modelInfo(model);
            out.model = model;
            out.modelLabel = info ? info.label : model;
            if (failures.length) {
              out.warnings.push(
                `자동 선택 중 ${failures.length}개 모델 실패 후 ${out.modelLabel}로 생성했습니다.`,
              );
            }
            return res.json(out);
          } catch (e) {
            failures.push(`${model}: ${e.message || e}`);
            if (requestedModel !== "auto") throw e;
          }
        }
        throw new Error(failures.join(" | "));
      } catch (e) {
        console.error("[study relativity]", e && e.stack ? e.stack : e);
        return res.status(502).json({
          error: "AI가 민코프스키 도식 JSON을 만들지 못했습니다. 다른 모델을 선택하거나 설명을 조금 더 구체적으로 써 주세요.",
        });
      }
    },
  );

  return r;
};
