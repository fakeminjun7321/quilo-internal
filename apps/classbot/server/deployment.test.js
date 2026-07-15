import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprint = fs.readFileSync(path.join(root, "render.yaml"), "utf8");

test("배포 blueprint는 Classbot 경로, DB health check, 보호된 secret과 Cron을 고정한다", () => {
  assert.match(blueprint, /rootDir: apps\/classbot/);
  assert.match(blueprint, /healthCheckPath: \/api\/health/);
  assert.match(blueprint, /CLASSBOT_SESSION_SECRET[\s\S]*generateValue: true/);
  assert.match(blueprint, /SUPABASE_SERVICE_ROLE_KEY[\s\S]*sync: false/);
  assert.match(blueprint, /type: cron[\s\S]*schedule: "\* \* \* \* \*"/);
  assert.match(blueprint, /fromService:[\s\S]*envVarKey: CLASSBOT_CRON_SECRET/);
});
