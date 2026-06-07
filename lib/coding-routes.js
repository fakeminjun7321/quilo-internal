// 코딩 테스트(정보 수행평가 대비) API — server.js 를 거의 건드리지 않도록 별도 모듈.
// 마운트: app.use("/api/coding", require("./lib/coding-routes")({ requireAdminOrBeta }))
//
// 베타 게이트("coding-test"): 관리자 또는 지정 베타테스터만 접근. 일일 한도 없음
// (Claude 호출이 없어 비용이 들지 않음 — Quilo Code 와 동일 정책).
//
// 채점은 전적으로 브라우저(Pyodide)에서 이뤄진다. 서버는 문제 본문/테스트와
// 채점 하니스(harness.py)를 내려주기만 한다.

const express = require("express");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "coding", "problems.json");
const HARNESS_PATH = path.join(__dirname, "coding", "harness.py");

function loadData() {
  // 운영 중에는 파일이 안 바뀌므로 1회만 읽어 캐시한다.
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (e) {
    return { version: 0, weeks: {}, problems: [] };
  }
}

module.exports = function codingRouter(deps = {}) {
  const { requireAdminOrBeta } = deps;
  if (typeof requireAdminOrBeta !== "function") {
    throw new Error("coding-routes: requireAdminOrBeta 의존성이 필요합니다.");
  }

  const r = express.Router();
  const gate = requireAdminOrBeta("coding-test");
  const data = loadData();
  const harnessText = (() => {
    try {
      return fs.readFileSync(HARNESS_PATH, "utf8");
    } catch {
      return "";
    }
  })();
  const byId = new Map(data.problems.map((p) => [p.id, p]));

  // 문제 목록(본문/테스트 제외 — '제목만 먼저')
  r.get("/problems", gate, (_req, res) => {
    res.json({
      version: data.version,
      weeks: data.weeks,
      problems: data.problems.map((p) => ({
        id: p.id,
        week: p.week,
        title: p.title,
        difficulty: p.difficulty,
        tags: p.tags || [],
        summary: p.summary || "",
      })),
    });
  });

  // 문제 상세(본문 + 테스트). 테스트에는 브라우저 채점을 위해 기대출력이 포함된다.
  r.get("/problem/:id", gate, (req, res) => {
    const p = byId.get(String(req.params.id));
    if (!p) return res.status(404).json({ error: "없는 문제입니다." });
    res.json(p);
  });

  // 채점 하니스(파이썬). 브라우저가 Pyodide 에 주입해 사용한다.
  r.get("/harness.py", gate, (_req, res) => {
    if (!harnessText)
      return res.status(500).json({ error: "하니스를 불러오지 못했습니다." });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(harnessText);
  });

  return r;
};
