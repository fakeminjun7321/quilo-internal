require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
// Pipeline registry — 보고서 종류별로 입력 처리 + 생성 함수 묶음.
// 각 파이프라인은 prepareInput(filesByField, body) → generateContent에 전달할 인자 객체 반환.
const PIPELINES = {
  "chem-pre": {
    label: "화학 사전보고서",
    filenamePrefix: "사전",
    filenameSourceField: "manual", // 이 fieldname의 파일명에서 번호 추출
    prepareInput(filesByField, _body) {
      const manual = filesByField.manual?.[0];
      if (!manual) {
        throw new Error("실험 매뉴얼 PDF를 업로드하세요.");
      }
      if (manual.mimetype !== "application/pdf") {
        throw new Error("PDF 파일만 업로드 가능합니다.");
      }
      return {
        pdfBuffer: manual.buffer,
      };
    },
    generateContent: require("./lib/pipelines/chem-pre/generate")
      .generateReportContent,
    generateDocx: require("./lib/pipelines/chem-pre/docx-gen").generateDocx,
  },
  "chem-result": {
    label: "화학 결과보고서",
    filenamePrefix: "결과",
    filenameSourceField: "preReport",
    prepareInput(filesByField, body) {
      const preReport = filesByField.preReport?.[0];
      if (!preReport) {
        throw new Error("사전보고서 파일을 업로드하세요.");
      }
      const ext = (preReport.originalname.split(".").pop() || "").toLowerCase();
      if (!["pdf", "docx"].includes(ext)) {
        throw new Error("사전보고서는 PDF 또는 docx만 가능합니다.");
      }
      const data = filesByField.data?.[0] || null;
      const photos = filesByField.photos || [];
      const manual = filesByField.manual?.[0] || null;
      return {
        preReportBuffer: preReport.buffer,
        preReportName: preReport.originalname,
        dataBuffer: data?.buffer || null,
        dataName: data?.originalname || "",
        photos: photos.map((p) => ({
          buffer: p.buffer,
          name: p.originalname,
          mimetype: p.mimetype,
        })),
        manualBuffer: manual?.buffer || null,
        temperature: String(body.temperature || "").trim(),
        pressure: String(body.pressure || "").trim(),
      };
    },
    generateContent: require("./lib/pipelines/chem-result/generate")
      .generateReportContent,
    generateDocx: require("./lib/pipelines/chem-result/docx-gen").generateDocx,
  },
  "phys-result": {
    label: "물리 결과보고서",
    filenamePrefix: "물리결과",
    // 파일명 번호 추출 우선순위: .cap > 매뉴얼 > 데이터
    filenameSourceField: "cap",
    prepareInput(filesByField, body) {
      const cap = filesByField.cap?.[0] || null;
      const data = filesByField.data?.[0] || null;
      const manual = filesByField.manual?.[0] || null;

      // .cap 또는 엑셀 데이터 중 하나는 필수
      if (!cap && !data) {
        throw new Error(
          "PASCO Capstone (.cap) 파일 또는 엑셀/CSV 데이터 중 하나는 업로드하세요.",
        );
      }

      // .cap 확장자 검증 (있을 때)
      if (cap) {
        const ext = (cap.originalname.split(".").pop() || "").toLowerCase();
        if (ext !== "cap") {
          throw new Error(".cap 확장자 파일만 가능합니다.");
        }
      }

      // 데이터 확장자 검증 (있을 때)
      if (data) {
        const dext = (data.originalname.split(".").pop() || "").toLowerCase();
        if (!["xlsx", "xls", "csv"].includes(dext)) {
          throw new Error("엑셀/CSV 데이터는 .xlsx, .xls, .csv 형식만 가능합니다.");
        }
      }

      const photos = filesByField.photos || [];

      const studentId = String(body.studentId || "").trim().slice(0, 20);

      return {
        capBuffer: cap?.buffer || null,
        capName: cap?.originalname || "",
        dataBuffer: data?.buffer || null,
        dataName: data?.originalname || "",
        manualBuffer: manual?.buffer || null,
        photos: photos.map((p) => ({
          buffer: p.buffer,
          name: p.originalname,
          mimetype: p.mimetype,
        })),
        studentId,
      };
    },
    // 파일명 형식: {학번}{이름}_{실험제목}.docx
    buildFilename(content, ctx) {
      const id = sanitizeForFilename(ctx.studentId || "");
      const name = sanitizeForFilename(ctx.userName || "");
      const title = sanitizeForFilename(content.title || "보고서");
      const prefix = `${id}${name}`;
      return prefix
        ? `${prefix}_${title}.docx`
        : `물리결과_${title}.docx`;
    },
    generateContent: require("./lib/pipelines/phys-result/generate")
      .generateReportContent,
    generateDocx: require("./lib/pipelines/phys-result/docx-gen").generateDocx,
  },
};
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
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Hard timeout for a single generation job (default 8 minutes)
const JOB_TIMEOUT_MS = parseInt(
  process.env.JOB_TIMEOUT_MS || String(8 * 60 * 1000),
  10,
);

// ── Middleware ───────────────────────────────────────────────────────────────

app.set("trust proxy", 1);
// JSON/URL-encoded body는 비번 변경 등 작은 요청만 — 1MB로 충분
// (파일 업로드는 multer가 별도로 25MB 한도 처리)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
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

// 단일 파일 25MB, 전체 파일 개수 12개 (사진 multi 대비) — Render 무료 512MB 메모리 보호
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 12,
  },
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

// 사용자별 진행 중인 작업 ID — B1: 같은 사용자가 새 작업 제출 시 이전 작업 자동 중단.
// curl 등으로 폼 락을 우회한 동시 요청도 1개로 제한됨.
const activeJobByUser = new Map(); // userId -> jobId

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

// 작업 결과는 24시간 보관 (사용자가 핸드폰→컴퓨터 이동 등의 시나리오 지원).
// rate limit으로 사용자당 시간당 5건이라 24시간 누적 최대 ~120건 × 100KB = ~12MB 안전.
setInterval(
  () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, job] of jobs.entries()) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  },
  60 * 60 * 1000,
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

  // Supabase 필수 — legacy SHARED_PASSWORD 백도어 제거
  if (!supa.isEnabled()) {
    console.error("[login] Supabase 미설정 — 로그인 불가");
    return res
      .status(503)
      .json({ error: "DB가 일시적으로 사용 불가합니다. 관리자에게 문의하세요." });
  }

  try {
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
  } catch (e) {
    console.error("[login] error:", e);
    return res
      .status(500)
      .json({ error: "로그인 처리 중 오류가 발생했습니다." });
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

// 본인 비밀번호 변경 (현재 비번 재확인 필수, rate limit 적용)
app.post("/api/me/password", requireAuth, async (req, res) => {
  if (!supa.isEnabled()) {
    return res.status(503).json({ error: "DB 미설정" });
  }

  const userInfo = getSessionUser(req);
  if (!userInfo.id) {
    return res.status(403).json({ error: "사용자 정보 없음" });
  }

  // Per-user rate limit (10분당 3회) — 현재 비번 brute force 방어
  const limit = rateLimit.checkPasswordChangeLimit(userInfo.id);
  if (!limit.allowed) {
    return res.status(429).json({
      error: `비밀번호 변경 시도가 너무 많습니다 (10분당 ${rateLimit.PWCHANGE_LIMIT}회 제한). 잠시 후 다시 시도하세요.`,
    });
  }
  rateLimit.recordPasswordChangeAttempt(userInfo.id);

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "현재 비밀번호와 새 비밀번호를 입력하세요." });
  }
  if (String(newPassword).length < 5) {
    return res
      .status(400)
      .json({ error: "새 비밀번호는 최소 5자 이상이어야 합니다." });
  }
  if (currentPassword === newPassword) {
    return res
      .status(400)
      .json({ error: "새 비밀번호가 현재 비밀번호와 같습니다." });
  }

  try {
    // 현재 비번 검증
    const verified = await supa.verifyUserPassword(userInfo.id, currentPassword);
    if (!verified) {
      return res
        .status(401)
        .json({ error: "현재 비밀번호가 일치하지 않습니다." });
    }

    // 비번 업데이트
    await supa.updateUser(userInfo.id, { password: newPassword });
    console.log(`[password-change] user=${verified.name}`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[password-change] error:", e);
    res
      .status(500)
      .json({ error: "비밀번호 변경 중 오류가 발생했습니다." });
  }
});

// ── Generate route ───────────────────────────────────────────────────────────

app.post(
  "/api/generate",
  requireAuth,
  upload.any(),
  async (req, res) => {
    // 보고서 종류 결정 (없으면 화학 사전 = 기존 동작 보존)
    const reportType = String(req.body.type || "chem-pre").trim();
    const pipeline = PIPELINES[reportType];
    if (!pipeline) {
      return res.status(400).json({
        error: `🚧 '${reportType}' 보고서 종류는 아직 준비 중입니다.`,
      });
    }

    // fieldname별 파일 그룹핑 (chem-result는 photos 같이 multi 파일이 들어옴)
    const filesByField = {};
    for (const f of req.files || []) {
      filesByField[f.fieldname] = filesByField[f.fieldname] || [];
      filesByField[f.fieldname].push(f);
    }

    // 파이프라인별 입력 검증·준비
    let pipelineInput;
    try {
      pipelineInput = pipeline.prepareInput(filesByField, req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
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
        return res
          .status(500)
          .json({ error: "한도 확인 중 오류가 발생했습니다." });
      }
    }

    const date = (req.body.date || "").trim();
    // 파일명 기반 보고서 번호 추출용 — pipeline이 지정한 fieldname 사용
    const sourceFile =
      filesByField[pipeline.filenameSourceField]?.[0];
    const sourceFilename = sourceFile?.originalname || "";
    // 사용자가 폼에서 선택한 모델. 화이트리스트 검증으로 임의 모델 주입 차단.
    const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-opus-4-7"];
    const requestedModel = String(req.body.model || "").trim();
    const model = ALLOWED_MODELS.includes(requestedModel) ? requestedModel : null;

    // 모든 검증 통과 — 일반 사용자는 rate limit 카운트 증가
    if (!userInfo.isAdmin && userInfo.id) {
      rateLimit.recordUserGenAttempt(userInfo.id);
    }

    // B1: 이미 진행 중인 작업이 있으면 자동 중단 (탭 닫기·동시 요청 시나리오)
    if (userInfo.id) {
      const prevJobId = activeJobByUser.get(userInfo.id);
      if (prevJobId) {
        const prevJob = jobs.get(prevJobId);
        if (
          prevJob &&
          prevJob.status === "running" &&
          prevJob.abortController
        ) {
          prevJob.autoAborted = true;
          pushProgress(prevJob, "🔄 새 작업 시작 — 이전 작업 자동 중단");
          prevJob.abortController.abort();
        }
      }
    }

    const job = createJob(userInfo);
    job.reportType = reportType;
    if (userInfo.id) {
      activeJobByUser.set(userInfo.id, job.id);
    }

    res.json({ jobId: job.id });

    runGeneration(job, pipeline, pipelineInput, {
      date,
      sourceFilename,
      model,
    }).catch(
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

async function runGeneration(job, pipeline, pipelineInput, meta) {
  const { date, sourceFilename, model } = meta;
  const t0 = Date.now();
  const timeoutMin = Math.round(JOB_TIMEOUT_MS / 60000);
  pushProgress(
    job,
    `🚀 작업 시작 (${pipeline.label}, timeout: ${timeoutMin}분)`,
  );

  const ac = new AbortController();
  job.abortController = ac; // 사용자 중지 요청용
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    pushProgress(job, `⏰ ${timeoutMin}분 초과 — 강제 종료 중...`);
    ac.abort();
  }, JOB_TIMEOUT_MS);

  try {
    const content = await pipeline.generateContent({
      ...pipelineInput,
      date,
      signal: ac.signal,
      model,
      onProgress: (msg) => pushProgress(job, msg),
    });

    // 사용자·학번 정보를 docx-gen이 사용할 수 있게 attach (보고서 제목 prefix 등)
    const studentId = String(pipelineInput.studentId || "").trim();
    Object.defineProperty(content, "__studentInfo", {
      value: {
        studentId,
        userName: job.userInfo?.name || "",
      },
      enumerable: false,
      writable: false,
    });

    pushProgress(job, "📄 .docx 파일 빌드 중...");
    const tDocxStart = Date.now();
    const buffer = await pipeline.generateDocx(content);
    const docxSec = Math.floor((Date.now() - tDocxStart) / 1000);
    const sizeKB = Math.round(buffer.length / 1024);
    pushProgress(job, `✓ .docx 빌드 완료 (${sizeKB}KB, ${docxSec}초)`);

    // 파일명 결정: pipeline에 buildFilename이 있으면 그걸 사용 (커스텀 형식)
    // 없으면 기존 형식 ({번호}_{타입}_{학번}_{이름}.docx)
    job.result = buffer;
    if (typeof pipeline.buildFilename === "function") {
      job.filename = pipeline.buildFilename(content, {
        studentId,
        userName: job.userInfo?.name || "",
        sourceFilename,
      });
    } else {
      const num = extractManualNumber(sourceFilename);
      const userName = sanitizeForFilename(job.userInfo?.name || "");
      const prefix = num ? `${num}_` : "";
      const studentPart = sanitizeForFilename(studentId) || "학번";
      const namePart = userName ? `_${userName}` : "";
      job.filename = `${prefix}${pipeline.filenamePrefix}_${studentPart}${namePart}.docx`;
    }
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
            reportType: job.reportType,
            reportLabel: pipeline.label,
            title: content.title_kr,
            model: content.__cost?.model,
            inputTokens: content.__cost?.inputTokens,
            outputTokens: content.__cost?.outputTokens,
            cacheReadTokens: content.__cost?.cacheReadTokens,
            cacheWriteTokens: content.__cost?.cacheWriteTokens,
            webSearchCount: content.__cost?.webSearchCount,
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
    if (job.autoAborted) {
      throw new Error("새 작업 시작으로 자동 중단되었습니다.");
    }
    if (job.userAborted) {
      throw new Error("사용자가 작업을 중지했습니다.");
    }
    if (timedOut) {
      const elapsedMin = Math.floor((Date.now() - t0) / 60000);
      throw new Error(
        `${timeoutMin}분 timeout으로 작업이 강제 종료되었습니다 (실제 ${elapsedMin}분 경과).`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
    // 사용자별 active job 매핑에서 제거 (현재 매핑이 이 작업을 가리키고 있을 때만)
    if (
      job.userInfo?.id &&
      activeJobByUser.get(job.userInfo.id) === job.id
    ) {
      activeJobByUser.delete(job.userInfo.id);
    }
  }

  job.listeners.forEach((r) => {
    sendSse(r, "done", { filename: job.filename });
    r.end();
  });
  job.listeners = [];
}

// 사용자가 진행 중인 작업을 중지
app.post("/api/jobs/:id/abort", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다." });
  const u = getSessionUser(req);
  // id 기반 권한 체크 (admin이 사용자 이름 변경 시에도 안전)
  if (!u.id || job.userInfo?.id !== u.id) {
    return res.status(403).json({ error: "권한 없음" });
  }
  if (job.status !== "running") {
    return res.status(409).json({ error: "이미 완료된 작업입니다." });
  }
  if (job.abortController) {
    job.userAborted = true;
    pushProgress(job, "🛑 사용자 중지 요청 — 작업 중단 중...");
    job.abortController.abort();
  }
  res.json({ ok: true });
});

// SSE stream
app.get("/api/jobs/:id/stream", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  const u = getSessionUser(req);
  if (!u.id || job.userInfo?.id !== u.id) return res.status(403).end();

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
  if (!u.id || job.userInfo?.id !== u.id) return res.status(403).send("권한 없음");
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
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
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
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
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
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
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
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
});

app.post("/api/admin/users/:id/reset-spent", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  try {
    const user = await supa.updateUser(req.params.id, { spentUsd: 0 });
    res.json({ ok: true, user });
  } catch (e) {
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
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
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
});

app.get("/api/admin/exchange-rate", requireAdmin, async (req, res) => {
  try {
    const rate = await getKrwPerUsd();
    res.json({ krwPerUsd: rate });
  } catch (e) {
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
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

// Supabase 7일 무활동 자동 pause 방지용 keepalive.
// UptimeRobot 등 외부 모니터가 주기적으로 호출 → Supabase에 가벼운 쿼리 실행.
// 인증 없음 (외부 모니터가 공개 endpoint로 호출).
app.get("/api/keepalive", async (req, res) => {
  const result = await supa.ping();
  if (result.ok) {
    res.json({ ok: true, ts: new Date().toISOString() });
  } else {
    res.status(503).json({ ok: false, reason: result.reason });
  }
});

// multer 업로드 에러 핸들러 (파일 크기·개수 초과 등)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    let msg = "파일 업로드 오류: " + err.code;
    if (err.code === "LIMIT_FILE_SIZE") {
      msg = "파일이 너무 큽니다 (단일 파일 최대 25MB).";
    } else if (err.code === "LIMIT_FILE_COUNT") {
      msg = "파일이 너무 많습니다 (최대 12개). 사진 수를 줄여보세요.";
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
      msg = `예상치 못한 파일 필드: ${err.field}`;
    }
    return res.status(400).json({ error: msg });
  }
  next(err);
});

app.get("/api/usage", requireAdmin, (req, res) => {
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
  console.log(`  Supabase: ${supa.isEnabled() ? "ON" : "OFF (로그인 불가!)"}`);
  if (!supa.isEnabled()) {
    console.error(
      "🚨 Supabase 미설정 — 로그인이 작동하지 않습니다. SUPABASE_URL과 SUPABASE_SERVICE_KEY를 설정하세요.",
    );
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
