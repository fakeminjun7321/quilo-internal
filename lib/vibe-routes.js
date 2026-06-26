// 바이브 코딩 생성기 — 아이디어 한 문장을 "실제로 만들 수 있는 프로젝트 설계"로 바꾼다.
//
// codex 가 만든 초기 버전은 AI 없이 템플릿으로 채우는 결정적 생성기였다. 이 라우터는
// 같은 입력(아이디어/분위기/영역/스코프/스택)을 받되 실제 모델(Claude/GPT)에게
// 추론을 시켜 아이디어에 특화된 설계·MVP·첫 작업·검증 루틴·학습 가이드를 만든다.
// 로그인 사용자 전용 + 모델별 크레딧 차감(ai-studio-core).

const express = require("express");
const { createStudioHandler, availableModels, DEFAULT_MODEL } = require("./ai-studio-core");

const MAX_IDEA = 2000;
const cap = (v, n) => String(v == null ? "" : v).slice(0, n).trim();

const SYSTEM_PROMPT = `당신은 "바이브 코딩"을 돕는 한국어 시니어 제품 엔지니어입니다.
사용자가 만들고 싶은 앱/사이트 아이디어 한 문장과 몇 가지 선택지를 주면, 그 아이디어에
**특화된** 실행 가능한 프로젝트 설계를 만듭니다. 일반론이 아니라 이 아이디어에서만 나올
구체적 화면·데이터·기능을 제시하세요.

[매우 중요한 출력 규칙]
- 출력은 **단 하나의 JSON 객체**만. JSON 앞뒤에 설명/인사/코드펜스 텍스트를 넣지 마세요.
- 모든 문자열은 한국어로. 기술 용어(React, localStorage, API 등)는 그대로 써도 됩니다.
- 빈 배열/빈 문자열을 남기지 말고 모든 필드를 의미 있게 채우세요.
- 과장·홍보 문구 금지. 실제로 코드를 짜기 시작할 수 있을 만큼 구체적으로.

[스코프 해석]
- "주말 프로젝트": 하루~이틀, 단일 화면 위주, 외부 의존성 최소.
- "MVP": 1~2주, 핵심 가치 1개를 끝까지.
- "정식 제품": 인증·저장·결제 등 실제 서비스 수준 고려.

[반드시 따를 JSON 스키마]
{
  "title": "프로젝트 이름(짧고 기억하기 쉬운 한국어/영문 혼용 가능)",
  "tagline": "한 줄 설명(무엇을, 누구를 위해)",
  "problem": "이 프로젝트가 해결하는 진짜 문제 2~3문장",
  "targetUser": "주 사용자와 그들의 상황",
  "mvp": [ { "feature": "MVP에 꼭 필요한 기능", "why": "왜 이게 핵심인지" } ],   // 3~5개
  "screens": [ { "name": "화면/뷰 이름", "purpose": "이 화면이 하는 일", "elements": ["주요 UI 요소"] } ], // 2~5개
  "modules": [ { "name": "코드 모듈/파일", "responsibility": "이 모듈의 책임" } ], // 3~6개
  "dataModel": [ { "entity": "데이터 객체", "fields": ["필드:타입"] } ],          // 1~4개
  "firstTasks": [ { "task": "지금 바로 시작할 작업", "detail": "구체적 실행 방법", "done": "완료 판단 기준" } ], // 4~7개, 의존 순서대로
  "stack": { "recommended": ["권장 스택(언어/프레임워크/저장소/배포)"], "rationale": "이 스택을 고른 이유" },
  "validation": ["만들면서 스스로 확인할 검증 루틴(테스트/수동 확인)"],            // 3~5개
  "risks": [ { "risk": "막힐 가능성이 큰 지점", "mitigation": "대처법" } ],         // 2~4개
  "variations": [ { "angle": "다른 각도", "idea": "이렇게 비틀면" } ],              // 2~3개
  "launchChecklist": ["출시 전 점검 항목"],                                        // 4~6개
  "buildReadiness": { "score": 0부터100사이정수, "reasons": ["점수 근거"] },
  "guideCards": [ { "title": "바이브 코딩 기본기 카드 제목", "body": "이 아이디어에 맞춘 실전 조언" } ], // 3~4개
  "aiPrompt": "이 프로젝트를 AI 코딩 도구(Claude Code/Cursor 등)에 그대로 붙여넣어 시작할 수 있는 잘 구조화된 작업 지시문(여러 줄, 한국어)"
}`;

const spec = {
  feature: "vibe-coding",
  maxTokens: 16000,
  parseInput(body) {
    const idea = cap(body.idea, MAX_IDEA);
    if (idea.length < 3) {
      throw new Error("만들고 싶은 아이디어를 한 문장 이상 적어 주세요.");
    }
    return {
      idea,
      mood: cap(body.mood, 80),
      area: cap(body.area, 80),
      scope: cap(body.scope, 80),
      stack: cap(body.stack, 120),
    };
  },
  buildSystem() {
    return SYSTEM_PROMPT;
  },
  buildUserText(input) {
    const lines = [
      `[아이디어]\n${input.idea}`,
      input.mood ? `[분위기/톤] ${input.mood}` : "",
      input.area ? `[영역/분야] ${input.area}` : "",
      input.scope ? `[스코프] ${input.scope}` : "",
      input.stack ? `[선호 스택] ${input.stack}` : "",
      "",
      "위 아이디어에 특화된 프로젝트 설계를 스키마대로 JSON 하나로만 출력하세요.",
    ];
    return lines.filter(Boolean).join("\n");
  },
  shapeResult(data) {
    // 방어적 정규화 — 배열 필드가 객체/문자열로 와도 깨지지 않게.
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    data.mvp = arr(data.mvp);
    data.screens = arr(data.screens);
    data.modules = arr(data.modules);
    data.dataModel = arr(data.dataModel);
    data.firstTasks = arr(data.firstTasks);
    data.validation = arr(data.validation);
    data.risks = arr(data.risks);
    data.variations = arr(data.variations);
    data.launchChecklist = arr(data.launchChecklist);
    data.guideCards = arr(data.guideCards);
    if (data.stack && !Array.isArray(data.stack.recommended)) {
      data.stack.recommended = arr(data.stack && data.stack.recommended);
    }
    if (data.buildReadiness) {
      let s = Math.round(Number(data.buildReadiness.score));
      if (!Number.isFinite(s)) s = 0;
      data.buildReadiness.score = Math.max(0, Math.min(100, s));
      data.buildReadiness.reasons = arr(data.buildReadiness.reasons);
    }
    return data;
  },
};

module.exports = function vibeRouter(deps = {}) {
  const { requireAuth, getSessionUser, refreshSessionUser, supa, pricing } = deps;
  if (typeof requireAuth !== "function")
    throw new Error("vibe-routes: requireAuth 의존성이 필요합니다.");

  const r = express.Router();

  // 모델 목록·단가 (셀렉터용). 로그인 불필요.
  r.get("/config", (_req, res) => {
    res.json({ models: availableModels(pricing), defaultModel: DEFAULT_MODEL });
  });

  r.post(
    "/generate",
    requireAuth,
    createStudioHandler(spec, { getSessionUser, refreshSessionUser, supa, pricing }),
  );

  return r;
};

module.exports._spec = spec;
