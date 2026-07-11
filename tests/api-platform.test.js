"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createExternalApiMiddleware } = require("../lib/external-api");
const { encryptSecret, decryptSecret, isPrivateAddress, validateWebhookUrl } = require("../lib/api-v1/webhooks");
const { claimIdempotency } = require("../lib/api-v1/idempotency");
const { EventEmitter } = require("node:events");
const cloudProviders = require("../lib/cloud/oauth-providers");

test("test-mode access tokens sandbox write operations without calling live handlers", async (t) => {
  const rawToken = `quilo_test_deadbeef_${"S".repeat(43)}`;
  const tokenRow = {
    id: "token-test", user_id: "user-1", name: "sandbox", token_prefix: "deadbeef", token_mode: "test",
    scopes: ["reports:write"], expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  const chain = {
    select() { return this; }, eq() { return this; }, is() { return this; }, gt() { return this; }, update() { return this; },
    maybeSingle() { return Promise.resolve({ data: tokenRow, error: null }); },
    then(resolve) { return Promise.resolve(resolve({ error: null })); },
  };
  const supa = {
    getClient: () => ({ from: () => Object.create(chain) }),
    findUserById: async () => ({ id: "user-1", name: "민준", approved: true, email_verified: true }),
  };
  let liveCalls = 0;
  const app = express();
  app.use(createExternalApiMiddleware({ supa }));
  app.post("/api/generate", (_req, res) => { liveCalls++; res.json({ jobId: "live" }); });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/reports`, {
    method: "POST",
    headers: { authorization: `Bearer ${rawToken}` },
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.sandbox, true);
  assert.equal(body.chargedCredits, 0);
  assert.match(body.jobId, /^sbx_/);
  assert.equal(liveCalls, 0);
});

test("webhook secrets round-trip and private destinations are rejected", () => {
  const encrypted = encryptSecret("whsec_example", "test-key");
  assert.notEqual(encrypted, "whsec_example");
  assert.equal(decryptSecret(encrypted, "test-key"), "whsec_example");
  assert.equal(validateWebhookUrl("https://example.com/hooks"), "https://example.com/hooks");
  assert.throws(() => validateWebhookUrl("http://example.com/hooks"), /HTTPS/);
  assert.throws(() => validateWebhookUrl("https://127.0.0.1/hooks"), /사설 IP/);
  for (const address of ["10.0.0.1", "172.16.0.1", "192.168.1.1", "::1", "169.254.1.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("idempotency stores the first response and replays it without executing again", async () => {
  let stored = null;
  const client = {
    from() {
      return {
        insert(row) {
          return {
            select() { return this; },
            single() {
              if (stored) return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
              stored = { id: "idem-1", ...row };
              return Promise.resolve({ data: { id: stored.id }, error: null });
            },
          };
        },
        select() {
          return {
            eq() { return this; },
            maybeSingle() { return Promise.resolve({ data: stored, error: null }); },
          };
        },
        update(patch) {
          return {
            eq() {
              stored = { ...stored, ...patch };
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() { return { eq() { stored = null; return Promise.resolve({ error: null }); } }; },
      };
    },
  };
  const request = () => ({
    apiRoute: { idempotent: true, operationId: "createReport" },
    apiUser: { id: "user-1" }, apiAuth: { id: "token-1" },
    get(name) { return name === "idempotency-key" ? "same-request-123" : ""; },
  });
  const response = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.body = null;
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.status = (status) => { res.statusCode = status; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };
  const sendApiError = (_req, res, status, code, error) => res.status(status).json({ code, error });
  const first = response();
  assert.equal(await claimIdempotency({ req: request(), res: first, client, sendApiError }), false);
  first.status(202).json({ jobId: "job-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.state, "completed");
  const second = response();
  assert.equal(await claimIdempotency({ req: request(), res: second, client, sendApiError }), true);
  assert.equal(second.statusCode, 202);
  assert.deepEqual(second.body, { jobId: "job-1" });
  assert.equal(second.headers["idempotent-replayed"], "true");
});

test("cloud OAuth credentials are authenticated-encrypted at rest", () => {
  const previous = process.env.CLOUD_TOKEN_SECRET;
  process.env.CLOUD_TOKEN_SECRET = "test-cloud-secret-with-enough-entropy";
  try {
    const encrypted = cloudProviders.encryptToken("refresh-token-example");
    assert.notEqual(encrypted, "refresh-token-example");
    assert.equal(cloudProviders.decryptToken(encrypted), "refresh-token-example");
    const parts = encrypted.split(":");
    parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("A") ? "B" : "A"}`;
    assert.throws(() => cloudProviders.decryptToken(parts.join(":")));
  } finally {
    if (previous == null) delete process.env.CLOUD_TOKEN_SECRET;
    else process.env.CLOUD_TOKEN_SECRET = previous;
  }
});
