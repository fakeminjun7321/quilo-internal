const path = require("path");
const { startQaServer } = require("./helpers/qa-server");

function loadPlaywrightTest() {
  try {
    return require("@playwright/test");
  } catch (error) {
    const marker = `${path.sep}node_modules${path.sep}`;
    const cacheKey = Object.keys(require.cache).find(
      (key) =>
        key.includes(`${marker}@playwright${path.sep}test${path.sep}`) ||
        key.includes(`${marker}playwright${path.sep}`),
    );
    if (!cacheKey) throw error;
    const root = cacheKey.slice(0, cacheKey.indexOf(marker) + marker.length);
    return require(path.join(root, "@playwright", "test"));
  }
}

const { test, expect } = loadPlaywrightTest();

let qaServer = null;
let BASE_URL = "";

test.beforeAll(async () => {
  qaServer = await startQaServer();
  BASE_URL = qaServer.baseUrl;
});

test.afterAll(async () => {
  if (qaServer) await qaServer.stop();
});

async function mockFrontendApis(page) {
  let jobCounter = 0;
  const generationRequests = [];

  await page.addInitScript(() => {
    class MockEventSource {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        setTimeout(() => this.emit("progress", JSON.stringify("업로드 확인")), 20);
        setTimeout(() => this.emit("progress", JSON.stringify("AI 분석 중")), 45);
        setTimeout(() => this.emit("progress", JSON.stringify("문서 생성 중")), 70);
        setTimeout(() => {
          const id = String(url).match(/\/api\/jobs\/([^/]+)\/stream/)?.[1] || "qa-job";
          this.emit("done", JSON.stringify({ filename: `${id}.docx`, warnings: [] }));
        }, 95);
      }
      addEventListener(type, callback) {
        (this.listeners[type] ||= []).push(callback);
      }
      close() {
        this.closed = true;
      }
      emit(type, data) {
        if (this.closed) return;
        for (const callback of this.listeners[type] || []) callback({ data });
      }
    }
    window.EventSource = MockEventSource;
  });

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: "QA", studentId: "20260001", isAdmin: false, styleNote: "", analyticsConsent: false, analyticsConsentVersion: "2026-07-15" }),
    });
  });
  await page.route("**/api/me/beta", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ features: [], blockedReportTypes: [] }),
    });
  });
  await page.route("**/api/subscriptions/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ active: true, admin: false }),
    });
  });
  await page.route("**/api/me/balance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ credits: 8, unlimited: false, isAdmin: false }),
    });
  });
  await page.route("**/api/me/files", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ storage: true, files: [], maxFilesPerUser: 3 }),
    });
  });
  await page.route("**/api/cloud/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ dropbox: { configured: false } }),
    });
  });
  await page.route("**/api/announcements", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        announcements: [
          { title: "정상 공지", category: "안내", link: "/notice" },
          { title: "스킴 차단 확인", category: "보안", link: "javascript:alert(1)" },
        ],
      }),
    });
  });
  await page.route("**/api/generate", async (route) => {
    generationRequests.push((await route.request().postDataBuffer())?.toString("utf8") || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: `qa-${++jobCounter}` }),
    });
  });

  return { generationRequests };
}

async function chooseReport(page, type) {
  await page.locator('[data-ui-menu-trigger="0"]').click();
  await page.locator(`#uiSiteMega a[data-report="${type}"]`).click();
  await expect(page.locator(`[data-report-form="${type}"]`)).toBeVisible();
  await expect(page.locator(`[data-report-form="${type}"]`)).toHaveAttribute("data-flow-step", "upload");
}

async function goFlowStep(page, type, step) {
  await page.locator(`#reportWorkflowNav button[data-flow-jump="${step}"]`).click();
  await expect(page.locator(`[data-report-form="${type}"]`)).toHaveAttribute("data-flow-step", step);
}

async function acceptPolicy(page, type) {
  await page.locator(`[data-report-form="${type}"] .policy-check input[type="checkbox"]`).check({ force: true });
}

async function setBackgroundMode(page, type, { enabled, notifyEmail = true }) {
  const form = page.locator(`[data-report-form="${type}"]`);
  const mode = form.locator("[data-background-mode]");
  await expect(mode).toBeVisible();
  await mode.setChecked(enabled);
  const notify = form.locator("[data-background-notify]");
  if (enabled) {
    await expect(notify).toBeVisible();
    await notify.setChecked(notifyEmail);
  } else {
    await expect(notify).toBeHidden();
  }
}

async function confirmGeneration(page, summaryText) {
  await expect(page.locator(".confirm-card .background-choice")).toHaveCount(0);
  await expect(page.locator(".confirm-card")).toContainText("실행 방식");
  await expect(page.locator(".confirm-card")).toContainText(summaryText);
  await page.locator(".confirm-card button.primary").click();
  await expect(page.locator("#statusTitle")).toHaveText("완료", { timeout: 7000 });
  await expect(page.locator('#progressSteps [data-progress-step="ready"]')).toHaveClass(/is-active/);
  await expect(page.locator("#resultArea a")).toHaveAttribute("href", /\/api\/jobs\/qa-\d+\/download/);
}

test("mocked SSE report generation smoke: chem-pre, chem-result, phys-result", async ({ page }) => {
  const { generationRequests } = await mockFrontendApis(page);
  await page.goto(BASE_URL);

  await expect(page.locator("body")).toHaveAttribute("data-auth", "in");
  await expect(page.locator('#annTrack a[href^="javascript:"]')).toHaveCount(0);

  await chooseReport(page, "chem-pre");
  const reportFormCount = await page.locator("form[data-report-form]").count();
  await expect(page.locator("[data-background-options]")).toHaveCount(reportFormCount);
  await page.setInputFiles("#manual", {
    name: "manual.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nqa\n%%EOF"),
  });
  await goFlowStep(page, "chem-pre", "info");
  await page.fill("#date", "2026-06-14");
  await goFlowStep(page, "chem-pre", "generate");
  await setBackgroundMode(page, "chem-pre", { enabled: true, notifyEmail: true });
  await acceptPolicy(page, "chem-pre");
  await page.locator('#form button[type="submit"]').click();
  await confirmGeneration(page, "백그라운드 실행 · 이메일 알림 사용");
  expect(generationRequests[0]).toContain('name="backgroundMode"');
  expect(generationRequests[0]).toContain('name="notifyEmail"');

  await chooseReport(page, "chem-result");
  await page.setInputFiles("#crPreReport", {
    name: "pre-report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nqa\n%%EOF"),
  });
  await goFlowStep(page, "chem-result", "info");
  await page.fill("#crDate", "2026-06-14");
  await goFlowStep(page, "chem-result", "generate");
  await setBackgroundMode(page, "chem-result", { enabled: false });
  await acceptPolicy(page, "chem-result");
  await page.locator('#chemResultForm button[type="submit"]').click();
  await confirmGeneration(page, "현재 창에서 실행");
  expect(generationRequests[1]).not.toContain('name="backgroundMode"');
  expect(generationRequests[1]).not.toContain('name="notifyEmail"');

  await chooseReport(page, "phys-result");
  await page.setInputFiles("#prData", {
    name: "data.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("time,position\n0,0\n1,1\n"),
  });
  await goFlowStep(page, "phys-result", "info");
  await page.fill("#prDate", "2026-06-14");
  await goFlowStep(page, "phys-result", "generate");
  await setBackgroundMode(page, "phys-result", { enabled: true, notifyEmail: false });
  await acceptPolicy(page, "phys-result");
  await page.locator('#physResultForm button[type="submit"]').click();
  await confirmGeneration(page, "백그라운드 실행 · 이메일 알림 사용 안 함");
  expect(generationRequests[2]).toContain('name="backgroundMode"');
  expect(generationRequests[2]).not.toContain('name="notifyEmail"');
});
