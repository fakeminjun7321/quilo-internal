import assert from "node:assert/strict";
import test from "node:test";
import express4 from "express4";
import request from "supertest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

test("기존 Express 4 Quilo 서버의 /schedule namespace에서 API가 동작한다", async () => {
  const child = await createApp({
    embedded: true,
    config: loadConfig({
      NODE_ENV: "test",
      CLASSBOT_STORAGE: "memory",
      CLASSBOT_SESSION_SECRET: "mount-test-session-secret",
      CLASSBOT_ADMIN_PASSWORD: "mount-test-admin",
      CLASSBOT_CRON_SECRET: "mount-test-cron-secret",
      CLASSBOT_KAKAO_SKILL_SECRET: "",
      KAKAO_EVENT_ENABLED: "false",
    }),
  });
  const parent = express4();
  parent.use("/schedule/api/admin", (req, _res, next) => {
    req.classbotExternalAdmin = true;
    next();
  });
  parent.use("/schedule", child);

  const health = await request(parent).get("/schedule/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const session = await request(parent).get("/schedule/api/admin/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.authenticated, true);

  const overview = await request(parent).get("/schedule/api/admin/overview");
  assert.equal(overview.status, 200);

  const uploaded = await request(parent)
    .post("/schedule/api/admin/files")
    .field("alias", "마운트 자료")
    .field("visibility", "class")
    .attach("file", Buffer.from("%PDF-1.4\n%%EOF"), { filename: "mount.pdf", contentType: "application/pdf" });
  assert.equal(uploaded.status, 201);
  assert.match(new URL(uploaded.body.item.share_url).pathname, /^\/schedule\/api\/files\//);

  const rootApi = await request(parent).get("/api/health");
  assert.equal(rootApi.status, 404);

  const anonymousParent = express4();
  anonymousParent.use("/schedule", child);
  const anonymousSession = await request(anonymousParent).get("/schedule/api/admin/session");
  assert.equal(anonymousSession.status, 200);
  assert.equal(anonymousSession.body.authenticated, false);
  assert.equal(anonymousSession.headers["set-cookie"], undefined);
  const anonymousOverview = await request(anonymousParent).get("/schedule/api/admin/overview");
  assert.equal(anonymousOverview.status, 401);
});
