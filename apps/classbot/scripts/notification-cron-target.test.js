import assert from "node:assert/strict";
import test from "node:test";
import { resolveNotificationCronTarget } from "./notification-cron-target.js";

test("allows Render private HTTP hostport", () => {
  const target = resolveNotificationCronTarget({
    privateHostPort: "quilo-schedule-abc1:10000",
    externalBaseUrl: "http://untrusted.example",
  });

  assert.equal(target.href, "http://quilo-schedule-abc1:10000/");
});

test("requires HTTPS for an external base URL", () => {
  assert.throws(
    () => resolveNotificationCronTarget({ externalBaseUrl: "http://example.com" }),
    /must use HTTPS/,
  );
  assert.equal(
    resolveNotificationCronTarget({ externalBaseUrl: "https://schedule.example.com" }).href,
    "https://schedule.example.com/",
  );
});

test("allows an HTTP localhost target for local verification", () => {
  assert.equal(
    resolveNotificationCronTarget({ externalBaseUrl: "http://127.0.0.1:4310" }).href,
    "http://127.0.0.1:4310/",
  );
});
