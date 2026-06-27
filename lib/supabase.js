// Supabase 클라이언트 + DB 헬퍼.
// SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수가 모두 있으면 동작.
// 없으면 isEnabled() === false → 호출자가 fallback 처리.

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const { hashPassword, verifyPassword } = require("./auth");

const REPORT_BUCKET = process.env.REPORT_STORAGE_BUCKET || "generated-reports";
const REPORT_RETENTION_HOURS = Math.max(
  1,
  Number(process.env.REPORT_RETENTION_HOURS || 24),
);
const REPORT_MAX_FILES_PER_USER = Math.max(
  1,
  Number(process.env.REPORT_MAX_FILES_PER_USER || 3),
);

let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

function isEnabled() {
  return !!getClient();
}

// ── User CRUD ────────────────────────────────────────────────────────────────

async function findUserByName(name) {
  const c = getClient();
  if (!c) return null;
  const raw = String(name || "");
  // ilike 패턴에서 사용자명에 든 % _ 가 SQL 와일드카드로 동작하면(다중 매칭)
  // .maybeSingle() 이 throw 하거나 엉뚱한 계정이 잡힌다. 후보만 받아 JS에서
  // 정확히(대소문자 무시) 매칭한다.
  const { data, error } = await c
    .from("users")
    .select("*")
    .ilike("name", raw)
    .limit(10);
  if (error) throw new Error(`findUserByName: ${error.message}`);
  const lower = raw.toLowerCase();
  return (data || []).find((u) => String(u.name || "").toLowerCase() === lower) || null;
}

// 로그인 아이디(username)로 조회. username 컬럼이 아직 없으면(마이그레이션 전)
// name 으로 폴백한다. % _ 와일드카드 오작동을 피하려고 후보만 받아 JS 에서 정확 매칭.
async function findUserByUsername(username) {
  const c = getClient();
  if (!c) return null;
  const raw = String(username || "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  try {
    const { data, error } = await c
      .from("users")
      .select("*")
      .ilike("username", raw)
      .limit(10);
    if (error) throw error;
    const hit =
      (data || []).find(
        (u) => String(u.username || "").toLowerCase() === lower,
      ) || null;
    if (hit) return hit;
    // username 컬럼은 있으나 값이 비어있는(백필 전) 계정도 있을 수 있어 name 폴백.
    return await findUserByName(raw);
  } catch (e) {
    // username 컬럼 미존재 등 → name 폴백.
    if (/column .*username.* does not exist|username/i.test(e.message || "")) {
      return await findUserByName(raw);
    }
    throw new Error(`findUserByUsername: ${e.message}`);
  }
}

async function findUserById(id) {
  const c = getClient();
  if (!c) return null;
  const { data, error } = await c
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`findUserById: ${error.message}`);
  return data;
}

// 확정 인증된 학교 이메일로 계정 조회(중복 인증 방지용). 없거나 email 컬럼 미존재면 null.
async function findUserByEmail(email) {
  const c = getClient();
  if (!c) return null;
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  try {
    const { data, error } = await c
      .from("users")
      .select("id, name, username, email")
      .ilike("email", e)
      .limit(10);
    if (error) throw error;
    return (
      (data || []).find((u) => String(u.email || "").toLowerCase() === e) || null
    );
  } catch (err) {
    if (/column .*email.* does not exist|email/i.test(err.message || "")) {
      return null;
    }
    throw new Error(`findUserByEmail: ${err.message}`);
  }
}

// 보고서 종류 접근 제한 값 정규화 (jsonb 배열 또는 JSON 문자열 또는 null).
function normalizeBlockedTypes(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string" && v.trim()) {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

// 한 사용자의 차단된 보고서 종류 목록. findUserById 는 select("*") 라
// blocked_report_types 컬럼이 없어도(마이그레이션 전) 안전(undefined→[]).
async function getBlockedReportTypes(userId) {
  if (!userId) return [];
  try {
    const u = await findUserById(userId);
    return normalizeBlockedTypes(u && u.blocked_report_types);
  } catch {
    return [];
  }
}

// 전체 사용자 id→차단목록 맵 (관리자 목록 표시용). 컬럼 없음/오류면 빈 맵으로
// fail-safe — 크레딧 표시(listUsers)에 영향 주지 않도록 별도 쿼리로 둔다.
async function listBlockedReportTypesMap() {
  const c = getClient();
  if (!c) return {};
  try {
    const { data, error } = await c
      .from("users")
      .select("id, blocked_report_types");
    if (error) throw error;
    const map = {};
    for (const r of data || []) {
      map[r.id] = normalizeBlockedTypes(r.blocked_report_types);
    }
    return map;
  } catch (e) {
    if (!/blocked_report_types/.test(e.message || "")) {
      console.warn("[acl] listBlockedReportTypesMap:", e.message);
    }
    return {};
  }
}

async function listUsers() {
  const c = getClient();
  if (!c) return [];
  // 새 credit 컬럼 포함해서 시도. 컬럼이 없으면 (SQL 미실행) fallback.
  // 컬럼 집합을 단계적으로 시도한다. 일부 마이그레이션만 적용된 환경에서도, 존재하는
  // 컬럼은 실제 값을 유지하고 없는 컬럼만 기본값으로 채운다(예: 인증 컬럼만 없을 때
  // 크레딧/모델제한 값이 0/false 로 덮이지 않도록).
  const fillDefaults = (rows) =>
    (rows || []).map((u) => ({
      username: u.name,
      student_id: "",
      email: null,
      email_verified: false,
      approved: false,
      pre_credits_usd: 0,
      result_credits_usd: 0,
      credits: 0,
      unlimited: false,
      restricted_model: null,
      ...u, // 실제 select 된 값이 기본값을 덮어쓴다
    }));

  const COL_SETS = [
    // 전체(인증 + 크레딧 + ACL)
    "id, name, username, student_id, email, email_verified, approved, budget_usd, spent_usd, pre_credits_usd, result_credits_usd, credits, unlimited, restricted_model, is_admin, created_at, updated_at",
    // 인증 컬럼만 없는 경우(크레딧/ACL 보존)
    "id, name, student_id, budget_usd, spent_usd, pre_credits_usd, result_credits_usd, credits, unlimited, restricted_model, is_admin, created_at, updated_at",
    // 크레딧/ACL 컬럼도 없는 경우(가장 기본)
    "id, name, budget_usd, spent_usd, is_admin, created_at, updated_at",
  ];

  let lastErr = null;
  for (let i = 0; i < COL_SETS.length; i++) {
    const { data, error } = await c
      .from("users")
      .select(COL_SETS[i])
      .order("created_at", { ascending: true });
    if (!error) return fillDefaults(data);
    lastErr = error;
    if (i < COL_SETS.length - 1) {
      console.warn(
        `[listUsers] 컬럼 집합 ${i} 실패, 폴백 시도:`,
        error.message,
      );
    }
  }
  throw new Error(`listUsers: ${lastErr ? lastErr.message : "unknown"}`);
}

async function createUser({
  name,
  username,
  password,
  budgetUsd,
  preCreditsUsd = 0,
  resultCreditsUsd = 0,
  isAdmin = false,
  studentId = "",
  approved = false,
  emailVerified = false,
}) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const password_hash = hashPassword(password);
  // username 미지정 시 name 으로(레거시 호출부 호환). 관리자 생성 계정은 자동 승인.
  const uname = String(username || name || "").trim();
  const row = {
    name,
    username: uname,
    password_hash,
    student_id: String(studentId || "").trim(),
    budget_usd: Number(budgetUsd) || 0,
    pre_credits_usd: Number(preCreditsUsd) || 0,
    result_credits_usd: Number(resultCreditsUsd) || 0,
    is_admin: !!isAdmin,
    approved: !!approved || !!isAdmin,
    email_verified: !!emailVerified || !!isAdmin,
  };
  if (row.approved) row.approved_at = new Date().toISOString();
  const { data, error } = await c.from("users").insert(row).select().single();
  if (error) throw new Error(`createUser: ${error.message}`);
  return data;
}

async function updateUser(id, patch) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const update = {};
  if (patch.name != null) update.name = patch.name;
  if (patch.username != null)
    update.username = String(patch.username || "").trim().slice(0, 50);
  if (patch.studentId != null)
    update.student_id = String(patch.studentId || "").trim().slice(0, 20);
  if (patch.email !== undefined)
    update.email = patch.email ? String(patch.email).trim().toLowerCase() : null;
  if (patch.emailVerified != null) update.email_verified = !!patch.emailVerified;
  if (patch.approved != null) {
    update.approved = !!patch.approved;
    update.approved_at = patch.approved ? new Date().toISOString() : null;
  }
  // 내 기본 글 스타일(문체 메모). users.style_note (text) 컬럼 필요.
  if (patch.styleNote !== undefined)
    update.style_note = String(patch.styleNote || "").slice(0, 4000);
  if (patch.password != null && patch.password !== "")
    update.password_hash = hashPassword(patch.password);
  if (patch.budgetUsd != null) update.budget_usd = Number(patch.budgetUsd);
  if (patch.isAdmin != null) update.is_admin = !!patch.isAdmin;
  if (patch.spentUsd != null) update.spent_usd = Number(patch.spentUsd);
  if (patch.preCreditsUsd != null)
    update.pre_credits_usd = Number(patch.preCreditsUsd);
  if (patch.resultCreditsUsd != null)
    update.result_credits_usd = Number(patch.resultCreditsUsd);
  // 모델 제한: 빈 문자열/null = 제한 없음(전체 허용)
  if (patch.restrictedModel !== undefined)
    update.restricted_model = patch.restrictedModel
      ? String(patch.restrictedModel)
      : null;
  if (patch.unlimited != null) update.unlimited = !!patch.unlimited;
  // 보고서 종류 접근 제한 (jsonb 배열). 빈 배열 = 제한 없음.
  if (patch.blockedReportTypes !== undefined)
    update.blocked_report_types = Array.isArray(patch.blockedReportTypes)
      ? patch.blockedReportTypes.filter((x) => typeof x === "string")
      : [];
  if (Object.keys(update).length === 0) return null;
  const { data, error } = await c
    .from("users")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`updateUser: ${error.message}`);
  return data;
}

async function deleteUser(id) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c.from("users").delete().eq("id", id);
  if (error) throw new Error(`deleteUser: ${error.message}`);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

// 로그인: 아이디(username) 기준 인증. 기존 계정은 username = name 으로 백필되어
// 같은 값으로 로그인된다. username 으로 못 찾으면 name 으로도 시도(전환기 안전망).
async function authenticate(usernameOrName, password) {
  let user = await findUserByUsername(usernameOrName);
  if (!user) user = await findUserByName(usernameOrName);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

// 보고서 생성 자격: 관리자이거나 (학교 이메일 인증 완료 AND 관리자 승인).
function isReportEligible(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  return !!user.email_verified && !!user.approved;
}

// 학교 이메일 인증 시작/재발송: 대기 이메일 + 토큰 해시 + 만료를 사용자 행에 저장.
// 원문 토큰은 호출부(server)가 메일로 보내고, 여기엔 해시만 남긴다.
async function setEmailVerification(userId, { email, tokenHash, expiresAt }) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c
    .from("users")
    .update({
      email_verify_email: String(email || "").trim().toLowerCase(),
      email_verify_token_hash: tokenHash,
      email_verify_expires_at: new Date(expiresAt).toISOString(),
      email_verify_sent_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`setEmailVerification: ${error.message}`);
  return true;
}

// 토큰 해시로 인증 확정. 만료/미존재면 {ok:false}. 같은 이메일이 다른 계정에서 이미
// 인증됐다면 {ok:false, reason}. 성공 시 email 확정 + email_verified=true + 대기필드 정리.
async function verifyEmailToken(tokenHash) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  if (!tokenHash) return { ok: false, reason: "잘못된 인증 링크입니다." };

  const { data: rows, error } = await c
    .from("users")
    .select(
      "id, name, email_verify_email, email_verify_expires_at, email_verified, approved, is_admin",
    )
    .eq("email_verify_token_hash", tokenHash)
    .limit(1);
  if (error) throw new Error(`verifyEmailToken(select): ${error.message}`);
  const user = rows && rows[0];
  if (!user) {
    return { ok: false, reason: "이미 사용했거나 유효하지 않은 링크입니다." };
  }
  if (
    user.email_verify_expires_at &&
    new Date(user.email_verify_expires_at).getTime() <= Date.now()
  ) {
    return { ok: false, reason: "인증 링크가 만료되었습니다. 다시 요청하세요." };
  }
  const email = String(user.email_verify_email || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, reason: "인증할 이메일 정보가 없습니다. 다시 요청하세요." };
  }

  // 같은 이메일을 다른 계정이 이미 확정 인증했는지 확인(중복 방지).
  const { data: dup } = await c
    .from("users")
    .select("id")
    .ilike("email", email)
    .neq("id", user.id)
    .limit(1);
  if (dup && dup.length) {
    return {
      ok: false,
      reason: "이 이메일은 이미 다른 계정에서 인증되었습니다.",
    };
  }

  const { error: upErr } = await c
    .from("users")
    .update({
      email,
      email_verified: true,
      email_verify_token_hash: null,
      email_verify_email: null,
      email_verify_expires_at: null,
    })
    .eq("id", user.id);
  if (upErr) {
    // 유니크 인덱스 충돌(동시 인증) 등.
    if (/duplicate key|unique|23505/i.test(upErr.message || "")) {
      return {
        ok: false,
        reason: "이 이메일은 이미 다른 계정에서 인증되었습니다.",
      };
    }
    throw new Error(`verifyEmailToken(update): ${upErr.message}`);
  }
  return { ok: true, user: { ...user, email, email_verified: true } };
}

// 관리자 승인/승인취소.
async function setApproved(userId, approved, byUserId = null) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const update = {
    approved: !!approved,
    approved_at: approved ? new Date().toISOString() : null,
    approved_by: approved ? byUserId || null : null,
  };
  const { data, error } = await c
    .from("users")
    .update(update)
    .eq("id", userId)
    .select()
    .single();
  if (error) throw new Error(`setApproved: ${error.message}`);
  return data;
}

// ID 기반 비번 검증 (본인 비번 변경 시 사용)
async function verifyUserPassword(userId, password) {
  const user = await findUserById(userId);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

// ── Usage tracking ──────────────────────────────────────────────────────────

// ── Credit-based balance system (보고서 종류별 USD 잔액) ──────────────────────
// users.pre_credits_usd  — 화학 사전 잔액
// users.result_credits_usd — 결과보고서 (화학·물리 공통) 잔액
// 작업 시작 전: 잔액 ≥ 단가 검증 → 부족하면 거부
// 작업 끝: 단가만큼 차감 (실제 Anthropic 비용 무관 — 고정 가격)

/**
 * 종류별 잔액 검증.
 * @param {string} userId
 * @param {"pre"|"result"} creditField
 * @param {number} priceUsd 보고서 단가
 */
async function checkCreditBalance(userId, creditField, priceUsd) {
  const user = await findUserById(userId);
  if (!user) return { ok: false, reason: "사용자를 찾을 수 없습니다." };

  const colName =
    creditField === "pre" ? "pre_credits_usd" : "result_credits_usd";
  const balance = Number(user[colName]) || 0;
  const label = creditField === "pre" ? "사전보고서" : "결과보고서";

  if (balance < priceUsd) {
    const remaining = balance.toFixed(3);
    const need = priceUsd.toFixed(2);
    return {
      ok: false,
      user,
      reason: `${label} 잔액 부족 (보유 $${remaining} / 1건 $${need}). 관리자에게 충전 요청하세요.`,
    };
  }
  return { ok: true, user, balance };
}

/**
 * 종류별 잔액 차감 (작업 끝 후).
 * @param {string} userId
 * @param {"pre"|"result"} creditField
 * @param {number} priceUsd
 * @returns {Promise<{ newBalance: number }>}
 */
async function deductCredit(userId, creditField, priceUsd) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const colName =
    creditField === "pre" ? "pre_credits_usd" : "result_credits_usd";

  // 1순위: 원자적 차감 RPC. 단일 UPDATE ... RETURNING이라 동시 요청에서도
  // 잃어버린 갱신(lost update)·이중 차감이 없다. Supabase에 deduct_credit
  // 함수가 아직 없으면(미생성) 아래 폴백으로 내려간다.
  // 활성화 SQL은 db/credit-rpc.sql 참고.
  const rpc = await c.rpc("deduct_credit", {
    p_user_id: userId,
    p_col: colName,
    p_amount: priceUsd,
  });
  if (!rpc.error) {
    const newBalance = Number(rpc.data);
    if (Number.isFinite(newBalance)) return { newBalance, atomic: true };
    throw new Error("deductCredit(rpc): 반환값이 숫자가 아님");
  }
  // 함수 미존재(PGRST202 / 42883)면 폴백, 그 외 진짜 에러는 던진다.
  const rpcMsg = `${rpc.error.message || ""} ${rpc.error.code || ""} ${rpc.error.hint || ""}`;
  const fnMissing =
    /PGRST202|42883|could not find the function|does not exist/i.test(rpcMsg);
  if (!fnMissing) throw new Error(`deductCredit(rpc): ${rpc.error.message}`);

  // 폴백: 비원자 read-modify-write (RPC 미생성 환경). 동작은 기존과 동일하나
  // 동시성 보호가 없으므로, 위 RPC를 생성해 두는 것을 권장한다.
  const user = await findUserById(userId);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  const current = Number(user[colName]) || 0;
  const newBalance = Math.max(current - priceUsd, 0);
  const { error } = await c
    .from("users")
    .update({ [colName]: newBalance })
    .eq("id", userId);
  if (error) throw new Error(`deductCredit: ${error.message}`);
  return { newBalance, atomic: false };
}

/**
 * 종류별 잔액 충전 (admin 전용).
 * @param {string} userId
 * @param {"pre"|"result"} creditField
 * @param {number} addUsd 추가할 금액 (USD)
 */
async function topupCredit(userId, creditField, addUsd) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const colName =
    creditField === "pre" ? "pre_credits_usd" : "result_credits_usd";
  const add = Number(addUsd);
  if (!Number.isFinite(add)) throw new Error("충전 금액이 올바르지 않습니다.");
  const user = await findUserById(userId);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  const current = Number(user[colName]) || 0;
  const newBalance = current + add;
  const { error } = await c
    .from("users")
    .update({ [colName]: newBalance })
    .eq("id", userId);
  if (error) throw new Error(`topupCredit: ${error.message}`);
  return { newBalance };
}

// ── 통합 크레딧 포인트(정수) — 모델별 과금(Opus 3 / Sonnet 1) ─────────────────
// users.credits 사용. 위 *_credits_usd(pre/result)는 레거시로 보존만 함.

async function getCredits(userId) {
  const user = await findUserById(userId);
  if (!user) return 0;
  return Math.max(0, Math.trunc(Number(user.credits) || 0));
}

// 원자적 차감. spend_credits RPC 우선, 미생성 시 read-modify-write 폴백.
async function spendCredits(userId, amount) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const amt = Math.trunc(Number(amount) || 0);
  if (amt < 0) throw new Error(`invalid amount: ${amount}`);
  if (amt === 0) return { newBalance: await getCredits(userId), atomic: true };

  const rpc = await c.rpc("spend_credits", {
    p_user_id: userId,
    p_amount: amt,
  });
  if (!rpc.error) {
    const newBalance = Number(rpc.data);
    if (Number.isFinite(newBalance)) return { newBalance, atomic: true };
    throw new Error("spendCredits(rpc): 반환값이 숫자가 아님");
  }
  const rpcMsg = `${rpc.error.message || ""} ${rpc.error.code || ""} ${rpc.error.hint || ""}`;
  const fnMissing =
    /PGRST202|42883|could not find the function|does not exist/i.test(rpcMsg);
  if (!fnMissing) throw new Error(`spendCredits(rpc): ${rpc.error.message}`);

  // 폴백 (비원자 read-modify-write)
  const user = await findUserById(userId);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  const current = Math.max(0, Math.trunc(Number(user.credits) || 0));
  const newBalance = Math.max(current - amt, 0);
  const { error } = await c
    .from("users")
    .update({ credits: newBalance })
    .eq("id", userId);
  if (error) throw new Error(`spendCredits: ${error.message}`);
  return { newBalance, atomic: false };
}

// 정수 크레딧 충전 (admin).
async function addCredits(userId, amount) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const amt = Math.trunc(Number(amount) || 0);
  if (!Number.isFinite(amt) || amt <= 0)
    throw new Error(`invalid amount: ${amount}`);
  const user = await findUserById(userId);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  const current = Math.max(0, Math.trunc(Number(user.credits) || 0));
  const newBalance = current + amt;
  const { error } = await c
    .from("users")
    .update({ credits: newBalance })
    .eq("id", userId);
  if (error) throw new Error(`addCredits: ${error.message}`);
  return { newBalance };
}

/**
 * Legacy: spent_usd 누적 + usage_logs 기록.
 * 작업이 끝난 후 호출. 잔액 차감은 deductCredit이 별도로 처리.
 */
async function recordUsage({
  userId,
  jobId,
  textCostUsd = 0,
  imageCostUsd = 0,
  meta = null,
}) {
  const c = getClient();
  if (!c) return;
  const total = Number(textCostUsd) + Number(imageCostUsd);

  // 1) usage_logs row (실제 Anthropic 비용)
  const { error: logErr } = await c.from("usage_logs").insert({
    user_id: userId,
    job_id: jobId,
    text_cost_usd: textCostUsd,
    image_cost_usd: imageCostUsd,
    total_usd: total,
    meta,
  });
  if (logErr) throw new Error(`recordUsage(log): ${logErr.message}`);

  // 2) users.spent_usd 누적 (admin 통계용 — 실제 Anthropic 비용 누계)
  const user = await findUserById(userId);
  if (!user) return;
  const newSpent = Number(user.spent_usd || 0) + total;
  await updateUser(userId, { spentUsd: newSpent });
}

// ── Usage log retrieval (admin only) ─────────────────────────────────────────

/**
 * 최근 사용 로그 N건을 user 이름과 join하여 반환.
 * @param {number} limit 최대 행 수 (기본 100)
 */
async function listUsageLogs(limit = 100) {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c
    .from("usage_logs")
    .select("id, job_id, total_usd, text_cost_usd, image_cost_usd, meta, created_at, users(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listUsageLogs: ${error.message}`);
  return (data || []).map((row) => ({
    id: row.id,
    job_id: row.job_id,
    total_usd: row.total_usd,
    text_cost_usd: row.text_cost_usd,
    image_cost_usd: row.image_cost_usd,
    meta: row.meta || {},
    created_at: row.created_at,
    user_name: row.users?.name || "(삭제된 사용자)",
  }));
}

/**
 * 특정 사용자의 최근 사용 로그 N건 (본인 대시보드용).
 * 테이블/컬럼 문제 시 빈 배열로 graceful degrade.
 */
async function listUsageLogsForUser(userId, limit = 20) {
  const c = getClient();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c
      .from("usage_logs")
      .select("id, job_id, total_usd, meta, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(1, limit), 100));
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      job_id: row.job_id,
      total_usd: row.total_usd,
      meta: row.meta || {},
      created_at: row.created_at,
    }));
  } catch (e) {
    console.warn("[usage] listUsageLogsForUser:", e.message);
    return [];
  }
}

// ── Login logs (admin only) ──────────────────────────────────────────────────
async function recordLogin({
  userId = null,
  userName = "",
  ip = "",
  userAgent = "",
  success = true,
}) {
  const c = getClient();
  if (!c) return;
  try {
    await c.from("login_logs").insert({
      user_id: userId,
      user_name: String(userName || "").slice(0, 80),
      ip: String(ip || "").slice(0, 64),
      user_agent: String(userAgent || "").slice(0, 300),
      success: !!success,
    });
  } catch (e) {
    console.warn("[login-log] record:", e.message);
  }
}

async function listLoginLogs(limit = 100) {
  const c = getClient();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("login_logs")
      .select("id, user_name, ip, success, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(1, limit), 500));
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn("[login-log] list:", e.message);
    return [];
  }
}

// ── 건의사항/피드백 조회 (admin only) ────────────────────────────────────────
async function listFeedback(limit = 30) {
  const c = getClient();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("feedback_reports")
      .select("category, title, message, user_name, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(1, limit), 100));
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn("[feedback] list:", e.message);
    return [];
  }
}

// ── Generated report file storage (24h retention) ────────────────────────────

function reportStorageConfig() {
  return {
    bucket: REPORT_BUCKET,
    retentionHours: REPORT_RETENTION_HOURS,
    maxFilesPerUser: REPORT_MAX_FILES_PER_USER,
  };
}

function safeExt(filename, fallback = "docx") {
  const m = String(filename || "").match(/\.([A-Za-z0-9]{1,8})$/);
  return (m ? m[1] : fallback).toLowerCase();
}

function blobToBuffer(data) {
  if (Buffer.isBuffer(data)) return Promise.resolve(data);
  if (data && typeof data.arrayBuffer === "function") {
    return data.arrayBuffer().then((ab) => Buffer.from(ab));
  }
  if (data instanceof ArrayBuffer) return Promise.resolve(Buffer.from(data));
  return Promise.resolve(Buffer.from(data || []));
}

async function ensureReportBucket() {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");

  const { error: getErr } = await c.storage.getBucket(REPORT_BUCKET);
  if (!getErr) return;

  const { error: createErr } = await c.storage.createBucket(REPORT_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: [
      "application/hwp+zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
    ],
  });
  if (createErr && !/already exists/i.test(createErr.message || "")) {
    throw new Error(`ensureReportBucket: ${createErr.message}`);
  }
}

async function saveReportFile({
  userId,
  jobId,
  reportType,
  filename,
  mimeType,
  buffer,
  meta = null,
}) {
  const c = getClient();
  if (!c) return null;
  if (!userId || !buffer) return null;

  await ensureReportBucket();
  await cleanupExpiredReportFiles(50).catch(() => {});

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + REPORT_RETENTION_HOURS * 60 * 60 * 1000,
  );
  const ext = safeExt(filename);
  const objectPath = `${userId}/${jobId || crypto.randomUUID()}/${crypto
    .randomBytes(8)
    .toString("hex")}.${ext}`;

  const { error: uploadErr } = await c.storage
    .from(REPORT_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadErr) throw new Error(`saveReportFile(upload): ${uploadErr.message}`);

  const { data, error: insertErr } = await c
    .from("report_files")
    .insert({
      user_id: userId,
      job_id: jobId || null,
      report_type: reportType || null,
      filename,
      bucket: REPORT_BUCKET,
      object_path: objectPath,
      mime_type: mimeType || "application/octet-stream",
      size_bytes: buffer.length || 0,
      expires_at: expiresAt.toISOString(),
      meta,
    })
    .select()
    .single();

  if (insertErr) {
    await c.storage.from(REPORT_BUCKET).remove([objectPath]).catch(() => {});
    throw new Error(`saveReportFile(db): ${insertErr.message}`);
  }

  await cleanupOverflowReportFiles(userId).catch(() => {});
  return data;
}

async function listReportFiles(userId, limit = REPORT_MAX_FILES_PER_USER) {
  const c = getClient();
  if (!c || !userId) return [];
  await cleanupExpiredReportFiles(50).catch(() => {});
  await cleanupOverflowReportFiles(userId, REPORT_MAX_FILES_PER_USER).catch(() => {});
  const { data, error } = await c
    .from("report_files")
    .select(
      "id, job_id, report_type, filename, mime_type, size_bytes, created_at, expires_at",
    )
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listReportFiles: ${error.message}`);
  return data || [];
}

async function downloadReportFile(userId, fileId) {
  const c = getClient();
  if (!c || !userId || !fileId) return null;
  const { data: row, error } = await c
    .from("report_files")
    .select("*")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`downloadReportFile(row): ${error.message}`);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteReportFile(userId, fileId).catch(() => {});
    return null;
  }

  const { data, error: downloadErr } = await c.storage
    .from(row.bucket || REPORT_BUCKET)
    .download(row.object_path);
  if (downloadErr) {
    throw new Error(`downloadReportFile(storage): ${downloadErr.message}`);
  }
  return { row, buffer: await blobToBuffer(data) };
}

async function deleteReportFile(userId, fileId) {
  const c = getClient();
  if (!c || !userId || !fileId) return false;
  const { data: row, error } = await c
    .from("report_files")
    .select("id, bucket, object_path")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`deleteReportFile(row): ${error.message}`);
  if (!row) return false;

  await c.storage
    .from(row.bucket || REPORT_BUCKET)
    .remove([row.object_path])
    .catch(() => {});
  const { error: deleteErr } = await c
    .from("report_files")
    .delete()
    .eq("id", row.id);
  if (deleteErr) throw new Error(`deleteReportFile(db): ${deleteErr.message}`);
  return true;
}

async function cleanupExpiredReportFiles(limit = 200) {
  const c = getClient();
  if (!c) return { deleted: 0 };
  const { data: rows, error } = await c
    .from("report_files")
    .select("id, bucket, object_path")
    .lte("expires_at", new Date().toISOString())
    .limit(limit);
  if (error) throw new Error(`cleanupExpiredReportFiles(select): ${error.message}`);
  if (!rows || rows.length === 0) return { deleted: 0 };

  const byBucket = new Map();
  for (const row of rows) {
    const bucket = row.bucket || REPORT_BUCKET;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(row.object_path);
  }
  for (const [bucket, paths] of byBucket) {
    await c.storage.from(bucket).remove(paths).catch(() => {});
  }
  const ids = rows.map((row) => row.id);
  const { error: deleteErr } = await c.from("report_files").delete().in("id", ids);
  if (deleteErr) throw new Error(`cleanupExpiredReportFiles(delete): ${deleteErr.message}`);
  return { deleted: rows.length };
}

async function cleanupOverflowReportFiles(
  userId,
  keep = REPORT_MAX_FILES_PER_USER,
) {
  const c = getClient();
  if (!c || !userId) return { deleted: 0 };
  const keepCount = Math.max(1, Number(keep) || REPORT_MAX_FILES_PER_USER);
  const { data: rows, error } = await c
    .from("report_files")
    .select("id, bucket, object_path")
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`cleanupOverflowReportFiles(select): ${error.message}`);
  if (!rows || rows.length <= keepCount) return { deleted: 0 };

  const excess = rows.slice(keepCount);
  const byBucket = new Map();
  for (const row of excess) {
    const bucket = row.bucket || REPORT_BUCKET;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(row.object_path);
  }
  for (const [bucket, paths] of byBucket) {
    await c.storage.from(bucket).remove(paths).catch(() => {});
  }

  const ids = excess.map((row) => row.id);
  const { error: deleteErr } = await c.from("report_files").delete().in("id", ids);
  if (deleteErr) throw new Error(`cleanupOverflowReportFiles(delete): ${deleteErr.message}`);
  return { deleted: excess.length };
}

// ── Feedback storage (optional table; email still works without it) ──────────

async function recordFeedback({
  userId,
  userName = "",
  category,
  title,
  message,
  contactEmail = "",
  pageUrl = "",
  userAgent = "",
  emailSent = false,
  emailError = "",
  meta = null,
}) {
  const c = getClient();
  if (!c) return null;
  const payload = {
    user_id: userId || null,
    user_name: userName,
    category,
    title,
    message,
    contact_email: contactEmail || null,
    page_url: pageUrl || null,
    user_agent: userAgent || null,
    email_sent: !!emailSent,
    email_error: emailError || null,
    meta,
  };
  const { data, error } = await c
    .from("feedback_reports")
    .insert(payload)
    .select()
    .single();
  if (error) {
    if (!userId) throw new Error(`recordFeedback: ${error.message}`);
    const fallbackMeta = {
      kind: "feedback",
      feedback: payload,
      feedbackTableError: error.message,
    };
    const { data: fallbackData, error: fallbackError } = await c
      .from("usage_logs")
      .insert({
        user_id: userId,
        job_id: "feedback",
        text_cost_usd: 0,
        image_cost_usd: 0,
        total_usd: 0,
        meta: fallbackMeta,
      })
      .select()
      .single();
    if (fallbackError) {
      throw new Error(
        `recordFeedback: ${error.message}; fallback usage_logs: ${fallbackError.message}`,
      );
    }
    return { ...fallbackData, fallback: "usage_logs" };
  }
  return data;
}

// ── Admin bootstrap ──────────────────────────────────────────────────────────

/**
 * ADMIN_NAME, ADMIN_PASSWORD 환경변수가 있으면 admin 사용자를 보장한다.
 * 이미 있으면 비밀번호 갱신 안 함 (수동 변경 보존).
 * 없으면 새로 생성, is_admin = true, budget = 0 (admin은 본인 작업 안 한다고 가정 — 필요시 수동 조정).
 */
async function ensureAdminFromEnv() {
  if (!isEnabled()) return null;
  const name = (process.env.ADMIN_NAME || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!name || !password) return null;
  if (password.length < 5) {
    console.warn(
      "⚠ ADMIN_PASSWORD가 5자 미만입니다. admin 계정 부트스트랩을 건너뜁니다.",
    );
    return null;
  }
  let admin = await findUserByName(name);
  if (admin) {
    if (!admin.is_admin) {
      const allowExisting =
        process.env.ADMIN_ALLOW_EXISTING_PROMOTION === "1";
      if (!allowExisting || !verifyPassword(password, admin.password_hash)) {
        throw new Error(
          "ADMIN_NAME과 같은 일반 사용자 계정이 이미 있어 관리자 승격을 중단했습니다. " +
            "계정을 직접 확인하거나 ADMIN_ALLOW_EXISTING_PROMOTION=1 및 일치하는 ADMIN_PASSWORD를 설정하세요.",
        );
      }
      await updateUser(admin.id, { isAdmin: true });
      admin = { ...admin, is_admin: true };
    }
    return admin;
  }
  return await createUser({
    name,
    password,
    budgetUsd: 1000, // admin은 사실상 무제한 (본인 보고서 만들 일도 있을 수 있으니 큰 값)
    isAdmin: true,
  });
}

// 7일 무활동 시 Supabase 무료 플랜이 자동 pause되는 걸 막기 위한 가벼운 쿼리.
// UptimeRobot 등 외부 모니터가 주기적으로 호출하도록 /api/keepalive에 노출.
async function ping() {
  const c = getClient();
  if (!c) return { ok: false, reason: "supabase not configured" };
  try {
    // 가장 가벼운 쿼리: users 테이블에서 1행 select (count(*)보다 가벼움)
    const { error } = await c.from("users").select("id").limit(1);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ── 베타 기능 플래그 + 테스터 지정 ──────────────────────────────────────────
// 테이블이 아직 없으면(마이그레이션 전) 읽기 경로는 안전하게 빈 값/false 를 돌려
// 본 사이트가 죽지 않게 한다. 쓰기 경로(admin)는 에러를 그대로 던져 안내한다.
function _betaTableMissing(error) {
  return error && /relation .*beta_(features|testers).* does not exist|could not find the table/i.test(error.message || "");
}

// 관리자용: 모든 베타 기능 + 각 기능의 테스터(이름 포함)
async function listBetaFeatures() {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c
    .from("beta_features")
    .select("key,label,enabled,created_at, testers:beta_testers(user_id, user:users(id,name))")
    .order("created_at", { ascending: true });
  if (error) {
    if (_betaTableMissing(error)) {
      const e = new Error("베타 테이블이 없습니다. db/migrations의 20260603_add_beta_features.sql 을 Supabase에 실행하세요.");
      e.code = "BETA_TABLE_MISSING";
      throw e;
    }
    throw new Error(`listBetaFeatures: ${error.message}`);
  }
  return (data || []).map((f) => ({
    key: f.key,
    label: f.label,
    enabled: !!f.enabled,
    testers: (f.testers || [])
      .map((t) => ({ id: t.user_id, name: t.user?.name || "" }))
      .filter((t) => t.name),
  }));
}

async function createBetaFeature(key, label) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c
    .from("beta_features")
    .insert({ key: String(key).trim(), label: String(label || "").trim() });
  if (error) throw new Error(`createBetaFeature: ${error.message}`);
}

// 기능이 없으면 생성(있으면 그대로 둠). 시작 시 코드 내장 베타를 관리자 패널에
// 자동 등록해 테스터 지정이 가능하게 한다. 테이블 없음/오류는 조용히 무시.
async function ensureBetaFeature(key, label) {
  const c = getClient();
  if (!c) return false;
  try {
    const { data } = await c
      .from("beta_features")
      .select("key")
      .eq("key", key)
      .maybeSingle();
    if (data) return false; // 이미 존재(활성/비활성 상태 보존)
    const { error } = await c
      .from("beta_features")
      .insert({ key: String(key).trim(), label: String(label || key).trim() });
    if (error) throw error;
    return true;
  } catch (_) {
    return false; // beta_features 테이블 미적용 등 → 무시
  }
}

// 범용 앱 설정(KV). app_settings 테이블 미적용/미설정이면 graceful 하게 null/false.
async function getAppSetting(key) {
  const c = getClient();
  if (!c) return null;
  try {
    const { data } = await c
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data ? data.value : null;
  } catch (_) {
    return null;
  }
}

async function setAppSetting(key, value) {
  const c = getClient();
  if (!c) return false;
  try {
    const { error } = await c
      .from("app_settings")
      .upsert(
        { key: String(key), value, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) throw error;
    return true;
  } catch (_) {
    return false;
  }
}

async function setBetaFeatureEnabled(key, enabled) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c
    .from("beta_features")
    .update({ enabled: !!enabled })
    .eq("key", key);
  if (error) throw new Error(`setBetaFeatureEnabled: ${error.message}`);
}

async function deleteBetaFeature(key) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c.from("beta_features").delete().eq("key", key);
  if (error) throw new Error(`deleteBetaFeature: ${error.message}`);
}

async function addBetaTester(key, userId) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c
    .from("beta_testers")
    .upsert({ feature_key: key, user_id: userId }, { onConflict: "feature_key,user_id" });
  if (error) throw new Error(`addBetaTester: ${error.message}`);
}

async function removeBetaTester(key, userId) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const { error } = await c
    .from("beta_testers")
    .delete()
    .eq("feature_key", key)
    .eq("user_id", userId);
  if (error) throw new Error(`removeBetaTester: ${error.message}`);
}

// 이 사용자가 접근 가능한(enabled + 테스터로 지정된) 베타 기능 key 목록.
// 테이블이 없거나 오류면 빈 배열 — 접근 차단(안전한 기본값).
async function getUserBetaFeatures(userId) {
  const c = getClient();
  if (!c || !userId) return [];
  try {
    const { data: t, error: e1 } = await c
      .from("beta_testers")
      .select("feature_key")
      .eq("user_id", userId);
    if (e1) throw e1;
    const keys = (t || []).map((r) => r.feature_key);
    if (!keys.length) return [];
    const { data: f, error: e2 } = await c
      .from("beta_features")
      .select("key")
      .eq("enabled", true)
      .in("key", keys);
    if (e2) throw e2;
    return (f || []).map((r) => r.key);
  } catch (e) {
    if (!_betaTableMissing(e)) {
      console.warn("[beta] getUserBetaFeatures:", e.message);
    }
    return [];
  }
}

async function userHasBeta(userId, key) {
  const features = await getUserBetaFeatures(userId);
  return features.includes(key);
}

// ── API 키 위임(grant) — 관리자가 지정한 사용자에게 기간 한정 무료 사용권 ──────────
// "관리자 키로 사용" = 위임 기간 동안 그 사용자의 보고서 생성 + 파일 챗봇이 크레딧
// 차감 없이 서버 키로 실행된다. 개인 키 저장은 하지 않는다.
// 테이블이 아직 없으면(마이그레이션 전) 읽기 경로는 안전하게 null/[] 를 돌려 본 사이트가
// 죽지 않게 한다. 쓰기 경로(admin)는 안내 가능한 에러(GRANT_TABLE_MISSING)를 던진다.
function _grantTableMissing(error) {
  return (
    error &&
    /relation .*api_key_grants.* does not exist|could not find the table/i.test(
      error.message || "",
    )
  );
}

// 이 사용자의 현재 활성 위임(만료 전 + 회수 안 됨) 1건. 없으면 null.
async function getActiveGrant(userId) {
  const c = getClient();
  if (!c || !userId) return null;
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await c
      .from("api_key_grants")
      .select("id, user_id, granted_by, expires_at, note, created_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data && data[0]) || null;
  } catch (e) {
    if (!_grantTableMissing(e)) {
      console.warn("[grant] getActiveGrant:", e.message);
    }
    return null;
  }
}

// 관리자용: 위임 목록(사용자 이름 포함). activeOnly=true 면 활성만.
// 사용자 이름은 FK 임베드 대신 별도 쿼리로 매핑(2개의 users FK 모호성 회피).
async function listGrants({ activeOnly = false } = {}) {
  const c = getClient();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("api_key_grants")
      .select(
        "id, user_id, granted_by, expires_at, note, revoked_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const nowMs = Date.now();
    let rows = (data || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      grantedBy: r.granted_by,
      expiresAt: r.expires_at,
      note: r.note || "",
      revokedAt: r.revoked_at,
      createdAt: r.created_at,
      active: !r.revoked_at && new Date(r.expires_at).getTime() > nowMs,
    }));
    if (activeOnly) rows = rows.filter((r) => r.active);

    if (rows.length) {
      const nameMap = {};
      try {
        const ids = [
          ...new Set(
            rows.flatMap((r) => [r.userId, r.grantedBy].filter(Boolean)),
          ),
        ];
        if (ids.length) {
          const { data: us } = await c
            .from("users")
            .select("id, name")
            .in("id", ids);
          for (const u of us || []) nameMap[u.id] = u.name;
        }
      } catch (_) {
        /* 이름 매핑 실패는 무시(목록은 id 로라도 표시) */
      }
      rows = rows.map((r) => ({
        ...r,
        userName: nameMap[r.userId] || "(삭제된 사용자)",
        grantedByName: r.grantedBy ? nameMap[r.grantedBy] || "" : "",
      }));
    }
    return rows;
  } catch (e) {
    if (_grantTableMissing(e)) {
      const err = new Error(
        "위임 테이블이 없습니다. db/migrations 의 20260620_add_api_key_grants.sql 을 Supabase에 실행하세요.",
      );
      err.code = "GRANT_TABLE_MISSING";
      throw err;
    }
    throw new Error(`listGrants: ${e.message}`);
  }
}

// 관리자: 위임 생성. { userId, grantedBy, expiresAt(ISO), note }
async function createGrant({ userId, grantedBy = null, expiresAt, note = "" }) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  if (!userId) throw new Error("대상 사용자가 필요합니다.");
  const exp = new Date(expiresAt);
  if (isNaN(exp.getTime())) throw new Error("만료 일시가 올바르지 않습니다.");
  if (exp.getTime() <= Date.now()) {
    throw new Error("만료 일시는 현재 이후여야 합니다.");
  }
  const { data, error } = await c
    .from("api_key_grants")
    .insert({
      user_id: userId,
      granted_by: grantedBy || null,
      expires_at: exp.toISOString(),
      note: String(note || "").slice(0, 200),
    })
    .select()
    .single();
  if (error) {
    if (_grantTableMissing(error)) {
      const err = new Error(
        "위임 테이블이 없습니다. db/migrations 의 20260620_add_api_key_grants.sql 을 Supabase에 실행하세요.",
      );
      err.code = "GRANT_TABLE_MISSING";
      throw err;
    }
    throw new Error(`createGrant: ${error.message}`);
  }
  return data;
}

// 관리자: 위임 회수(즉시 만료 처리). 이미 회수된 건 그대로.
async function revokeGrant(grantId) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  if (!grantId) throw new Error("위임 id 가 필요합니다.");
  const { error } = await c
    .from("api_key_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null);
  if (error) throw new Error(`revokeGrant: ${error.message}`);
}

// ── 백그라운드 실행 구독(background_subscriptions) ─────────────────────────────
// api_key_grants 와 같은 "기간 한정 per-user 권한" 구조. 백그라운드 보고서 실행 전용.
// 나중에 월 결제 웹훅이 createBackgroundSub({ expiresAt }) 만 호출하면 구독제로 확장된다.
function _bgTableMissing(error) {
  const m = `${error?.message || ""} ${error?.code || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /42P01|PGRST205|PGRST202|does not exist|could not find the table|schema cache/i.test(
    m,
  );
}

// 이 사용자의 현재 활성 백그라운드 구독(만료 전 + 회수 안 됨) 1건. 없으면 null.
async function getActiveBackgroundSub(userId) {
  const c = getClient();
  if (!c || !userId) return null;
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await c
      .from("background_subscriptions")
      .select("id, user_id, granted_by, expires_at, note, created_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data && data[0]) || null;
  } catch (e) {
    if (!_bgTableMissing(e)) {
      console.warn("[bgsub] getActiveBackgroundSub:", e.message);
    }
    return null;
  }
}

// 관리자용: 구독 목록(사용자 이름 포함). activeOnly=true 면 활성만.
async function listBackgroundSubs({ activeOnly = false } = {}) {
  const c = getClient();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("background_subscriptions")
      .select(
        "id, user_id, granted_by, expires_at, note, revoked_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const nowMs = Date.now();
    let rows = (data || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      grantedBy: r.granted_by,
      expiresAt: r.expires_at,
      note: r.note || "",
      revokedAt: r.revoked_at,
      createdAt: r.created_at,
      active: !r.revoked_at && new Date(r.expires_at).getTime() > nowMs,
    }));
    if (activeOnly) rows = rows.filter((r) => r.active);

    if (rows.length) {
      const nameMap = {};
      try {
        const ids = [
          ...new Set(
            rows.flatMap((r) => [r.userId, r.grantedBy].filter(Boolean)),
          ),
        ];
        if (ids.length) {
          const { data: us } = await c
            .from("users")
            .select("id, name")
            .in("id", ids);
          for (const u of us || []) nameMap[u.id] = u.name;
        }
      } catch (_) {
        /* 이름 매핑 실패는 무시(목록은 id 로라도 표시) */
      }
      rows = rows.map((r) => ({
        ...r,
        userName: nameMap[r.userId] || "(삭제된 사용자)",
        grantedByName: r.grantedBy ? nameMap[r.grantedBy] || "" : "",
      }));
    }
    return rows;
  } catch (e) {
    if (_bgTableMissing(e)) {
      const err = new Error(
        "백그라운드 구독 테이블이 없습니다. db/migrations 의 20260627_add_background_feature.sql 을 Supabase에 실행하세요.",
      );
      err.code = "BG_SUB_TABLE_MISSING";
      throw err;
    }
    throw new Error(`listBackgroundSubs: ${e.message}`);
  }
}

// 관리자: 구독 부여. { userId, grantedBy, expiresAt(ISO), note }
async function createBackgroundSub({
  userId,
  grantedBy = null,
  expiresAt,
  note = "",
}) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  if (!userId) throw new Error("대상 사용자가 필요합니다.");
  const exp = new Date(expiresAt);
  if (isNaN(exp.getTime())) throw new Error("만료 일시가 올바르지 않습니다.");
  if (exp.getTime() <= Date.now()) {
    throw new Error("만료 일시는 현재 이후여야 합니다.");
  }
  const { data, error } = await c
    .from("background_subscriptions")
    .insert({
      user_id: userId,
      granted_by: grantedBy || null,
      expires_at: exp.toISOString(),
      note: String(note || "").slice(0, 200),
    })
    .select()
    .single();
  if (error) {
    if (_bgTableMissing(error)) {
      const err = new Error(
        "백그라운드 구독 테이블이 없습니다. db/migrations 의 20260627_add_background_feature.sql 을 Supabase에 실행하세요.",
      );
      err.code = "BG_SUB_TABLE_MISSING";
      throw err;
    }
    throw new Error(`createBackgroundSub: ${error.message}`);
  }
  return data;
}

// 관리자: 구독 회수(즉시 만료 처리). 이미 회수된 건 그대로.
async function revokeBackgroundSub(subId) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  if (!subId) throw new Error("구독 id 가 필요합니다.");
  const { error } = await c
    .from("background_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", subId)
    .is("revoked_at", null);
  if (error) throw new Error(`revokeBackgroundSub: ${error.message}`);
}

// ── 백그라운드 작업 영속화(report_jobs) ────────────────────────────────────────
// 백그라운드 보고서 작업 상태를 저장 → 재배포/재시작에도 '내 작업'에서 추적.
// 데이터 조작 방지: 결과 파일 binary 는 저장하지 않고 report_files.id(file_id)만 참조한다.
async function upsertReportJob(job) {
  const c = getClient();
  if (!c || !job || !job.id || !job.userId) return null;
  try {
    const row = {
      id: String(job.id),
      user_id: job.userId,
      report_type: job.reportType || "",
      model: job.model || "",
      status: job.status || "running",
      filename: job.filename || null,
      file_id: job.fileId || null,
      error: job.error ? String(job.error).slice(0, 1000) : null,
      progress: Array.isArray(job.progress) ? job.progress.slice(-15) : [],
      background: job.background !== false,
      notify_email: !!job.notifyEmail,
      notified: !!job.notified,
      updated_at: new Date().toISOString(),
    };
    const { error } = await c
      .from("report_jobs")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return true;
  } catch (e) {
    if (!_bgTableMissing(e)) console.warn("[bgjob] upsertReportJob:", e.message);
    return null;
  }
}

// '내 작업' 목록(최근순). 완료본은 파일함(report_files)에도 나타난다.
async function listReportJobs(userId, { limit = 20 } = {}) {
  const c = getClient();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c
      .from("report_jobs")
      .select(
        "id, report_type, model, status, filename, file_id, error, background, notify_email, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(50, Math.max(1, limit)));
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      reportType: r.report_type,
      model: r.model,
      status: r.status,
      filename: r.filename,
      fileId: r.file_id,
      error: r.error,
      background: r.background,
      notifyEmail: r.notify_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (e) {
    if (!_bgTableMissing(e)) console.warn("[bgjob] listReportJobs:", e.message);
    return [];
  }
}

// 부팅 시: 이전 프로세스에서 'running' 으로 남은 작업을 'interrupted' 로 정리.
// (in-memory job 은 재시작으로 사라졌으므로 더는 진행되지 않는다. 크레딧은 생성 성공 후
//  마지막에만 차감되므로 중단 작업은 애초에 미차감 → 환불 불필요.)
async function reconcileRunningJobs() {
  const c = getClient();
  if (!c) return 0;
  try {
    const { data, error } = await c
      .from("report_jobs")
      .update({
        status: "interrupted",
        error: "서버 재시작으로 중단되었습니다 — 다시 생성해 주세요.",
        updated_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .select("id");
    if (error) throw error;
    return (data || []).length;
  } catch (e) {
    if (!_bgTableMissing(e)) {
      console.warn("[bgjob] reconcileRunningJobs:", e.message);
    }
    return 0;
  }
}

// ── Cloud storage connections (Dropbox 등 외부 클라우드 연동) ───────────────────
// refresh_token 은 호출부(server)에서 CLOUD_TOKEN_SECRET 으로 암호화한 문자열을 받는다.
async function saveCloudConnection(
  userId,
  provider,
  { refreshToken, accountEmail, accountName },
) {
  const c = getClient();
  if (!c || !userId || !provider) return null;
  const { data, error } = await c
    .from("cloud_connections")
    .upsert(
      {
        user_id: userId,
        provider,
        refresh_token: refreshToken,
        account_email: accountEmail || null,
        account_name: accountName || null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    )
    .select()
    .single();
  if (error) throw new Error(`saveCloudConnection: ${error.message}`);
  return data;
}

async function getCloudConnection(userId, provider) {
  const c = getClient();
  if (!c || !userId || !provider) return null;
  const { data, error } = await c
    .from("cloud_connections")
    .select(
      "user_id, provider, refresh_token, account_email, account_name, connected_at",
    )
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`getCloudConnection: ${error.message}`);
  return data || null;
}

async function deleteCloudConnection(userId, provider) {
  const c = getClient();
  if (!c || !userId || !provider) return false;
  const { error } = await c
    .from("cloud_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error(`deleteCloudConnection: ${error.message}`);
  return true;
}

module.exports = {
  isEnabled,
  getClient,
  findUserByName,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  isReportEligible,
  setEmailVerification,
  verifyEmailToken,
  setApproved,
  normalizeBlockedTypes,
  getBlockedReportTypes,
  listBlockedReportTypesMap,
  listBetaFeatures,
  createBetaFeature,
  ensureBetaFeature,
  getAppSetting,
  setAppSetting,
  setBetaFeatureEnabled,
  deleteBetaFeature,
  addBetaTester,
  removeBetaTester,
  getUserBetaFeatures,
  userHasBeta,
  getActiveGrant,
  listGrants,
  createGrant,
  revokeGrant,
  getActiveBackgroundSub,
  listBackgroundSubs,
  createBackgroundSub,
  revokeBackgroundSub,
  upsertReportJob,
  listReportJobs,
  reconcileRunningJobs,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  authenticate,
  verifyUserPassword,
  checkCreditBalance,
  deductCredit,
  topupCredit,
  getCredits,
  spendCredits,
  addCredits,
  recordUsage,
  listUsageLogs,
  listUsageLogsForUser,
  recordLogin,
  listLoginLogs,
  reportStorageConfig,
  saveReportFile,
  listReportFiles,
  downloadReportFile,
  deleteReportFile,
  cleanupExpiredReportFiles,
  recordFeedback,
  listFeedback,
  saveCloudConnection,
  getCloudConnection,
  deleteCloudConnection,
  ensureAdminFromEnv,
  ping,
};
