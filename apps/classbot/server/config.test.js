import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const validProduction = {
  NODE_ENV: "production",
  CLASSBOT_STORAGE: "supabase",
  CLASSBOT_SESSION_SECRET: "s".repeat(32),
  CLASSBOT_ADMIN_PASSWORD: "a".repeat(16),
  CLASSBOT_CRON_SECRET: "c".repeat(32),
  CLASSBOT_KAKAO_SKILL_SECRET: "k".repeat(32),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  KAKAO_EVENT_ENABLED: "false",
};

test("production은 Supabase 저장소와 충분히 긴 secret을 강제한다", () => {
  assert.throws(
    () => loadConfig({ ...validProduction, CLASSBOT_STORAGE: "memory" }),
    /CLASSBOT_STORAGE must be supabase/,
  );
  assert.throws(
    () => loadConfig({ ...validProduction, CLASSBOT_SESSION_SECRET: "short" }),
    /at least 32 characters/,
  );
  assert.throws(
    () => loadConfig({ ...validProduction, CLASSBOT_KAKAO_SKILL_SECRET: "" }),
    /CLASSBOT_KAKAO_SKILL_SECRET/,
  );
  assert.equal(loadConfig(validProduction).storage, "supabase");
  assert.equal(loadConfig(validProduction).allowedOrigin, "");
});

test("production은 서로 다른 secret과 HTTPS 외부 주소만 허용한다", () => {
  assert.throws(
    () => loadConfig({ ...validProduction, CLASSBOT_CRON_SECRET: validProduction.CLASSBOT_SESSION_SECRET }),
    /distinct values/,
  );
  assert.throws(
    () => loadConfig({ ...validProduction, SUPABASE_URL: "http://example.supabase.co" }),
    /must use HTTPS/,
  );
  assert.throws(
    () => loadConfig({ ...validProduction, CLASSBOT_ALLOWED_ORIGIN: "http://class.example" }),
    /must use HTTPS/,
  );
  assert.equal(loadConfig({ ...validProduction, CLASSBOT_ALLOWED_ORIGIN: "https://class.example" }).allowedOrigin, "https://class.example");
});

test("Render에서는 production 검증을 강제하고 placeholder와 미지원 timezone을 거부한다", () => {
  assert.throws(
    () => loadConfig({ ...validProduction, NODE_ENV: "development", RENDER: "true", CLASSBOT_ADMIN_PASSWORD: "local-admin-local-admin" }),
    /placeholder or development default/,
  );
  assert.equal(loadConfig({ ...validProduction, NODE_ENV: "development", RENDER: "true" }).production, true);
  assert.throws(
    () => loadConfig({ ...validProduction, CLASSBOT_TIMEZONE: "UTC" }),
    /only Asia\/Seoul/,
  );
});

test("기존 Quilo 서버의 Supabase·세션·관리자 환경변수를 그대로 재사용한다", () => {
  const config = loadConfig({
    ...validProduction,
    CLASSBOT_SESSION_SECRET: "",
    CLASSBOT_ADMIN_PASSWORD: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SESSION_SECRET: "q".repeat(32),
    ADMIN_PASSWORD: "existing-quilo-admin-password",
    SUPABASE_SERVICE_KEY: "existing-service-key",
  });
  assert.equal(config.sessionSecret, "q".repeat(32));
  assert.equal(config.adminPassword, "existing-quilo-admin-password");
  assert.equal(config.supabaseServiceRoleKey, "existing-service-key");
});
