// In-memory rate limiting.
// 무료 Render 단일 인스턴스 환경 가정. 재시작하면 카운터 리셋(=의도된 release valve).

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

// ── 보고서 생성 (per-user) ──────────────────────────────────────────────────
const GEN_LIMIT = 5; // 시간당 5건
const userGenAttempts = new Map(); // userId -> [timestamp, ...]

function _pruneAndGet(userId) {
  const now = Date.now();
  const attempts = (userGenAttempts.get(userId) || []).filter(
    (t) => now - t < ONE_HOUR_MS,
  );
  userGenAttempts.set(userId, attempts);
  return attempts;
}

function checkUserGenLimit(userId) {
  const attempts = _pruneAndGet(userId);
  if (attempts.length >= GEN_LIMIT) {
    const oldest = Math.min(...attempts);
    return {
      allowed: false,
      unlockAt: oldest + ONE_HOUR_MS,
      count: attempts.length,
      limit: GEN_LIMIT,
    };
  }
  return { allowed: true, count: attempts.length, limit: GEN_LIMIT };
}

function recordUserGenAttempt(userId) {
  const attempts = userGenAttempts.get(userId) || [];
  attempts.push(Date.now());
  userGenAttempts.set(userId, attempts);
}

function unlockUser(userId) {
  userGenAttempts.delete(userId);
}

function getUserGenCount(userId) {
  return _pruneAndGet(userId).length;
}

// ── 로그인 (per-IP) ──────────────────────────────────────────────────────────
const LOGIN_LIMIT = 10; // 분당 10회
const loginAttemptsByIp = new Map(); // ip -> [timestamp, ...]

function checkLoginLimit(ip) {
  const now = Date.now();
  const attempts = (loginAttemptsByIp.get(ip) || []).filter(
    (t) => now - t < ONE_MIN_MS,
  );
  loginAttemptsByIp.set(ip, attempts);
  return {
    allowed: attempts.length < LOGIN_LIMIT,
    count: attempts.length,
    limit: LOGIN_LIMIT,
  };
}

function recordLoginAttempt(ip) {
  const attempts = loginAttemptsByIp.get(ip) || [];
  attempts.push(Date.now());
  loginAttemptsByIp.set(ip, attempts);
}

// 주기적 정리 (메모리 leak 방지) — 30분마다 만료된 항목 청소
setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of userGenAttempts.entries()) {
      const fresh = v.filter((t) => now - t < ONE_HOUR_MS);
      if (fresh.length === 0) userGenAttempts.delete(k);
      else userGenAttempts.set(k, fresh);
    }
    for (const [k, v] of loginAttemptsByIp.entries()) {
      const fresh = v.filter((t) => now - t < ONE_MIN_MS);
      if (fresh.length === 0) loginAttemptsByIp.delete(k);
      else loginAttemptsByIp.set(k, fresh);
    }
  },
  30 * 60 * 1000,
);

module.exports = {
  GEN_LIMIT,
  LOGIN_LIMIT,
  checkUserGenLimit,
  recordUserGenAttempt,
  unlockUser,
  getUserGenCount,
  checkLoginLimit,
  recordLoginAttempt,
};
