// Supabase 클라이언트 + DB 헬퍼.
// SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수가 모두 있으면 동작.
// 없으면 isEnabled() === false → 호출자가 fallback 처리.

const { createClient } = require("@supabase/supabase-js");
const { hashPassword, verifyPassword } = require("./auth");

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
  const { data, error } = await c
    .from("users")
    .select("*")
    .ilike("name", name)
    .maybeSingle();
  if (error) throw new Error(`findUserByName: ${error.message}`);
  return data;
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

async function listUsers() {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c
    .from("users")
    .select("id, name, budget_usd, spent_usd, is_admin, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return data || [];
}

async function createUser({ name, password, budgetUsd, isAdmin = false }) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const password_hash = hashPassword(password);
  const { data, error } = await c
    .from("users")
    .insert({
      name,
      password_hash,
      budget_usd: Number(budgetUsd) || 0,
      is_admin: !!isAdmin,
    })
    .select()
    .single();
  if (error) throw new Error(`createUser: ${error.message}`);
  return data;
}

async function updateUser(id, patch) {
  const c = getClient();
  if (!c) throw new Error("Supabase 미설정");
  const update = {};
  if (patch.name != null) update.name = patch.name;
  if (patch.password != null && patch.password !== "")
    update.password_hash = hashPassword(patch.password);
  if (patch.budgetUsd != null) update.budget_usd = Number(patch.budgetUsd);
  if (patch.isAdmin != null) update.is_admin = !!patch.isAdmin;
  if (patch.spentUsd != null) update.spent_usd = Number(patch.spentUsd);
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

async function authenticate(name, password) {
  const user = await findUserByName(name);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

// ID 기반 비번 검증 (본인 비번 변경 시 사용)
async function verifyUserPassword(userId, password) {
  const user = await findUserById(userId);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

// ── Usage tracking ──────────────────────────────────────────────────────────

/**
 * 작업 시작 전 한도 검증.
 * @returns {{ ok: boolean, user?: object, reason?: string }}
 */
async function checkBudget(userId) {
  const user = await findUserById(userId);
  if (!user) return { ok: false, reason: "사용자를 찾을 수 없습니다." };
  const spent = Number(user.spent_usd) || 0;
  const budget = Number(user.budget_usd) || 0;
  if (budget <= 0) {
    return {
      ok: false,
      user,
      reason: "예산이 설정되지 않았습니다. 관리자에게 요청하세요.",
    };
  }
  if (spent >= budget) {
    return {
      ok: false,
      user,
      reason: `예산을 모두 사용했습니다 (사용 $${spent.toFixed(3)} / 한도 $${budget.toFixed(2)}). 관리자에게 추가 요청하세요.`,
    };
  }
  return { ok: true, user };
}

/**
 * 작업이 끝난 후 사용량 기록 + users.spent_usd 누적.
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

  // 1) usage_logs row
  const { error: logErr } = await c.from("usage_logs").insert({
    user_id: userId,
    job_id: jobId,
    text_cost_usd: textCostUsd,
    image_cost_usd: imageCostUsd,
    total_usd: total,
    meta,
  });
  if (logErr) throw new Error(`recordUsage(log): ${logErr.message}`);

  // 2) users.spent_usd 증가 — 단순 SELECT/UPDATE (race condition 가능하지만 단일 사용자 기준 동시성 낮음)
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
    // 권한만 보장 (이미 있으면 비번 보존)
    if (!admin.is_admin) {
      await updateUser(admin.id, { isAdmin: true });
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

module.exports = {
  isEnabled,
  getClient,
  findUserByName,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  authenticate,
  verifyUserPassword,
  checkBudget,
  recordUsage,
  listUsageLogs,
  ensureAdminFromEnv,
  ping,
};
