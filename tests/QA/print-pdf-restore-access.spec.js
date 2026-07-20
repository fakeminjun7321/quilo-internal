const path = require("path");
const { startQaServer } = require("./helpers/qa-server");

function loadPlaywrightTest() {
  try { return require("@playwright/test"); }
  catch (error) {
    const marker = `${path.sep}node_modules${path.sep}`;
    const cacheKey = Object.keys(require.cache).find((key) =>
      key.includes(`${marker}@playwright${path.sep}test${path.sep}`) ||
      key.includes(`${marker}playwright${path.sep}`));
    if (!cacheKey) throw error;
    const root = cacheKey.slice(0, cacheKey.indexOf(marker) + marker.length);
    return require(path.join(root, "@playwright", "test"));
  }
}

const { test, expect } = loadPlaywrightTest();
let qaServer = null;
let BASE_URL = "";

async function mockApis(page, isAdmin) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me") return route.fulfill({ json: {
      user: isAdmin ? "관리자" : "일반 사용자",
      studentId: "2402",
      isAdmin,
      blockedReportTypes: [],
      reportEligible: true,
      analyticsConsent: false,
      analyticsConsentVersion: "2026-07-15",
    } });
    if (pathname === "/api/me/beta") return route.fulfill({ json: { admin: isAdmin, tier: isAdmin ? "admin" : "free", features: [] } });
    if (pathname === "/api/subscriptions/me") return route.fulfill({ json: { active: isAdmin, admin: isAdmin } });
    if (pathname === "/api/me/files") return route.fulfill({ json: { storage: true, files: [] } });
    if (pathname === "/api/cloud/providers/status") return route.fulfill({ json: { integrations: {} } });
    if (pathname === "/api/cloud/dropbox/status") return route.fulfill({ json: { enabled: false } });
    if (pathname === "/api/announcements") return route.fulfill({ json: { announcements: [] } });
    if (pathname === "/api/chat/status") return route.fulfill({ json: { enabled: false } });
    if (pathname === "/api/me/balance") return route.fulfill({ json: { credits: 24, unlimited: isAdmin, isAdmin } });
    return route.fulfill({ json: {} });
  });
}

test.beforeAll(async () => {
  qaServer = await startQaServer({ env: { NODE_ENV: "test" } });
  BASE_URL = qaServer.baseUrl;
});

test.afterAll(async () => { if (qaServer) await qaServer.stop(); });

test("admin direct URL opens the restoration workspace and form", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await mockApis(page, true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE_URL}/?report=print-pdf-restore`, { waitUntil: "networkidle" });

  await expect(page).toHaveTitle(/Quilo/);
  await expect(page.locator("#workspaceSurface")).toBeVisible();
  await expect(page.locator("#rtPrintPdfRestore")).not.toHaveAttribute("hidden", "");
  await expect(page.locator('input[name="reportType"][value="print-pdf-restore"]')).toBeChecked();
  await expect(page.locator("#printPdfRestoreForm")).toBeVisible();
  await expect(page.locator("#workspaceTitle")).toHaveText("프린트 PDF 복원");

  await page.locator("#pprPageOrder").fill("3,1,2");
  await expect(page.locator("#pprPageOrder")).toHaveValue("3,1,2");
  await page.screenshot({ path: "/tmp/quilo-print-pdf-restore-admin.png", fullPage: false });
  expect(errors).toEqual([]);
});

test("non-admin direct URL cannot reveal the restoration entry or form", async ({ page }) => {
  await mockApis(page, false);
  await page.goto(`${BASE_URL}/?report=print-pdf-restore`, { waitUntil: "networkidle" });
  await expect(page.locator("#rtPrintPdfRestore")).toHaveAttribute("hidden", "");
  await expect(page.locator("#printPdfRestoreForm")).toBeHidden();
  await expect(page.locator('input[name="reportType"][value="print-pdf-restore"]')).not.toBeChecked();
});
