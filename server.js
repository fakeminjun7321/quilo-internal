require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const {
  normalizeFontFace,
  normalizeFontFaceForFormat,
} = require("./lib/document-fonts");
// Pipeline registry — 보고서 종류별로 입력 처리 + 생성 함수 묶음.
// 각 파이프라인은 prepareInput(filesByField, body) → generateContent에 전달할 인자 객체 반환.
const PIPELINES = {
  "chem-pre": {
    label: "화학 사전보고서",
    filenamePrefix: "사전",
    filenameSourceField: "manual", // 이 fieldname의 파일명에서 번호 추출
    creditField: "pre", // pre_credits_usd 차감
    prepareInput(filesByField, body) {
      const manual = filesByField.manual?.[0];
      if (!manual) {
        throw new Error("실험 매뉴얼 PDF를 업로드하세요.");
      }
      if (manual.mimetype !== "application/pdf") {
        throw new Error("PDF 파일만 업로드 가능합니다.");
      }
      // 스타일 모드: "default" (학교 작성요령 풀버전) | "minimal" (필요한 내용만)
      const style = String(body.style || "default").trim() === "minimal"
        ? "minimal"
        : "default";
      return {
        pdfBuffer: manual.buffer,
        studentId: String(body.studentId || "").trim(),
        studentName: String(body.studentName || "").trim(),
        temperature: String(body.temperature || "").trim(),
        pressure: String(body.pressure || "").trim(),
        fontFace: normalizeFontFace(body.fontFace),
        style,
      };
    },
    generateContent: require("./lib/pipelines/chem-pre/generate")
      .generateReportContent,
    generateDocx: require("./lib/pipelines/chem-pre/docx-gen").generateDocx,
    generateHwpx: require("./lib/pipelines/chem-pre/hwpx-gen").generateHwpx,
  },
  "chem-result": {
    label: "화학 결과보고서",
    filenamePrefix: "결과",
    filenameSourceField: "preReport",
    creditField: "result", // result_credits_usd 차감
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
      // 스타일 모드: "default" (학교 공식 양식) | "minimal" (필요한 내용만)
      const style = String(body.style || "default").trim() === "minimal"
        ? "minimal"
        : "default";
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
        fontFace: normalizeFontFace(body.fontFace),
        style,
      };
    },
    generateContent: require("./lib/pipelines/chem-result/generate")
      .generateReportContent,
    generateDocx: require("./lib/pipelines/chem-result/docx-gen").generateDocx,
    generateHwpx: require("./lib/pipelines/chem-result/hwpx-gen").generateHwpx,
  },
  "phys-result": {
    label: "물리 결과보고서",
    filenamePrefix: "물리결과",
    // 파일명 번호 추출 우선순위: .cap > 매뉴얼 > 데이터
    filenameSourceField: "cap",
    creditField: "result", // result_credits_usd 차감
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
        fontFace: normalizeFontFace(body.fontFace),
        style: "default",
      };
    },
    // 파일명 형식: {학번}{이름}_{실험제목}.docx
    buildFilename(content, ctx) {
      const id = sanitizeForFilename(ctx.studentId || "");
      const name = sanitizeForFilename(ctx.userName || "");
      const title = sanitizeForFilename(
        content.title || content.title_en || content.title_kr || "보고서",
      );
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
const pricing = require("./lib/pricing");
const {
  fmtUSD,
  fmtKRW,
  fmtTokens,
  formatImageCostLine,
} = pricing;
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

function isTruthyPolicyFlag(value) {
  return value === true || value === "true" || value === "1" || value === "on";
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
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

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
    fileId: null,
    listeners: [],
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function cleanupOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.status === "running") continue;
    if ((job.createdAt || 0) < cutoff) jobs.delete(id);
  }
}

const jobCleanupTimer = setInterval(cleanupOldJobs, 60 * 60 * 1000);
if (typeof jobCleanupTimer.unref === "function") jobCleanupTimer.unref();

// 메시지 1개의 최대 길이 (예외 메시지가 매우 긴 경우 SSE 버퍼·로그 폭증 방지)
const MAX_PROGRESS_LINE = 500;
// job.progress에 보관하는 최근 메시지 개수 (재연결 시 history replay 분량)
const MAX_PROGRESS_HISTORY = 200;

function pushProgress(job, msg) {
  const stamp = new Date().toISOString().slice(11, 19);
  let line = `[${stamp}] ${msg}`;
  if (line.length > MAX_PROGRESS_LINE) {
    line = line.slice(0, MAX_PROGRESS_LINE) + "…(truncated)";
  }
  job.progress.push(line);
  // ring buffer: 너무 많이 쌓이면 SSE 재연결 시 history replay가 폭증.
  if (job.progress.length > MAX_PROGRESS_HISTORY) {
    job.progress.splice(0, job.progress.length - MAX_PROGRESS_HISTORY);
  }
  console.log(`[job ${job.id}] ${line}`);
  job.listeners.forEach((res) => sendSse(res, "progress", line));
}

function sendSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function pruneJobListeners(job) {
  job.listeners = job.listeners.filter(
    (res) => !res.writableEnded && !res.destroyed,
  );
  return job.listeners.length;
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

  const { username, password, age14Confirmed, termsAccepted } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "이름과 비밀번호를 입력하세요." });
  }
  if (!age14Confirmed) {
    return res
      .status(403)
      .json({ error: "만 14세 이상인 경우에만 이용할 수 있습니다." });
  }
  if (!termsAccepted) {
    return res
      .status(403)
      .json({ error: "이용약관과 개인정보처리방침에 동의해야 합니다." });
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
      studentId: normalizeStudentId(user.student_id),
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

app.get("/api/me", async (req, res) => {
  const u = getSessionUser(req);
  if (!u) {
    return res.status(401).json({ error: "not logged in" });
  }

  let studentId = normalizeStudentId(u.studentId);
  if (supa.isEnabled() && u.id) {
    try {
      const freshUser = await supa.findUserById(u.id);
      if (freshUser) {
        studentId = normalizeStudentId(freshUser.student_id);
        req.session.userInfo.studentId = studentId;
      }
    } catch (e) {
      console.warn("[me] profile lookup failed:", e.message);
    }
  }
  return res.json({ user: u.name, isAdmin: !!u.isAdmin, studentId });
});

app.patch("/api/me/profile", requireAuth, async (req, res) => {
  if (!supa.isEnabled()) {
    return res.status(503).json({ error: "DB 미설정" });
  }

  const userInfo = getSessionUser(req);
  if (!userInfo.id) {
    return res.status(403).json({ error: "사용자 정보 없음" });
  }

  const studentId = normalizeStudentId(req.body?.studentId);
  try {
    await supa.updateUser(userInfo.id, { studentId });
    req.session.userInfo.studentId = studentId;
    return res.json({ ok: true, studentId });
  } catch (e) {
    console.error("[profile] error:", e);
    return res.status(500).json({
      error: "학번 저장 중 오류가 발생했습니다. Supabase 스키마가 최신인지 확인하세요.",
    });
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

    const copyrightAccepted = isTruthyPolicyFlag(req.body.copyrightAccepted);
    const academicIntegrityAccepted = isTruthyPolicyFlag(
      req.body.academicIntegrityAccepted,
    );
    if (!copyrightAccepted || !academicIntegrityAccepted) {
      return res.status(400).json({
        error:
          "저작권과 학교·교사 기준 확인에 동의해야 보고서를 생성할 수 있습니다.",
      });
    }
    const policyAcknowledgement = {
      copyrightAccepted,
      academicIntegrityAccepted,
      acceptedAt: new Date().toISOString(),
      clientAcceptedAt: String(req.body.policyAcceptedAt || "").slice(0, 80),
    };

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
    const postedStudentId = normalizeStudentId(req.body.studentId);
    let savedStudentId = normalizeStudentId(userInfo.studentId);
    if (supa.isEnabled() && userInfo.id) {
      try {
        const freshUser = await supa.findUserById(userInfo.id);
        savedStudentId = normalizeStudentId(freshUser?.student_id) || savedStudentId;
        req.session.userInfo.studentId = savedStudentId;
      } catch (e) {
        console.warn("[generate] profile lookup failed:", e.message);
      }
    }
    pipelineInput.studentId =
      normalizeStudentId(pipelineInput.studentId) || postedStudentId || savedStudentId;
    if (reportType === "phys-result" && !pipelineInput.studentId) {
      return res
        .status(400)
        .json({ error: "개인 설정에서 학번을 저장한 뒤 생성하세요." });
    }

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

    // 종류별 잔액 검증 (Supabase enabled + 일반 사용자)
    // 사전 보고서는 pre_credits_usd, 결과 보고서는 result_credits_usd 사용
    const reportPrice = pricing.getReportPrice(reportType);
    if (supa.isEnabled() && userInfo.id && !userInfo.isAdmin) {
      try {
        const check = await supa.checkCreditBalance(
          userInfo.id,
          pipeline.creditField,
          reportPrice,
        );
        if (!check.ok) {
          return res
            .status(402)
            .json({ error: "🚫 " + (check.reason || "잔액 부족") });
        }
      } catch (e) {
        console.error("[credit] error:", e);
        return res
          .status(500)
          .json({ error: "잔액 확인 중 오류가 발생했습니다." });
      }
    }

    const date = (req.body.date || "").trim();
    // 출력 형식: docx (default) 또는 hwpx — pipeline이 hwpx generator를 가진 경우에만 hwpx 허용
    const requestedFormat = String(req.body.format || "docx").trim().toLowerCase();
    const format =
      requestedFormat === "hwpx" && typeof pipeline.generateHwpx === "function"
        ? "hwpx"
        : "docx";
    pipelineInput.fontFace = normalizeFontFaceForFormat(
      pipelineInput.fontFace,
      format,
    );
    // 파일명 기반 보고서 번호 추출용 — pipeline이 지정한 fieldname 사용
    const sourceFile =
      filesByField[pipeline.filenameSourceField]?.[0];
    const sourceFilename = sourceFile?.originalname || "";
    // 사용자가 폼에서 선택한 모델. 화이트리스트 검증으로 임의 모델 주입 차단.
    // Sonnet 비활성화 — Opus 4.7만 허용. 복구 시 "claude-sonnet-4-6" 추가.
    const ALLOWED_MODELS = ["claude-opus-4-7"];
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
      format,
      policyAcknowledgement,
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

// 표지 노출용 실험 번호 — 로마자 prefix까지 같이 살림 (예: "I-23_산염기..." -> "I-23")
function extractReportLabel(filename) {
  if (!filename) return "";
  const s = String(filename);
  const labeled = s.match(/([IVX]{1,3})[- ]?(\d{1,3})/i);
  if (labeled) return `${labeled[1].toUpperCase()}-${labeled[2]}`;
  return extractManualNumber(s);
}

function sanitizeForFilename(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 30);
}

function normalizeStudentId(value) {
  return String(value || "").trim().slice(0, 20);
}

async function runGeneration(job, pipeline, pipelineInput, meta) {
  const {
    date,
    sourceFilename,
    model,
    format = "docx",
    policyAcknowledgement,
  } = meta;
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
      outputFormat: format,
      onProgress: (msg) => pushProgress(job, msg),
    });
    const fontFace = normalizeFontFace(pipelineInput.fontFace);
    Object.defineProperty(content, "__fontFace", {
      value: fontFace,
      enumerable: false,
      writable: false,
    });
    content.font_face = fontFace;

    // 사용자·학번 정보를 docx-gen이 사용할 수 있게 attach (보고서 제목 prefix 등)
    const studentId = String(pipelineInput.studentId || "").trim();
    const renderedStudentName = String(
      pipelineInput.studentName || job.userInfo?.name || "",
    ).trim();
    Object.defineProperty(content, "__studentInfo", {
      value: {
        studentId,
        userName: renderedStudentName,
      },
      enumerable: false,
      writable: false,
    });

    // hwpx 표지에서 사용할 사용자 입력값 (chem-pre 폼에서만 채워짐, 다른
    // 파이프라인은 빈 문자열). enumerable 키라 generator가 직접 읽음.
    content.student_id = studentId;
    content.student_name = renderedStudentName;
    content.temperature = String(pipelineInput.temperature || "").trim();
    content.pressure = String(pipelineInput.pressure || "").trim();
    content.report_number = extractReportLabel(sourceFilename);

    const ext = format === "hwpx" ? "hwpx" : "docx";
    pushProgress(job, `📄 .${ext} 파일 빌드 중...`);
    const tBuildStart = Date.now();
    const buffer =
      format === "hwpx"
        ? await pipeline.generateHwpx(content)
        : await pipeline.generateDocx(content);
    const buildSec = Math.floor((Date.now() - tBuildStart) / 1000);
    const sizeKB = Math.round(buffer.length / 1024);
    pushProgress(job, `✓ .${ext} 빌드 완료 (${sizeKB}KB, ${buildSec}초)`);

    // 파일명 결정: pipeline에 buildFilename이 있으면 그걸 사용 (커스텀 형식)
    // 없으면 기존 형식 ({번호}_{타입}_{학번}_{이름}.{ext})
    job.result = buffer;
    job.mimeType =
      format === "hwpx"
        ? "application/hwp+zip"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (typeof pipeline.buildFilename === "function") {
      const baseName = pipeline.buildFilename(content, {
        studentId,
        userName: renderedStudentName,
        sourceFilename,
      });
      // buildFilename이 .docx로 끝나는 경우 ext로 교체
      job.filename = baseName.replace(/\.docx$/i, `.${ext}`);
    } else {
      const num = extractManualNumber(sourceFilename);
      const userName = sanitizeForFilename(renderedStudentName);
      const prefix = num ? `${num}_` : "";
      const studentPart = sanitizeForFilename(studentId) || "학번";
      const namePart = userName ? `_${userName}` : "";
      job.filename = `${prefix}${pipeline.filenamePrefix}_${studentPart}${namePart}.${ext}`;
    }

    if (supa.isEnabled() && job.userInfo?.id) {
      try {
        const savedFile = await supa.saveReportFile({
          userId: job.userInfo.id,
          jobId: job.id,
          reportType: job.reportType,
          filename: job.filename,
          mimeType: job.mimeType,
          buffer,
          meta: {
            title: content.title_kr || content.title || "",
            reportLabel: pipeline.label,
            format,
            policyAcknowledgement,
          },
        });
        if (savedFile?.id) {
          job.fileId = savedFile.id;
          const expires = new Date(savedFile.expires_at).toLocaleString("ko-KR", {
            dateStyle: "short",
            timeStyle: "short",
          });
          pushProgress(job, `☁ 파일함에 24시간 보관됨 (${expires}까지)`);
        }
      } catch (e) {
        pushProgress(job, `⚠ 파일함 저장 실패: ${e.message}`);
      }
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
        // 1) 실제 Anthropic 비용 누적 (admin 통계용)
        await supa.recordUsage({
          userId: job.userInfo.id,
          jobId: job.id,
          textCostUsd: content.__cost?.total || 0,
          imageCostUsd: content.__imageCost?.total || 0,
          meta: {
            reportType: job.reportType,
            reportLabel: pipeline.label,
            title: content.title_kr || content.title,
            model: content.__cost?.model,
            inputTokens: content.__cost?.inputTokens,
            outputTokens: content.__cost?.outputTokens,
            cacheReadTokens: content.__cost?.cacheReadTokens,
            cacheWriteTokens: content.__cost?.cacheWriteTokens,
            webSearchCount: content.__cost?.webSearchCount,
            chargedUsd: pricing.getReportPrice(job.reportType), // 실제 차감된 고정 가격
            policyAcknowledgement,
          },
        });

        // 2) 종류별 잔액 차감 (admin이 아닌 일반 사용자만)
        const userIsAdmin = !!job.userInfo.isAdmin;
        if (!userIsAdmin && pipeline.creditField) {
          const price = pricing.getReportPrice(job.reportType);
          const { newBalance } = await supa.deductCredit(
            job.userInfo.id,
            pipeline.creditField,
            price,
          );
          const krwRate = await getKrwPerUsd();
          const krw = Math.round(newBalance * krwRate);
          const remainingCount = Math.floor(newBalance / price);
          const label =
            pipeline.creditField === "pre" ? "사전" : "결과";
          pushProgress(
            job,
            `💳 ${label} 잔액: $${newBalance.toFixed(3)} ≈ ₩${krw.toLocaleString()} (약 ${remainingCount}건 남음)`,
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
    sendSse(r, "done", { filename: job.filename, fileId: job.fileId });
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
    sendSse(res, "done", { filename: job.filename, fileId: job.fileId });
    return res.end();
  }
  if (job.status === "error") {
    sendSse(res, "error", job.error);
    return res.end();
  }

  job.listeners.push(res);

  // SSE keep-alive: Render·CDN의 idle timeout(보통 60s+)으로 connection이
  // 끊기지 않도록 15초마다 comment line(`: ping`)을 보낸다. SSE 스펙상
  // `:`로 시작하는 줄은 클라이언트가 무시 → 트래픽 미미 + 안정성 개선.
  const keepAlive = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(": ping\n\n"); } catch { /* ignore */ }
  }, 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
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
      job.mimeType ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
    "Content-Length": job.result.length,
  });
  res.send(job.result);
});

// Stored files (24h)
app.get("/api/me/files", requireAuth, async (req, res) => {
  if (!supa.isEnabled()) {
    return res.json({
      files: [],
      retentionHours: 24,
      maxFilesPerUser: 3,
      storage: false,
    });
  }
  const u = getSessionUser(req);
  if (!u.id) return res.status(403).json({ error: "권한 없음" });
  try {
    const cfg = supa.reportStorageConfig();
    const files = await supa.listReportFiles(u.id);
    res.json({
      files,
      retentionHours: cfg.retentionHours,
      maxFilesPerUser: cfg.maxFilesPerUser,
      storage: true,
    });
  } catch (e) {
    console.error("[files] list error:", e);
    res.status(500).json({ error: "파일 목록을 불러오지 못했습니다." });
  }
});

app.get("/api/me/files/:id/download", requireAuth, async (req, res) => {
  if (!supa.isEnabled()) {
    return res.status(503).send("파일 저장소가 설정되지 않았습니다.");
  }
  const u = getSessionUser(req);
  if (!u.id) return res.status(403).send("권한 없음");
  try {
    const saved = await supa.downloadReportFile(u.id, req.params.id);
    if (!saved) return res.status(404).send("파일이 없거나 만료되었습니다.");
    res.set({
      "Content-Type": saved.row.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(saved.row.filename)}`,
      "Content-Length": saved.buffer.length,
    });
    res.send(saved.buffer);
  } catch (e) {
    console.error("[files] download error:", e);
    res.status(500).send("파일 다운로드 중 오류가 발생했습니다.");
  }
});

app.delete("/api/me/files/:id", requireAuth, async (req, res) => {
  if (!supa.isEnabled()) {
    return res.status(503).json({ error: "파일 저장소가 설정되지 않았습니다." });
  }
  const u = getSessionUser(req);
  if (!u.id) return res.status(403).json({ error: "권한 없음" });
  try {
    const ok = await supa.deleteReportFile(u.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "파일이 없거나 만료되었습니다." });
    res.json({ ok: true });
  } catch (e) {
    console.error("[files] delete error:", e);
    res.status(500).json({ error: "파일 삭제 중 오류가 발생했습니다." });
  }
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
  const {
    name,
    password,
    budgetUsd,
    budgetKrw,
    isAdmin,
    preCreditsUsd,
    resultCreditsUsd,
  } = req.body || {};
  if (!name || !password) {
    return res.status(400).json({ error: "이름·비밀번호 필수" });
  }
  if (String(password).length < 5) {
    return res
      .status(400)
      .json({ error: "비밀번호는 최소 5자 이상이어야 합니다." });
  }
  // legacy budgetUsd/budgetKrw도 받지만 새 폼은 preCreditsUsd/resultCreditsUsd 사용 (충전 N건 → USD).
  let usd = Number(budgetUsd) || 0;
  if (!usd && budgetKrw) {
    usd = await krwToUsd(Number(budgetKrw));
  }
  const preUsd = Number(preCreditsUsd) || 0;
  const resultUsd = Number(resultCreditsUsd) || 0;
  if (preUsd < 0 || resultUsd < 0) {
    return res.status(400).json({ error: "충전 금액은 음수일 수 없습니다." });
  }
  try {
    const user = await supa.createUser({
      name: String(name).trim(),
      password,
      budgetUsd: usd,
      preCreditsUsd: preUsd,
      resultCreditsUsd: resultUsd,
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

// 종류별 잔액 충전 (admin만)
// body: { field: "pre"|"result", count?: N, usd?: X }
//   - count 우선: count × 단가만큼 USD 추가
//   - usd: 직접 USD 액수 추가
app.post("/api/admin/users/:id/topup", requireAdmin, async (req, res) => {
  if (!supa.isEnabled())
    return res.status(503).json({ error: "Supabase 미설정" });
  const { field, count, usd } = req.body || {};
  if (field !== "pre" && field !== "result") {
    return res.status(400).json({ error: "field는 'pre' 또는 'result'여야 합니다." });
  }
  let addUsd = 0;
  if (count != null) {
    const reportType = field === "pre" ? "chem-pre" : "chem-result";
    const price = pricing.getReportPrice(reportType);
    addUsd = Number(count) * price;
  } else if (usd != null) {
    addUsd = Number(usd);
  } else {
    return res.status(400).json({ error: "count 또는 usd 중 하나 필수" });
  }
  if (!Number.isFinite(addUsd) || addUsd <= 0) {
    return res.status(400).json({ error: "충전 금액이 유효하지 않습니다." });
  }
  try {
    const result = await supa.topupCredit(req.params.id, field, addUsd);
    res.json({ ok: true, addedUsd: addUsd, ...result });
  } catch (e) {
    console.error("[admin]", req.method, req.path, "error:", e);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
});

// 사용자 본인 잔액 조회 (메인 화면 잔액 박스용)
app.get("/api/me/balance", requireAuth, async (req, res) => {
  const u = getSessionUser(req);
  if (u.isAdmin) {
    return res.json({ isAdmin: true });
  }
  if (!supa.isEnabled() || !u.id) {
    return res.json({ preUsd: 0, resultUsd: 0, krwPerUsd: 1400 });
  }
  try {
    const user = await supa.findUserById(u.id);
    const rate = await getKrwPerUsd();
    res.json({
      preUsd: Number(user?.pre_credits_usd) || 0,
      resultUsd: Number(user?.result_credits_usd) || 0,
      krwPerUsd: rate,
      preUnitUsd: pricing.getReportPrice("chem-pre"),
      resultUnitUsd: pricing.getReportPrice("chem-result"),
    });
  } catch (e) {
    console.error("[me/balance] error:", e);
    res.status(500).json({ error: "잔액 조회 실패" });
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
    try {
      const result = await supa.cleanupExpiredReportFiles(200);
      if (result.deleted) {
        console.log(`  ✓ 만료 파일 정리: ${result.deleted}개`);
      }
    } catch (e) {
      console.warn(`  ⚠ 만료 파일 정리 실패: ${e.message}`);
    }
    const cleanupTimer = setInterval(() => {
      supa.cleanupExpiredReportFiles(200).catch((e) => {
        console.warn(`  ⚠ 만료 파일 정리 실패: ${e.message}`);
      });
    }, 6 * 60 * 60 * 1000);
    if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
  }
});
