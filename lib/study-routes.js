const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const rateLimit = require("./rate-limit");
const {
  prepareImageForAnthropic,
  toAnthropicImageBlock,
  describePreparedImage,
} = require("./anthropic-media");

const FEATURE_KEY = "relativity-study";
const MODEL = process.env.STUDY_RELATIVITY_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = parseInt(process.env.STUDY_RELATIVITY_MAX_TOKENS || "2400", 10);
const MAX_DESCRIPTION_CHARS = 5000;

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
- 실제 그림은 서버/Claude가 그리지 않습니다. 좌표, 사건, 세계선, 주석, 설명만 구조화합니다.
- 좌표계는 c=1, 가로축 x, 세로축 ct 입니다.

데이터 무결성:
- 문제에 숫자, 좌표, 속도, 시간, 거리 조건이 없으면 값을 지어내지 마세요.
- 그림 설명을 위해 임시 좌표가 필요하면 보기 좋은 정성적 좌표를 쓰되 assumptions에 "도식용 임시 좌표"라고 명시하세요.
- beta(v/c)는 명시된 값이 있으면 -0.95~0.95 범위로 넣고, 없으면 0.5를 기본 도식값으로 쓰되 assumptions에 적으세요.
- eta는 beta가 있으면 atanh(beta) 값으로 계산해 넣으세요.
- 사건/세계선 라벨은 짧은 한국어 또는 표준 기호(A, B, O, P 등)로 씁니다.

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
  "explanation": "그림을 어떻게 읽으면 되는지 3~5문장 한국어 설명",
  "assumptions": ["문제에서 속도가 명시되지 않아 beta=0.5를 도식값으로 사용"],
  "warnings": []
}

세계선은 points 두 개 이상으로 표현하세요. 빛은 기울기 ±1 선분으로 표현합니다.`;

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
  if (!raw) throw new Error("Claude가 빈 응답을 반환했습니다.");
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("Claude 응답에서 JSON 객체를 찾지 못했습니다.");
  }
}

function normalizePoint(point, fallback = { x: 0, t: 0 }) {
  return {
    x: clamp(finiteOr(point && point.x, fallback.x), -20, 20),
    t: clamp(finiteOr(point && point.t, fallback.t), -20, 20),
  };
}

function sanitizeSpec(input) {
  const src = input && typeof input === "object" ? input : {};
  const beta = clamp(finiteOr(src.beta, 0.5), -0.95, 0.95);
  const eta = Number.isFinite(Number(src.eta))
    ? clamp(Number(src.eta), -3, 3)
    : Math.atanh(beta);

  const events = Array.isArray(src.events)
    ? src.events.slice(0, 24).map((ev, idx) => ({
        id: safeText(ev.id || `E${idx + 1}`, 32) || `E${idx + 1}`,
        label: safeText(ev.label || ev.id || `사건 ${idx + 1}`, 60),
        ...normalizePoint(ev),
        color: normalizeColor(ev.color, "#0f9d6b"),
      }))
    : [];

  const worldlines = Array.isArray(src.worldlines)
    ? src.worldlines.slice(0, 18).map((wl, idx) => {
        const rawPoints = Array.isArray(wl.points) ? wl.points : [];
        const points = rawPoints.slice(0, 16).map((p) => normalizePoint(p));
        if (points.length < 2) {
          points.push({ x: 0, t: -3 }, { x: 0, t: 3 });
        }
        return {
          id: safeText(wl.id || `W${idx + 1}`, 32) || `W${idx + 1}`,
          label: safeText(wl.label || wl.id || `세계선 ${idx + 1}`, 70),
          color: normalizeColor(wl.color, idx % 2 ? "#6b7280" : "#2563eb"),
          points,
        };
      })
    : [];

  const annotations = Array.isArray(src.annotations)
    ? src.annotations.slice(0, 20).map((a, idx) => ({
        label: safeText(a.label || `주석 ${idx + 1}`, 90),
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
    explanation: safeText(src.explanation, 1000),
    assumptions: Array.isArray(src.assumptions)
      ? src.assumptions.map((x) => safeText(x, 200)).filter(Boolean).slice(0, 8)
      : [],
    warnings: Array.isArray(src.warnings)
      ? src.warnings.map((x) => safeText(x, 200)).filter(Boolean).slice(0, 8)
      : [],
  };
}

module.exports = function studyRouter(deps = {}) {
  const { requireBeta, getSessionUser } = deps;
  if (typeof requireBeta !== "function") {
    throw new Error("study-routes: requireBeta 의존성이 필요합니다.");
  }
  const sessionUser = typeof getSessionUser === "function" ? getSessionUser : () => null;

  const r = express.Router();

  r.post(
    "/relativity/analyze",
    requireBeta(FEATURE_KEY),
    upload.single("image"),
    async (req, res) => {
      const description = String(req.body.description || "")
        .trim()
        .slice(0, MAX_DESCRIPTION_CHARS);
      const modeHint = String(req.body.modeHint || "").trim().slice(0, 60);
      const file = req.file || null;
      if (!description && !file) {
        return res.status(400).json({ error: "상황 설명을 쓰거나 문제 사진을 올려 주세요." });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: "Claude API 키가 서버에 설정되지 않았습니다." });
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
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          timeout: 90 * 1000,
        });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.1,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        });
        const text = (msg.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        return res.json(sanitizeSpec(extractJson(text)));
      } catch (e) {
        console.error("[study relativity]", e && e.stack ? e.stack : e);
        return res.status(502).json({
          error: "Claude가 민코프스키 도식 JSON을 만들지 못했습니다. 설명을 조금 더 구체적으로 쓰고 다시 시도해 주세요.",
        });
      }
    },
  );

  return r;
};
