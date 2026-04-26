require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { generateReportContent } = require("./lib/claude");
const { generateDocx } = require("./lib/docx-generator");
const {
  fmtUSD,
  fmtKRW,
  fmtTokens,
  formatImageCostLine,
} = require("./lib/pricing");
const supa = require("./lib/supabase");
const { krwToUsd, usdToKrw, getKrwPerUsd } = require("./lib/exchange-rate");
const rateLimit = require("./lib/rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const SHARED_PASSWORD = process.env.SHARED_PASSWORD || "changeme";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Hard timeout for a single generation job (default 8 minutes)
const JOB_TIMEOUT_MS = parseInt(
  process.env.JOB_TIMEOUT_MS || String(8 * 60 * 1000),
  10,
);

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
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Auth helpers ─────────────────────────────────────────────────────────────

function getSessionUser(req) {
  return req.session && req.session.userInfo ? req.session.userInfo : null;
}

function requireAuth(req, res, next) {
  if (getSessionUser(req)) return next();
  if (req.accepts("json") && req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  return res.redirect("/login.html");
}

function requireAdmin(req, res, next) {
  const u = getSessionUser(req);
  if (!u) return res.status(401).json({ error: "로그인이 필요합니다." });
  if (!u.isAdmin) return res.status(403).json({ error: "관리자만 접근 가능합니다." });
  next();
}

// ── In-memory cumulative usage (server uptime-only; DB는 별도) ──────────────
const totalUsage = {
  jobs: 0,
  textUSD: 0,
  imageUSD: 0,
  totalUSD: 0,
  startedAt: Date.now(),
};

function addToTotal(cost, imageCost) {
  totalUsage.jobs += 1;
  if (cost) {
    totalUsage.textUSD += cost.total || 0;
    totalUsage.totalUSD += cost.total || 0;
  }
  if (imageCost) {
    totalUsage.imageUSD += imageCost.total || 0;
    totalUsage.totalUSD += imageCost.total || 0;
  }
}

// ── Job storage (in-memory) ──────────────────────────────────────────────────
const jobs = new Map();

function createJob(userInfo) {
  const id = crypto.randomBytes(12).toString("hex");
  const job = {
    id,
    userInfo, // { id?, name, isAdmin }
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

setInterval(
  () => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of jobs.entries()) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  },
  10 * 60 * 1000,
);

// ── Login routes ─────────────────────────────────────────────────────────────

app.post("/api/login", async (req, res) => {
  // 브루트포스 방어: 동일 IP에서 분당 10회 초과 시 차단
  const ip = req.ip || "unknown";
  const limit = rateLimit.checkLoginLimit(ip);
  if (!limit.allowed) {
    return res.status(429).json({
      error: `로그인 시도가 너무 많습니다 (분당 ${rateLimit.LOGIN_LIMIT}회 제한). 1분 후 다시 시도하세요.`,
    });
  }
  rateLimit.recordLoginAttempt(ip);

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "이름과 비밀번호를 입력하세요." });
  }
  const name = String(username).trim().slice(0, 50);

  try {
    if (supa.isEnabled()) {
      // DB 인증 모드
      const user = await supa.authenticate(name, password);
      if (!user) {
        return res.status(401).json({ error: "이름 또는 비밀번호가 틀렸습니다." });
      }
      req.session.userInfo = {
        id: user.id,
        name: user.name,
        isAdmin: !!user.is_admin,
      };
      console.log(`[login] ${user.name} (admin=${user.is_admin})`);
      return res.json({
        ok: true,
        user: user.name,
        isAdmin: !!user.is_admin,
      });
    } else {
      // Legacy 공용 비밀번호 모드 (Supabase 미설정 시)
      if (password !== SHARED_PASSWORD) {
        return res.status(401).json({ error: "비밀번호가 틀렸습니다." });
      }
      req.session.userInfo = { name, isAdmin: false };
      console.log(`[login] ${name} (legacy)`);
      return res.json({ ok: true, user: name, isAdmin: false });
    }
  } catch (e) {
    console.error("[login] error:", e);
    return res.status(500).json({ error: "로그인 처리 중 오류: " + e.message });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  const u = getSessionUser(req);
  if (u) {
    res.json({ user: u.name, isAdmin: !!u.isAdmin });
  } else {
    res.status(401).json({ error: "not logged in" });
  }
});

// ── Generate route ───────────────────────────────────────────────────────────

app.post(
  "/api/generate",
  requireAuth,
  upload.single("manual"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "실험 매뉴얼 PDF를 업로드하세요." });
    }
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "PDF 파일만 업로드 가능합니다." });
    }

    const userInfo = getSessionUser(req);

    // 시간당 사용 횟수 제한 (admin 제외, 일반 사용자만)
    if (!userInfo.isAdmin && userInfo.id) {
      const limit = rateLimit.checkUserGenLimit(userInfo.id);
      if (!limit.allowed) {
        const unlockTime = new Date(limit.unlockAt).toLocaleString("ko-KR", {
          dateStyle: "short",
          timeStyle: "short",
        });
        return res.status(429).json({
          error: `🚫 시간당 ${limit.limit}건 제한에 도달했습니다 (현재 ${limit.count}/${limit.limit}). ${unlockTime}부터 다시 사용 가능합니다. 더 필요하시면 관리자에게 잠금 해제를 요청하세요.`,
        });
      }
    }

    // 한도 검증 (Supabase enabled + 일반 사용자)
    if (supa.isEnabled() && userInfo.id && !userInfo.isAdmin) {
      try {
        const check = await supa.checkBudget(userInfo.id);
        if (!check.ok) {
          return res
            .status(402)
            .json({ error: "🚫 " + (check.reason || "한도 초과") });
        }
      } catch (e) {
        console.error("[budget] error:", e);
        return res.status(500).json({ error: "한도 확인 실패: " + e.message });
      }
    }

    const date = (req.body.date || "").trim();
    const useImages = String(req.body.useImages || "0") === "1";
    const manualFilename = req.file.originalname || "";
    // 사용자가 폼에서 선택한 모델. 화이트리스트 검증으로 임의 모델 주입 차단.
    const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-opus-4-7"];
    const requestedModel = String(req.body.model || "").trim();
    const model = ALLOWED_MODELS.includes(requestedModel) ? requestedModel : null;

    // 모든 검증 통과 — 일반 사용자는 rate limit 카운트 증가
    if (!userInfo.isAdmin && userInfo.id) {
      rateLimit.recordUserGenAttempt(userInfo.id);
    }

    const job = createJob(userInfo);

    res.json({ jobId: job.id });

    runGeneration(job, req.file.buffer, date, useImages, manualFilename, model).catch(
      (err) => {
        job.status = "error";
        job.error = err.message || String(err);
        pushProgress(job, `❌ 오류: ${job.error}`);
        job.listeners.forEach((r) => {
          sendSse(r, "error", job.error);
          r.end();
        });
        job.listeners = [];
      },
    );
  },
);

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

async function runGeneration(
  job,
  pdfBuffer,
  date,
  useImages = false,
  manualFilename = "",
  model = null,
) {
  const t0 = Date.now();
  const timeoutMin = Math.round(JOB_TIMEOUT_MS / 60000);
  pushProgress(
    job,
    `🚀 작업 시작 (timeout: ${timeoutMin}분, 이미지: ${useImages ? "ON" : "OFF"})`,
  );

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
      model,
      onProgress: (msg) => pushProgress(job, msg),
    });

    pushProgress(job, "📄 .docx 파일 빌드 중...");
    const tDocxStart = Date.now();
    const buffer = await generateDocx(content);
    const docxSec = Math.floor((Date.now() - tDocxStart) / 1000);
    const sizeKB = Math.round(buffer.length / 1024);
    pushProgress(job, `✓ .docx 빌드 완료 (${sizeKB}KB, ${docxSec}초)`);

    const num = extractManualNumber(manualFilename);
    const userName = sanitizeForFilename(job.userInfo?.name || "");
    const prefix = num ? `${num}_` : "";
    const namePart = userName ? `_${userName}` : "";
    job.result = buffer;
    job.filename = `${prefix}사전_학번${namePart}.docx`;
    job.status = "done";

    const totalSec = Math.floor((Date.now() - t0) / 1000);
    pushProgress(
      job,
      `🎉 전체 완료! 총 ${totalSec}초 소요. 다운로드 가능합니다.`,
    );

    if (content.__imageCost) {
      const imgLine = formatImageCostLine(content.__imageCost);
      if (imgLine) pushProgress(job, imgLine);
    }

    // Server-wide running total (in-memory)
    addToTotal(content.__cost, content.__imageCost);

    // DB 누적 (Supabase enabled + 일반 user)
    if (supa.isEnabled() && job.userInfo?.id) {
      try {
        await supa.recordUsage({
          userId: job.userInfo.id,
          jobId: job.id,
          textCostUsd: content.__cost?.total || 0,
          imageCostUsd: content.__imageCost?.total || 0,
          meta: {
            title: content.title_kr,
            inputTokens: content.__cost?.inputTokens,
            outputTokens: content.__cost?.outputTokens,
            webSearchCount: content.__cost?.webSearchCount,
            imageSearchCount: content.__imageCost?.searchCount,
            imageGenCount: content.__imageCost?.generationCount,
          },
        });

        // Refreshed user spent/budget
        const fresh = await supa.findUserById(job.userInfo.id);
        if (fresh) {
          const spent = Number(fresh.spent_usd) || 0;
          const budget = Number(fresh.budget_usd) || 0;
          pushProgress(
            job,
            `📊 ${fresh.name}: 누적 ${fmtUSD(spent)} / 한도 ${fmtUSD(budget)} ${fmtKRW(budget - spent)} 남음`,
          );
        }
      } catch (e) {
        pushProgress(job, `⚠ 사용량 DB 기록 실패: ${e.message}`);
      }
    } else {
      pushProgress(
        job,
        `📊 서버 누적 (메모리): ${totalUsage.jobs}건 / 총 ${fmtUSD(totalUsage.totalUSD)} ${fmtKRW(totalUsage.totalUSD)}`,
      );
    }
  } catch (e) {
    if (timedOut) {
      const elapsedMin = Math.floor((Date.now() - t0) / 60000);
      throw new Error(
        `${timeoutMin}분 timeout으로 작업이 강제 종료되었습니다 (실제 ${elapsedMin}분 경과).`,
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

// SSE stream
app.get("/api/jobs/:id/stream", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  const u = getSessionUser(req);
  if (job.userInfo?.name !== u.name) return res.status(403).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

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

// Download
app.get("/api/jobs/:id/download", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send("작업을 찾을 수 없습니다.");
  const u = getSessionUser(req);
  if (job.userInfo?.name !== u.name) return res.status(403).send("권한 없음");
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

// ── Admin routes ─────────────────────────────────────────────────────────────

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  try {
    const users = await supa.listUsers();
    // 각 사용자별 시간당 보고서 생성 카운트 추가
    const usersWithRate = users.map((u) => ({
      ...u,
      recent_gen_count: rateLimit.getUserGenCount(u.id),
      recent_gen_limit: rateLimit.GEN_LIMIT,
    }));
    const rate = await getKrwPerUsd();
    res.json({ users: usersWithRate, krwPerUsd: rate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  const { name, password, budgetUsd, budgetKrw, isAdmin } = req.body || {};
  if (!name || !password) {
    return res.status(400).json({ error: "이름·비밀번호 필수" });
  }
  if (String(password).length < 5) {
    return res
      .status(400)
      .json({ error: "비밀번호는 최소 5자 이상이어야 합니다." });
  }
  let usd = Number(budgetUsd) || 0;
  if (!usd && budgetKrw) {
    usd = await krwToUsd(Number(budgetKrw));
  }
  try {
    const user = await supa.createUser({
      name: String(name).trim(),
      password,
      budgetUsd: usd,
      isAdmin: !!isAdmin,
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  const { name, password, budgetUsd, budgetKrw, isAdmin, spentUsd } =
    req.body || {};
  if (password != null && password !== "" && String(password).length < 5) {
    return res
      .status(400)
      .json({ error: "비밀번호는 최소 5자 이상이어야 합니다." });
  }
  const patch = {};
  if (name) patch.name = String(name).trim();
  if (password) patch.password = password;
  if (budgetUsd != null) patch.budgetUsd = Number(budgetUsd);
  else if (budgetKrw != null) {
    patch.budgetUsd = await krwToUsd(Number(budgetKrw));
  }
  if (isAdmin != null) patch.isAdmin = !!isAdmin;
  if (spentUsd != null) patch.spentUsd = Number(spentUsd);
  try {
    const user = await supa.updateUser(req.params.id, patch);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 관리자가 일반 사용자의 시간당 사용 잠금을 해제 (rate limit 카운터 리셋)
app.post("/api/admin/users/:id/unlock-rate", requireAdmin, (req, res) => {
  rateLimit.unlockUser(req.params.id);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  // Don't let admin delete themselves
  const me = getSessionUser(req);
  if (me.id === req.params.id) {
    return res.status(400).json({ error: "본인 계정은 삭제 불가" });
  }
  try {
    await supa.deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/users/:id/reset-spent", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  try {
    const user = await supa.updateUser(req.params.id, { spentUsd: 0 });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/usage-logs", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  try {
    const logs = await supa.listUsageLogs(limit);
    const rate = await getKrwPerUsd();
    res.json({ logs, krwPerUsd: rate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/exchange-rate", requireAdmin, async (req, res) => {
  try {
    const rate = await getKrwPerUsd();
    res.json({ krwPerUsd: rate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Static + index ──────────────────────────────────────────────────────────

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    index: false,
  }),
);

app.get("/admin", (req, res) => {
  const u = getSessionUser(req);
  if (!u) return res.redirect("/login.html");
  if (!u.isAdmin) return res.status(403).send("관리자만 접근 가능합니다.");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  if (getSessionUser(req)) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  res.redirect("/login.html");
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

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

app.listen(PORT, async () => {
  console.log(`▶ chem-pre-lab-web listening on :${PORT}`);
  console.log(`  Supabase: ${supa.isEnabled() ? "ON" : "OFF (legacy mode)"}`);
  if (!supa.isEnabled() && SHARED_PASSWORD === "changeme") {
    console.warn("⚠ SHARED_PASSWORD가 기본값입니다.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠ ANTHROPIC_API_KEY가 없습니다.");
  }
  if (supa.isEnabled()) {
    try {
      const admin = await supa.ensureAdminFromEnv();
      if (admin) {
        console.log(`  ✓ Admin 사용자 보장: ${admin.name}`);
      }
    } catch (e) {
      console.warn(`  ⚠ Admin bootstrap 실패: ${e.message}`);
    }
  }
});
