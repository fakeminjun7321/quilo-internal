const path = require("path");
const { spawn } = require("child_process");

function loadPlaywrightTest() {
  try { return require("@playwright/test"); }
  catch (error) {
    const marker = `${path.sep}node_modules${path.sep}`;
    const cacheKey = Object.keys(require.cache).find((key) =>
      key.includes(`${marker}@playwright${path.sep}test${path.sep}`) || key.includes(`${marker}playwright${path.sep}`));
    if (!cacheKey) throw error;
    const root = cacheKey.slice(0, cacheKey.indexOf(marker) + marker.length);
    return require(path.join(root, "@playwright", "test"));
  }
}
const { test, expect } = loadPlaywrightTest();

const BASE_URL = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
let serverProcess = null;

async function serverIsUp() {
  try { const response = await fetch(BASE_URL); return response.ok || response.status < 500; }
  catch (_) { return false; }
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Quilo QA server did not start");
}

async function mockAccountApis(page, options = {}) {
  const calls = options.calls || [];
  const role = options.role || "admin";
  const isAdmin = role === "admin";
  const isMax = role === "max";
  const isPro = role === "pro";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      calls.push({ pathname, method: request.method(), body: request.postDataJSON?.() || null });
    }
    if (pathname === "/api/me") return route.fulfill({ json: { user: "구민준", studentId: "2402", isAdmin, styleNote: "", blockedReportTypes: [] } });
    if (pathname === "/api/me/balance") return route.fulfill({ json: { credits: isAdmin ? 100000 : 24, unlimited: isAdmin, isAdmin } });
    if (pathname === "/api/me/beta") return route.fulfill({
      json: options.tierError ? null : {
        admin: isAdmin,
        tier: role,
        features: isAdmin || isMax || isPro ? ["code-editor", "create"] : [],
      },
      status: options.tierError ? 500 : 200,
    });
    if (pathname === "/api/subscriptions/me") return route.fulfill({
      json: options.tierError ? null : { active: isAdmin || isMax, admin: isAdmin },
      status: options.tierError ? 500 : 200,
    });
    if (pathname === "/api/me/api-keys" && request.method() === "GET") {
      if (options.keyError) return route.fulfill({ status: 500, json: { error: "연결 상태 오류" } });
      return route.fulfill({ json: { keys: [{ provider: "openai", hint: "8K3x" }] } });
    }
    if (pathname === "/api/me/usage") {
      return route.fulfill({ json: {
        isAdmin,
        credits: isAdmin ? 100000 : 24,
        genCount: options.emptyUsage ? 0 : 2,
        genLimit: 5,
        recent: options.emptyUsage ? [] : [
          { date: "2026-07-11T14:32:00.000Z", label: "문서 요약 생성", model: "Claude Sonnet", credits: 2 },
          { date: "2026-07-11T11:08:00.000Z", label: "보고서 초안 작성", model: "GPT-5.4", credits: 1 },
        ],
      } });
    }
    if (pathname === "/api/me/profile" && request.method() === "PATCH") return route.fulfill({ json: { studentId: request.postDataJSON().studentId } });
    if (pathname === "/api/me/password" && request.method() === "POST") return route.fulfill({ json: { ok: true } });
    if (pathname === "/api/me/api-keys" && request.method() === "POST") return route.fulfill({ json: { ok: true } });
    if (pathname.startsWith("/api/me/api-keys/") && request.method() === "DELETE") return route.fulfill({ json: { ok: true } });
    if (pathname === "/api/announcements") return route.fulfill({ json: { announcements: [] } });
    if (pathname === "/api/me/files") return route.fulfill({ json: { storage: true, files: [] } });
    if (pathname === "/api/cloud/providers/status") return route.fulfill({ json: { integrations: {} } });
    if (pathname === "/api/cloud/dropbox/status") return route.fulfill({ json: { enabled: false } });
    if (pathname === "/api/chat/status") return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: {} });
  });
}

test.beforeAll(async () => {
  if (await serverIsUp()) return;
  serverProcess = spawn("node", ["server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: "3000" }, stdio: "pipe" });
  await waitForServer();
});

test.afterAll(() => { if (serverProcess) serverProcess.kill(); });

test("account center uses continuous sections and preserves account contracts", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await mockAccountApis(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${BASE_URL}/#settings`, { waitUntil: "networkidle" });

  await expect(page.locator("#settingsPanel")).toBeVisible();
  await expect(page.locator("#settingsPanel .settings-card")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Account Center" })).toBeVisible();
  await expect(page.locator(".account-local-nav a")).toHaveCount(5);
  await expect(page.locator("#settingsUserName")).toHaveText("구민준");
  await expect(page.locator("#settingsStudentId")).toHaveText("2402");
  await expect(page.locator("#settingsUserRole")).toHaveText("관리자");
  await expect(page.locator("#tierStatus")).toContainText("Admin");
  await expect(page.locator("#usageCredits")).toHaveText("무제한");
  await expect(page.locator("#usageGen")).toHaveText("2회");
  await expect(page.locator("#usageGenLabel")).toHaveText("이번 시간 · 제한 없음");
  await expect(page.locator("#usageMeter")).toBeHidden();
  await expect(page.locator("#usageRecent th")).toHaveText(["날짜", "작업", "모델", "크레딧"]);
  await expect(page.locator("#usageRecent tbody tr")).toHaveCount(2);
  await expect(page.locator("#byokOpenaiStatus")).toContainText("등록됨");
  await expect(page.locator("#byokAnthropicStatus")).toHaveText("미등록");
  await expect(page.locator('#settingsPanel [data-action="open-quilo-assist"]')).toHaveCount(0);

  const metrics = await page.evaluate(() => {
    const panel = document.getElementById("settingsPanel");
    const nav = panel.querySelector(".account-local-nav");
    const section = panel.querySelector(".account-section");
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      columns: getComputedStyle(panel.querySelector(".account-center-shell")).gridTemplateColumns,
      navWidth: nav.getBoundingClientRect().width,
      sectionRadius: getComputedStyle(section).borderRadius,
      workspaceHead: getComputedStyle(document.querySelector(".workspace-page-head")).display,
    };
  });
  expect(metrics.overflow).toBe(0);
  expect(metrics.columns).not.toBe("none");
  expect(metrics.navWidth).toBeLessThan(190);
  expect(metrics.sectionRadius).toBe("0px");
  expect(metrics.workspaceHead).toBe("none");
  expect(consoleErrors).toEqual([]);
  if (process.env.ACCOUNT_QA_SCREEN) {
    await page.screenshot({ path: process.env.ACCOUNT_QA_SCREEN, fullPage: false });
  }
});

test("account center keeps profile, preferences, BYOK and password actions working", async ({ page }) => {
  const calls = [];
  await mockAccountApis(page, { calls });
  await page.goto(`${BASE_URL}/#settings`, { waitUntil: "networkidle" });

  await page.locator("#settingsProfileCard > summary").click();
  await page.locator("#settingsStudentIdInput").fill("2501");
  await page.locator("#profileBtn").click();
  await expect(page.locator("#profileStatus")).toHaveText("저장 완료");
  await expect(page.locator("#settingsStudentId")).toHaveText("2501");

  await page.locator("#prefModelSel").selectOption("gpt-5.4-mini");
  await expect(page.locator("#prefSaveStatus")).toHaveText("기본 모델 저장됨");
  expect(await page.evaluate(() => localStorage.getItem("prefModel"))).toBe("gpt-5.4-mini");

  await page.locator('[data-provider="anthropic"] > summary').click();
  await page.locator("#byokAnthropicInput").fill("sk-ant-test-account-center");
  await page.locator("#byokSaveAnthropic").click();
  await expect(page.locator("#byokMsg")).toContainText("등록했습니다");

  await page.locator("#currentPw").fill("old-password");
  await page.locator("#newPw").fill("new-password");
  await page.locator("#confirmPw").fill("new-password");
  await page.locator("#pwBtn").click();
  await expect(page.locator("#pwStatus")).toHaveText("변경 완료");

  expect(calls.some((call) => call.pathname === "/api/me/profile" && call.body.studentId === "2501")).toBeTruthy();
  expect(calls.some((call) => call.pathname === "/api/me/api-keys" && call.body.provider === "anthropic")).toBeTruthy();
  expect(calls.some((call) => call.pathname === "/api/me/password" && call.body.newPassword === "new-password")).toBeTruthy();
});

test("account center exposes empty and error states without blank cards", async ({ page }) => {
  await mockAccountApis(page, { emptyUsage: true, keyError: true, tierError: true });
  await page.goto(`${BASE_URL}/#settings`, { waitUntil: "networkidle" });

  await expect(page.locator("#usageRecent")).toHaveAttribute("data-state", "empty");
  await expect(page.locator("#usageRecent")).toContainText("최근 생성 기록이 없습니다");
  await expect(page.locator("#byokStatus")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#byokStatus")).toContainText("연결 상태 오류");
  await expect(page.locator("#tierStatus")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#tierStatus")).toHaveText("확인할 수 없음");
});

for (const [role, label] of [["free", "Free"], ["pro", "Pro"], ["max", "Max"], ["admin", "Admin"]]) {
  test(`${role} role renders one consistent account and navigation state`, async ({ page }) => {
    await mockAccountApis(page, { role });
    await page.goto(`${BASE_URL}/#settings`, { waitUntil: "networkidle" });

    await expect(page.locator("body")).toHaveAttribute("data-auth", "in");
    await expect(page.locator("#tierStatus")).toHaveAttribute("data-tier", role);
    await expect(page.locator("#tierStatus")).toContainText(label);
    await expect(page.locator("#accountTriggerMeta")).toHaveText(label);
    await expect(page.locator("#settingsPanel .settings-card")).toHaveCount(0);
    await expect(page.locator("#qc-launch")).toHaveCount(0);
    if (role === "admin") await expect(page.locator("#adminLink")).not.toHaveAttribute("hidden", "");
    else await expect(page.locator("#adminLink")).toHaveAttribute("hidden", "");
    await expect(page.locator("#navBetaEditor, #navBetaTranslate")).toHaveCount(0);
    await page.locator('[data-ui-menu-trigger="3"]').click();
    await expect(page.locator('#uiSiteMega a[href="/translate.html"] strong').filter({ hasText: "PDF 통번역" })).toHaveCount(1);
  });
}
