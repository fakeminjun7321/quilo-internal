import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprint = fs.readFileSync(path.join(root, "render.yaml"), "utf8");

test("기본 배포 blueprint는 무료 조회 서비스와 보호된 secret만 만든다", () => {
  assert.match(blueprint, /rootDir: apps\/classbot/);
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /buildCommand: npm ci && npm run build && npm run preflight:production/);
  assert.doesNotMatch(blueprint, /preDeployCommand:/);
  assert.match(blueprint, /healthCheckPath: \/api\/health/);
  assert.match(blueprint, /CLASSBOT_SESSION_SECRET[\s\S]*generateValue: true/);
  assert.match(blueprint, /SUPABASE_SERVICE_ROLE_KEY[\s\S]*sync: false/);
  assert.doesNotMatch(blueprint, /type: cron/);
  assert.doesNotMatch(blueprint, /KAKAO_REST_API_KEY/);
});
