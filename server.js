require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { generateReportContent } = require("./lib/claude");
const { generateDocx } = require("./lib/docx-generator");
const { fmtUSD, fmtKRW, fmtTokens, formatImageCostLine } = require("./lib/pricing");

const app = express();
const PORT = process.env.PORT || 3000;
const SHARED_PASSWORD = process.env.SHARED_PASSWORD || "changeme";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Hard timeout for a single generation job (default 8 minutes)
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || String(8 * 60 * 1000), 10);

// ── Middleware ───────────────────────────────────────────────────────────────

app.set("trust proxy", 1);
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 12, // 12h
      sameSite: "lax",
    },
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ── Auth helpers ─────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.accepts("json") && req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  return res.redirect("/login.html");
}

// ── Cumulative usage tracker (in-memory, reset on server restart) ────────────
const totalUsage = {
  jobs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchCount: 0,
  textUSD: 0,
  imageSearchCount: 0,
  imageGenCount: 0,
  imageUSD: 0,
  totalUSD: 0,
  startedAt: Date.now(),
};

function addToTotal(cost, imageCost) {
  totalUsage.jobs += 1;
  if (cost) {
    totalUsage.inputTokens += cost.inputTokens || 0;
    totalUsage.outputTokens += cost.outputTokens || 0;
    totalUsage.cacheReadTokens += cost.cacheReadTokens || 0;
    totalUsage.cacheWriteTokens += cost.cacheWriteTokens || 0;
    totalUsage.webSearchCount += cost.webSearchCount || 0;
    totalUsage.textUSD += cost.total || 0;
    totalUsage.totalUSD += cost.total || 0;
  }
  if (imageCost) {
    totalUsage.imageSearchCount += imageCost.searchCount || 0;
    totalUsage.imageGenCount += imageCost.generationCount || 0;
    totalUsage.imageUSD += imageCost.total || 0;
    totalUsage.totalUSD += imageCost.total || 0;
  }
}

// ── Job storage (in-memory) ──────────────────────────────────────────────────
//
// Each job tracks:
//   { user, status: 'running'|'done'|'error', progress: [str], result?: Buffer,
//     filename?: str, error?: str, listeners: [res], createdAt }
//
const jobs = new Map();

function createJob(user) {
  const id = crypto.randomBytes(12).toString("hex");
  const job = {
    id,
    user,
    status: "running",
    progress: [],
    result: null,
    filename: null,
    error: null,
    listeners: [],
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function pushProgress(job, msg) {
  const stamp = new Date().toISOString().slice(11, 19);
  const line = `[${stamp}] ${msg}`;
  job.progress.push(line);
  console.log(`[job ${job.id}] ${line}`);
  job.listeners.forEach((res) => sendSse(res, "progress", line));
}

function sendSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Cleanup old jobs hourly
setInterval(
  () => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of jobs.entries()) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  },
  10 * 60 * 1000,
);

// ── Routes ───────────────────────────────────────────────────────────────────

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "이름과 비밀번호를 입력하세요." });
  }
  if (password !== SHARED_PASSWORD) {
    return res.status(401).json({ error: "비밀번호가 틀렸습니다." });
  }
  req.session.user = String(username).trim().slice(0, 50);
  console.log(`[login] ${req.session.user}`);
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: "not logged in" });
  }
});

// Start a generation job. Returns job id immediately, work runs async.
app.post("/api/generate", requireAuth, upload.single("manual"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "실험 매뉴얼 PDF를 업로드하세요." });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "PDF 파일만 업로드 가능합니다." });
  }

  const date = (req.body.date || "").trim();
  const useImages = String(req.body.useImages || "0") === "1";
  const manualFilename = req.file.originalname || "";
  const job = createJob(req.session.user);

  res.json({ jobId: job.id });

  // Run async — don't await here
  runGeneration(job, req.file.buffer, date, useImages, manualFilename).catch((err) => {
    job.status = "error";
    job.error = err.message || String(err);
    pushProgress(job, `❌ 오류: ${job.error}`);
    job.listeners.forEach((r) => {
      sendSse(r, "error", job.error);
      r.end();
    });
    job.listeners = [];
  });
});

// 매뉴얼 파일명에서 첫 번째 숫자 그룹을 추출 (예: "I-08_Synthe..." -> "08")
function extractManualNumber(filename) {
  if (!filename) return "";
  const m = String(filename).match(/(\d{1,3})/);
  return m ? m[1] : "";
}

function sanitizeForFilename(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 30);
}

async function runGeneration(job, pdfBuffer, date, useImages = false, manualFilename = "") {
  const t0 = Date.now();
  const timeoutMin = Math.round(JOB_TIMEOUT_MS / 60000);
  pushProgress(
    job,
    `🚀 작업 시작 (timeout: ${timeoutMin}분, 이미지: ${useImages ? "ON" : "OFF"})`,
  );

  // ── Hard timeout via AbortController ──
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    pushProgress(job, `⏰ ${timeoutMin}분 초과 — 강제 종료 중...`);
    ac.abort();
  }, JOB_TIMEOUT_MS);

  try {
    const content = await generateReportContent({
      pdfBuffer,
      date,
      signal: ac.signal,
      useImages,
      onProgress: (msg) => pushProgress(job, msg),
    });

    pushProgress(job, "📄 .docx 파일 빌드 중...");
    const tDocxStart = Date.now();
    const buffer = await generateDocx(content);
    const docxSec = Math.floor((Date.now() - tDocxStart) / 1000);
    const sizeKB = Math.round(buffer.length / 1024);
    pushProgress(job, `✓ .docx 빌드 완료 (${sizeKB}KB, ${docxSec}초)`);

    // 파일명: "08_사전_학번_(이름).docx" 형식
    // - 숫자: 매뉴얼 파일명에서 추출 (없으면 빈 문자열)
    // - 학번: placeholder 그대로 (사용자가 다운로드 후 직접 수정)
    // - 이름: 로그인 시 입력한 사용자명
    const num = extractManualNumber(manualFilename);
    const userName = sanitizeForFilename(job.user || "");
    const prefix = num ? `${num}_` : "";
    const namePart = userName ? `_(${userName})` : "";
    job.result = buffer;
    job.filename = `${prefix}사전_학번${namePart}.docx`;
    job.status = "done";

    const totalSec = Math.floor((Date.now() - t0) / 1000);
    pushProgress(job, `🎉 전체 완료! 총 ${totalSec}초 소요. 다운로드 가능합니다.`);

    // Per-job image cost line (separate from text cost)
    if (content.__imageCost) {
      const imgLine = formatImageCostLine(content.__imageCost);
      if (imgLine) pushProgress(job, imgLine);
    }

    // Accumulate cost into server-wide total
    addToTotal(content.__cost, content.__imageCost);
    pushProgress(
      job,
      `📊 서버 누적: ${totalUsage.jobs}건 / 총 ${fmtUSD(totalUsage.totalUSD)} ${fmtKRW(totalUsage.totalUSD)} ` +
        `(텍스트 ${fmtUSD(totalUsage.textUSD)}, 이미지 ${fmtUSD(totalUsage.imageUSD)})`,
    );
  } catch (e) {
    if (timedOut) {
      const elapsedMin = Math.floor((Date.now() - t0) / 60000);
      throw new Error(
        `${timeoutMin}분 timeout으로 작업이 강제 종료되었습니다 (실제 ${elapsedMin}분 경과). ` +
          `매뉴얼이 너무 복잡하거나 Claude API 응답이 느렸을 수 있습니다. 더 짧은 매뉴얼로 다시 시도하거나 재시도해주세요.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  job.listeners.forEach((r) => {
    sendSse(r, "done", { filename: job.filename });
    r.end();
  });
  job.listeners = [];
}

// SSE stream for a job
app.get("/api/jobs/:id/stream", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  if (job.user !== req.session.user) return res.status(403).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Replay buffered progress
  job.progress.forEach((p) => sendSse(res, "progress", p));

  if (job.status === "done") {
    sendSse(res, "done", { filename: job.filename });
    return res.end();
  }
  if (job.status === "error") {
    sendSse(res, "error", job.error);
    return res.end();
  }

  job.listeners.push(res);
  req.on("close", () => {
    job.listeners = job.listeners.filter((r) => r !== res);
  });
});

// Download generated docx
app.get("/api/jobs/:id/download", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send("작업을 찾을 수 없습니다.");
  if (job.user !== req.session.user) return res.status(403).send("권한 없음");
  if (job.status !== "done" || !job.result) {
    return res.status(409).send("아직 완료되지 않았습니다.");
  }
  res.set({
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
    "Content-Length": job.result.length,
  });
  res.send(job.result);
});

// Static files (login.html, index.html)
app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    index: false,
  }),
);

// Root → login or main depending on session
app.get("/", (req, res) => {
  if (req.session && req.session.user) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  res.redirect("/login.html");
});

// Health check (Render uses this to keep service awake or detect liveness)
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Usage stats (logged-in users only)
app.get("/api/usage", requireAuth, (req, res) => {
  const uptimeHours = ((Date.now() - totalUsage.startedAt) / 3600000).toFixed(1);
  res.json({
    ...totalUsage,
    uptimeHours,
    totalUSDFormatted: fmtUSD(totalUsage.totalUSD),
    totalKRWFormatted: fmtKRW(totalUsage.totalUSD),
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`▶ chem-pre-lab-web listening on :${PORT}`);
  if (SHARED_PASSWORD === "changeme") {
    console.warn("⚠ SHARED_PASSWORD가 기본값입니다. .env에서 설정하세요.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠ ANTHROPIC_API_KEY가 없습니다. .env에서 설정하세요.");
  }
});
