"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const {
  createCatalogRouter,
  createExternalApiMiddleware,
  normalizeScopes,
} = require("../lib/external-api");
const { listFeatures } = require("../lib/quilo-catalog");

test("catalog represents the broad Quilo product, not only reports", () => {
  const features = listFeatures();
  assert.ok(features.length >= 30);
  for (const id of ["pdf-translate", "vibe-coding", "file-chat", "community", "lab", "dropbox", "codex-plugin"]) {
    assert.ok(features.some((feature) => feature.id === id), `missing ${id}`);
  }
  assert.ok(new Set(features.map((feature) => feature.category)).size >= 6);
});

test("scope normalization rejects unknown permissions", () => {
  assert.deepEqual(normalizeScopes(["account:read", "admin:write", "account:read"]), ["account:read"]);
});

test("public catalog API supports search", async (t) => {
  const app = express();
  app.use("/api/catalog", createCatalogRouter());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/catalog?q=PDF`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.features.some((feature) => feature.id === "pdf-translate"));
});

test("v1 middleware requires bearer auth and rewrites an allowed job route", async (t) => {
  const rawToken = `quilo_deadbeef_${"A".repeat(43)}`;
  const tokenRow = {
    id: "token-1",
    user_id: "user-1",
    name: "test",
    token_prefix: "deadbeef",
    scopes: ["jobs:read"],
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  const chain = {
    select() { return this; }, eq() { return this; }, is() { return this; }, gt() { return this; },
    update() { return this; },
    maybeSingle() { return Promise.resolve({ data: tokenRow, error: null }); },
    then(resolve) { return Promise.resolve(resolve({ data: null, error: null })); },
  };
  const supa = {
    getClient: () => ({ from: () => Object.create(chain) }),
    findUserById: async () => ({ id: "user-1", name: "민준", approved: true, email_verified: true }),
  };
  const app = express();
  app.use(createExternalApiMiddleware({ supa }));
  app.get("/api/me/jobs", (req, res) => res.json({ ok: true, user: req.apiUser.id }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const denied = await fetch(`http://127.0.0.1:${port}/api/v1/jobs`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`http://127.0.0.1:${port}/api/v1/jobs`, {
    headers: { authorization: `Bearer ${rawToken}` },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { ok: true, user: "user-1" });
});
