"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("browser login rejects a cross-origin POST before authentication", () => {
  assert.match(source, /function requireTrustedLoginOrigin\(req, res, next\)/);
  assert.match(
    source,
    /app\.post\("\/api\/login", requireTrustedLoginOrigin, async \(req, res\)/,
  );
  assert.match(source, /code: "UNTRUSTED_LOGIN_ORIGIN"/);
});

test("the account response exposes an immutable principal id for browser storage isolation", () => {
  const route = source.match(/app\.get\("\/api\/me"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(route, /id: u\.id/);
});

test("production refuses to boot without an explicit strong session secret", () => {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    SESSION_SECRET: "short",
  };
  const result = spawnSync(process.execPath, ["-e", "require('./server.js')"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /explicit SESSION_SECRET/);
});

test("production refuses to serve a broken stateful product without Supabase", () => {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    SESSION_SECRET: "a-production-only-secret-longer-than-32-characters",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_KEY: "",
    ALLOW_STATELESS_PRODUCTION: "0",
  };
  const result = spawnSync(process.execPath, ["-e", "require('./server.js')"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /Production requires SUPABASE_URL/);
});
