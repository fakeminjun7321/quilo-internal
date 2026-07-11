"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns/promises");
const net = require("node:net");
const express = require("express");

const EVENTS = new Set(["job.completed", "job.failed", "job.cancelled"]);
const MISSING_TABLE = /api_webhook_|schema cache|relation .* does not exist/i;

function keyMaterial(secret) {
  const value = String(secret || process.env.WEBHOOK_SECRET_KEY || process.env.SESSION_SECRET || "");
  if (!value) throw new Error("WEBHOOK_SECRET_KEY가 설정되지 않았습니다.");
  return crypto.createHash("sha256").update(value).digest();
}

function encryptSecret(secret, encryptionKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptSecret(blob, encryptionKey) {
  const [version, iv, tag, ciphertext] = String(blob || "").split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Webhook secret 형식이 올바르지 않습니다.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial(encryptionKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function publicEndpoint(row) {
  return {
    id: row.id,
    url: row.url,
    description: row.description || "",
    events: Array.isArray(row.events) ? row.events : [],
    enabled: row.enabled !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeEvents(value) {
  const events = [...new Set((Array.isArray(value) ? value : []).map(String).filter((event) => EVENTS.has(event)))];
  if (!events.length) throw new Error("Webhook 이벤트를 하나 이상 선택하세요.");
  return events;
}

function validateWebhookUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { throw new Error("올바른 Webhook URL이 필요합니다."); }
  if (url.protocol !== "https:") throw new Error("Webhook URL은 HTTPS여야 합니다.");
  if (url.username || url.password || url.port) throw new Error("Webhook URL에는 인증정보나 사용자 지정 포트를 넣을 수 없습니다.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("내부 네트워크 주소는 사용할 수 없습니다.");
  if (net.isIP(hostname) && isPrivateAddress(hostname)) throw new Error("사설 IP 주소는 사용할 수 없습니다.");
  url.hash = "";
  return url.toString();
}

function isPrivateAddress(address) {
  if (address === "::1" || address === "0.0.0.0" || address === "::") return true;
  if (address.includes(":")) return /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address) || address.startsWith("::ffff:127.") || address.startsWith("::ffff:10.") || address.startsWith("::ffff:192.168.");
  const parts = address.split(".").map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
}

async function assertPublicDns(urlString) {
  const url = new URL(urlString);
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error("Webhook 대상이 공개 인터넷 주소가 아닙니다.");
}

function createWebhookRouter({ supa, getSessionUser, encryptionKey }) {
  const router = express.Router();
  const user = (req, res) => {
    const current = getSessionUser(req);
    if (!current?.id) { res.status(401).json({ error: "로그인이 필요합니다." }); return null; }
    return current;
  };
  router.get("/webhooks", async (req, res) => {
    const current = user(req, res); if (!current) return;
    try {
      const { data, error } = await supa.getClient().from("api_webhook_endpoints").select("id, url, description, events, enabled, created_at, updated_at").eq("user_id", current.id).order("created_at", { ascending: false });
      if (error) throw error;
      res.json({ webhooks: (data || []).map(publicEndpoint), supportedEvents: [...EVENTS] });
    } catch (error) { webhookStoreError(res, error); }
  });
  router.post("/webhooks", async (req, res) => {
    const current = user(req, res); if (!current) return;
    try {
      const url = validateWebhookUrl(req.body?.url);
      const events = normalizeEvents(req.body?.events);
      const secret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;
      const { data, error } = await supa.getClient().from("api_webhook_endpoints").insert({
        user_id: current.id,
        url,
        description: String(req.body?.description || "").trim().slice(0, 120),
        events,
        secret_ciphertext: encryptSecret(secret, encryptionKey),
        enabled: true,
      }).select("id, url, description, events, enabled, created_at, updated_at").single();
      if (error) throw error;
      res.status(201).json({ webhook: publicEndpoint(data), secret, warning: "서명 비밀키는 지금 한 번만 표시됩니다." });
    } catch (error) { webhookStoreError(res, error); }
  });
  router.delete("/webhooks/:id", async (req, res) => {
    const current = user(req, res); if (!current) return;
    try {
      const { data, error } = await supa.getClient().from("api_webhook_endpoints").delete().eq("id", req.params.id).eq("user_id", current.id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Webhook을 찾을 수 없습니다." });
      res.json({ ok: true });
    } catch (error) { webhookStoreError(res, error); }
  });
  router.get("/webhook-deliveries", async (req, res) => {
    const current = user(req, res); if (!current) return;
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const { data, error } = await supa.getClient().from("api_webhook_deliveries").select("id, endpoint_id, event, event_id, status, attempt_count, response_status, error, delivered_at, created_at").eq("user_id", current.id).order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      res.json({ deliveries: data || [] });
    } catch (error) { webhookStoreError(res, error); }
  });
  return router;
}

async function dispatchJobEvent({ supa, userId, event, payload, encryptionKey }) {
  if (!userId || !EVENTS.has(event) || !supa?.getClient()) return;
  const client = supa.getClient();
  try {
    const { data, error } = await client.from("api_webhook_endpoints").select("id, url, secret_ciphertext, events").eq("user_id", userId).eq("enabled", true).contains("events", [event]);
    if (error) throw error;
    await Promise.allSettled((data || []).map((endpoint) => deliver({ client, userId, endpoint, event, payload, encryptionKey })));
  } catch (error) {
    if (!MISSING_TABLE.test(String(error?.message || error))) console.warn("[webhook] dispatch:", error?.message || error);
  }
}

async function deliver({ client, userId, endpoint, event, payload, encryptionKey }) {
  const eventId = `evt_${crypto.randomBytes(16).toString("hex")}`;
  const body = JSON.stringify({ id: eventId, type: event, createdAt: new Date().toISOString(), data: payload });
  let lastError = "";
  let responseStatus = null;
  let attempts = 0;
  try {
    await assertPublicDns(endpoint.url);
    const secret = decryptSecret(endpoint.secret_ciphertext, encryptionKey);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    for (attempts = 1; attempts <= 3; attempts++) {
      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "user-agent": "Quilo-Webhooks/1.0",
            "x-quilo-event": event,
            "x-quilo-event-id": eventId,
            "x-quilo-timestamp": String(timestamp),
            "x-quilo-signature": `v1=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
        responseStatus = response.status;
        if (response.ok) { lastError = ""; break; }
        lastError = `HTTP ${response.status}`;
      } catch (error) { lastError = String(error?.message || error).slice(0, 400); }
      if (attempts < 3) await new Promise((resolve) => setTimeout(resolve, attempts * 250));
    }
  } catch (error) { lastError = String(error?.message || error).slice(0, 400); attempts = Math.max(1, attempts); }
  await client.from("api_webhook_deliveries").insert({
    endpoint_id: endpoint.id,
    user_id: userId,
    event,
    event_id: eventId,
    status: lastError ? "failed" : "delivered",
    attempt_count: attempts,
    response_status: responseStatus,
    error: lastError || null,
    delivered_at: lastError ? null : new Date().toISOString(),
  });
}

function webhookStoreError(res, error) {
  const message = String(error?.message || error || "");
  if (MISSING_TABLE.test(message)) return res.status(503).json({ error: "Webhook 테이블이 아직 설치되지 않았습니다.", code: "WEBHOOK_TABLE_MISSING" });
  if (/duplicate key|23505/i.test(message)) return res.status(409).json({ error: "같은 URL의 Webhook이 이미 있습니다." });
  if (/Webhook|URL|이벤트|HTTPS|내부 네트워크|사설 IP/i.test(message)) return res.status(400).json({ error: message });
  console.error("[webhook] store:", message);
  return res.status(500).json({ error: "Webhook을 처리하지 못했습니다." });
}

module.exports = { createWebhookRouter, decryptSecret, dispatchJobEvent, encryptSecret, isPrivateAddress, validateWebhookUrl };
