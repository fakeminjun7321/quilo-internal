"use strict";

const crypto = require("crypto");
const express = require("express");
const { CATEGORIES, listFeatures, getFeature } = require("./quilo-catalog");

const TOKEN_PREFIX = "quilo_";
const TOKEN_TABLE = "user_access_tokens";
const TOKEN_TABLE_MISSING = /user_access_tokens|schema cache|relation .* does not exist/i;
const ALLOWED_SCOPES = new Set([
  "account:read",
  "jobs:read",
  "jobs:write",
  "files:read",
  "reports:write",
]);

const V1_ROUTES = [
  route("GET", /^\/api\/v1\/account\/?$/, "account:read"),
  route("GET", /^\/api\/v1\/jobs\/?$/, "jobs:read", () => "/api/me/jobs"),
  route("POST", /^\/api\/v1\/jobs\/([^/]+)\/abort\/?$/, "jobs:write", (m) => `/api/jobs/${m[1]}/abort`),
  route("GET", /^\/api\/v1\/jobs\/([^/]+)\/events\/?$/, "jobs:read", (m) => `/api/jobs/${m[1]}/stream`),
  route("GET", /^\/api\/v1\/jobs\/([^/]+)\/download\/?$/, "files:read", (m) => `/api/jobs/${m[1]}/download`),
  route("GET", /^\/api\/v1\/files\/?$/, "files:read", () => "/api/me/files"),
  route("GET", /^\/api\/v1\/files\/([^/]+)\/download\/?$/, "files:read", (m) => `/api/me/files/${m[1]}/download`),
  route("POST", /^\/api\/v1\/reports\/?$/, "reports:write", () => "/api/generate"),
];

function route(method, pattern, scope, rewrite = null) {
  return { method, pattern, scope, rewrite };
}

function hashAccessToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function createRawAccessToken() {
  const prefix = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return { raw: `${TOKEN_PREFIX}${prefix}_${secret}`, prefix };
}

function normalizeScopes(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map(String).filter((scope) => ALLOWED_SCOPES.has(scope)))];
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name || "",
    username: user.username || user.name || "",
    studentId: user.student_id || "",
    isAdmin: false,
    unlimited: !!user.unlimited,
    restrictedModel: user.restricted_model || null,
    emailVerified: !!user.email_verified,
    approved: !!user.approved,
  };
}

function createCatalogRouter() {
  const router = express.Router();
  router.get("/", (req, res) => {
    const filters = {
      category: String(req.query.category || "").trim() || undefined,
      status: String(req.query.status || "").trim() || undefined,
      audience: String(req.query.audience || "").trim() || undefined,
      query: String(req.query.q || "").trim() || undefined,
    };
    const features = listFeatures(filters);
    res.json({
      product: "Quilo",
      tagline: "영재고생을 위한 학업 AI",
      principles: ["업로드한 실제 자료를 우선", "제출 가능한 파일로 완성", "사용자가 검토하고 제출"],
      categories: CATEGORIES,
      features,
      total: features.length,
    });
  });
  router.get("/:id", (req, res) => {
    const feature = getFeature(String(req.params.id || ""));
    if (!feature) return res.status(404).json({ error: "기능을 찾을 수 없습니다." });
    res.json({ feature, category: CATEGORIES[feature.category] || null });
  });
  return router;
}

function createTokenRouter({ supa, requireAuth, getSessionUser }) {
  const router = express.Router();

  router.get("/tokens", requireAuth, async (req, res) => {
    if (req.apiAuth) return res.status(403).json({ error: "액세스 토큰으로 다른 토큰을 관리할 수 없습니다." });
    const user = getSessionUser(req);
    const client = supa.getClient();
    if (!client || !user?.id) return res.status(503).json({ error: "토큰 저장소를 사용할 수 없습니다." });
    try {
      const { data, error } = await client
        .from(TOKEN_TABLE)
        .select("id, name, token_prefix, scopes, expires_at, last_used_at, created_at, revoked_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      res.json({ tokens: (data || []).map(publicTokenRow), allowedScopes: [...ALLOWED_SCOPES] });
    } catch (error) {
      tokenStoreError(res, error);
    }
  });

  router.post("/tokens", requireAuth, async (req, res) => {
    if (req.apiAuth) return res.status(403).json({ error: "액세스 토큰으로 다른 토큰을 만들 수 없습니다." });
    const user = getSessionUser(req);
    const client = supa.getClient();
    if (!client || !user?.id) return res.status(503).json({ error: "토큰 저장소를 사용할 수 없습니다." });
    const name = String(req.body?.name || "Codex").trim().slice(0, 80);
    const scopes = normalizeScopes(req.body?.scopes);
    const days = Math.max(1, Math.min(365, Math.trunc(Number(req.body?.expiresInDays) || 30)));
    if (!name) return res.status(400).json({ error: "토큰 이름이 필요합니다." });
    if (!scopes.length) return res.status(400).json({ error: "권한 범위를 하나 이상 선택하세요." });
    try {
      const { count, error: countError } = await client
        .from(TOKEN_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString());
      if (countError) throw countError;
      if ((count || 0) >= 10) return res.status(409).json({ error: "활성 토큰은 최대 10개까지 만들 수 있습니다." });
      const token = createRawAccessToken();
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      const { data, error } = await client
        .from(TOKEN_TABLE)
        .insert({
          user_id: user.id,
          name,
          token_hash: hashAccessToken(token.raw),
          token_prefix: token.prefix,
          scopes,
          expires_at: expiresAt,
        })
        .select("id, name, token_prefix, scopes, expires_at, created_at")
        .single();
      if (error) throw error;
      res.status(201).json({ token: token.raw, record: publicTokenRow(data), warning: "이 토큰은 지금 한 번만 표시됩니다." });
    } catch (error) {
      tokenStoreError(res, error);
    }
  });

  router.delete("/tokens/:id", requireAuth, async (req, res) => {
    if (req.apiAuth) return res.status(403).json({ error: "액세스 토큰으로 다른 토큰을 폐기할 수 없습니다." });
    const user = getSessionUser(req);
    const client = supa.getClient();
    if (!client || !user?.id) return res.status(503).json({ error: "토큰 저장소를 사용할 수 없습니다." });
    try {
      const { data, error } = await client
        .from(TOKEN_TABLE)
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", req.params.id)
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "토큰을 찾을 수 없습니다." });
      res.json({ ok: true });
    } catch (error) {
      tokenStoreError(res, error);
    }
  });

  return router;
}

function createExternalApiMiddleware({ supa }) {
  return async function externalApiMiddleware(req, res, next) {
    const pathname = String(req.path || "");
    if (!pathname.startsWith("/api/v1/")) return next();
    const matched = V1_ROUTES.map((entry) => ({ entry, match: pathname.match(entry.pattern) }))
      .find(({ entry, match }) => entry.method === req.method && match);
    if (!matched) return res.status(404).json({ error: "지원하지 않는 Quilo API v1 경로입니다." });

    const auth = String(req.headers.authorization || "");
    const rawToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!/^quilo_[a-f0-9]{8}_[A-Za-z0-9_-]{40,}$/.test(rawToken)) {
      return res.status(401).json({ error: "유효한 Quilo Bearer 토큰이 필요합니다." });
    }
    const client = supa.getClient();
    if (!client) return res.status(503).json({ error: "외부 API 인증을 사용할 수 없습니다." });
    try {
      const now = new Date().toISOString();
      const { data: tokenRow, error } = await client
        .from(TOKEN_TABLE)
        .select("id, user_id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at")
        .eq("token_hash", hashAccessToken(rawToken))
        .is("revoked_at", null)
        .gt("expires_at", now)
        .maybeSingle();
      if (error) throw error;
      if (!tokenRow) return res.status(401).json({ error: "토큰이 만료되었거나 폐기되었습니다." });
      const scopes = normalizeScopes(tokenRow.scopes);
      if (!scopes.includes(matched.entry.scope)) {
        return res.status(403).json({ error: `이 토큰에는 ${matched.entry.scope} 권한이 없습니다.`, requiredScope: matched.entry.scope });
      }
      const user = await supa.findUserById(tokenRow.user_id);
      if (!user) return res.status(401).json({ error: "토큰의 사용자 계정을 찾을 수 없습니다." });
      req.apiUser = safeUser(user);
      req.apiAuth = { id: tokenRow.id, name: tokenRow.name, prefix: tokenRow.token_prefix, scopes };
      void client.from(TOKEN_TABLE).update({ last_used_at: now }).eq("id", tokenRow.id).then(() => {}, () => {});

      if (matched.entry.rewrite) {
        const target = matched.entry.rewrite(matched.match);
        const queryIndex = req.url.indexOf("?");
        req.url = target + (queryIndex >= 0 ? req.url.slice(queryIndex) : "");
      }
      next();
    } catch (error) {
      if (TOKEN_TABLE_MISSING.test(String(error.message || error))) {
        return res.status(503).json({ error: "외부 API 토큰 테이블이 아직 설치되지 않았습니다.", code: "TOKEN_TABLE_MISSING" });
      }
      console.error("[external-api] auth error:", error.message || error);
      res.status(503).json({ error: "외부 API 인증을 확인할 수 없습니다." });
    }
  };
}

function createV1Router({ supa }) {
  const router = express.Router();
  router.get("/account", async (req, res) => {
    const user = req.apiUser;
    if (!user) return res.status(401).json({ error: "인증이 필요합니다." });
    let credits = 0;
    let pro = false;
    let max = false;
    try {
      [credits, pro, max] = await Promise.all([
        supa.getCredits(user.id),
        supa.getUserBetaFeatures(user.id).then((items) => items.length > 0),
        supa.getActiveBackgroundSub(user.id).then(Boolean),
      ]);
    } catch (_) {
      // Account identity is still useful if optional entitlement lookups fail.
    }
    res.json({
      user: { id: user.id, name: user.name, username: user.username, studentId: user.studentId },
      plan: max ? "max" : pro ? "pro" : "free",
      credits,
      unlimited: !!user.unlimited,
      token: req.apiAuth,
    });
  });
  return router;
}

function publicTokenRow(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: normalizeScopes(row.scopes),
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at || null,
  };
}

function tokenStoreError(res, error) {
  const message = String(error?.message || error || "");
  if (TOKEN_TABLE_MISSING.test(message)) {
    return res.status(503).json({ error: "외부 API 토큰 테이블이 아직 설치되지 않았습니다.", code: "TOKEN_TABLE_MISSING" });
  }
  console.error("[external-api] token store error:", message);
  return res.status(500).json({ error: "액세스 토큰을 처리하지 못했습니다." });
}

module.exports = {
  ALLOWED_SCOPES,
  createCatalogRouter,
  createTokenRouter,
  createExternalApiMiddleware,
  createV1Router,
  hashAccessToken,
  normalizeScopes,
};
