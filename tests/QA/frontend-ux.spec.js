const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

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
const BASE_URL = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
const SCREEN_DIR = path.join(process.cwd(), "test-results", "frontend-screens");
let serverProcess = null;

async function serverIsUp() {
  try {
    const res = await fetch(BASE_URL);
    return res.ok || res.status < 500;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start at ${BASE_URL}`);
}

async function mockLoggedInApis(page) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/api/announcements") {
      return route.fulfill({ json: { announcements: [] } });
    }
    if (pathname === "/api/me") {
      return route.fulfill({
        json: {
          user: "QA",
          studentId: "2402",
          isAdmin: false,
          styleNote: "",
          blockedReportTypes: [],
        },
      });
    }
    if (pathname === "/api/me/beta") {
      return route.fulfill({ json: { admin: false, features: [] } });
    }
    if (pathname === "/api/me/balance") {
      return route.fulfill({ json: { credits: 8, unlimited: false } });
    }
    if (pathname === "/api/me/files") {
      return route.fulfill({
        json: {
          storage: true,
          cloud: null,
          maxFilesPerUser: 3,
          files: [
            {
              id: "qa-file-1",
              filename: "화학_사전보고서_QA.docx",
              size_bytes: 128000,
              created_at: "2026-06-14T01:00:00.000Z",
              expires_at: "2026-06-15T01:00:00.000Z",
            },
          ],
        },
      });
    }
    if (pathname === "/api/cloud/dropbox/status") {
      return route.fulfill({ json: { enabled: false } });
    }
    if (pathname === "/api/cloud/providers/status") {
      return route.fulfill({
        json: {
          integrations: {
            dropbox: { configured: true, connected: false, connectUrl: "/api/cloud/dropbox/connect" },
            google: { configured: true, connected: false, connectUrl: "/api/cloud/google/connect" },
            notion: { configured: true, connected: false, connectUrl: "/api/cloud/notion/connect" },
          },
        },
      });
    }
    if (pathname === "/api/me/usage") {
      return route.fulfill({
        json: {
          credits: 8,
          genCount: 1,
          genLimit: 5,
          recent: [
            { date: "2026-06-14T01:00:00.000Z", label: "화학 사전보고서", model: "gpt-5.4", credits: 1 },
          ],
        },
      });
    }
    return route.fulfill({ json: {} });
  });
}

test.beforeAll(async () => {
  if (await serverIsUp()) return;
  serverProcess = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "3000" },
    stdio: "pipe",
  });
  await waitForServer();
});

test.afterAll(async () => {
  if (serverProcess) serverProcess.kill();
});

test("home keeps the approved desktop header at the real 933px viewport", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me") return route.fulfill({ status: 401, json: { error: "로그인이 필요합니다." } });
    if (pathname === "/api/announcements") return route.fulfill({ json: { announcements: [] } });
    if (pathname === "/api/chat/status") return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 933, height: 897 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  await expect(page.locator("#navBurger")).toBeHidden();
  await expect(page.locator("#navMenu")).toBeVisible();
  await expect(page.locator("#reportTypeFieldset")).toBeHidden();
  await expect(page.locator("#reportTypes")).toBeHidden();
  await expect(page.locator("#navMenu")).toContainText("제품");
  await expect(page.locator("#navMenu")).toContainText("Instagram");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("authentication stays on landing until an explicit report opens the workspace", async ({ page }) => {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await mockLoggedInApis(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-auth", "in");
  await expect(page.locator("body")).toHaveAttribute("data-view", "landing");
  await expect(page.locator("#landingSurface")).toBeVisible();
  await expect(page.locator("#workspaceSurface")).toBeHidden();
  await expect(page.locator("#reportTypes")).toBeHidden();
  await expect(page.locator("#reportTypeFieldset")).toBeHidden();
  await expect(page.locator("#loginDd")).toBeHidden();
  await expect(page.locator("#acctDd")).toBeVisible();
  await expect(page.locator("#homeHero")).toBeVisible();

  await page.locator('.nav-dd-btn').filter({ hasText: "제품" }).click();
  await page.locator('.nav-dd-menu a[data-report="chem-pre"]').click();
  await page.waitForTimeout(350);
  await expect(page.locator("body")).toHaveAttribute("data-view", "workspace");
  await expect(page.locator("#landingSurface")).toBeHidden();
  await expect(page.locator("#workspaceSurface")).toBeVisible();
  await expect(page.locator("#workspaceSummary")).toBeVisible();
  await expect(page.locator("#form.report-flow.active")).toBeVisible();
  await expect(page.locator("#form")).toHaveAttribute("data-flow-step", "upload");
  let stepVisibility = await page.evaluate(() => ({
    upload: getComputedStyle(document.querySelector('#form > [data-flow-target="upload"]')).display,
    info: getComputedStyle(document.querySelector('#form > [data-flow-target="info"]')).display,
    settings: getComputedStyle(document.querySelector("#form > .optional-settings")).display,
    actions: getComputedStyle(document.querySelector("#form > .form-actions")).display,
  }));
  expect(stepVisibility.upload).not.toBe("none");
  expect(stepVisibility.info).toBe("none");
  expect(stepVisibility.settings).toBe("none");
  expect(stepVisibility.actions).toBe("none");

  await page.locator('#form .form-flow-steps button[data-flow-jump="info"]').click();
  await page.waitForTimeout(150);
  await expect(page.locator("#form")).toHaveAttribute("data-flow-step", "info");
  stepVisibility = await page.evaluate(() => ({
    upload: getComputedStyle(document.querySelector('#form > [data-flow-target="upload"]')).display,
    info: getComputedStyle(document.querySelector('#form > [data-flow-target="info"]')).display,
  }));
  expect(stepVisibility.upload).toBe("none");
  expect(stepVisibility.info).not.toBe("none");

  await page.locator('#form .form-flow-steps button[data-flow-jump="settings"]').click();
  await page.waitForTimeout(150);
  await expect(page.locator("#form")).toHaveAttribute("data-flow-step", "settings");
  expect(await page.locator("#form > .optional-settings").getAttribute("open")).not.toBeNull();

  await page.locator('#form .form-flow-steps button[data-flow-jump="generate"]').click();
  await page.waitForTimeout(150);
  await expect(page.locator("#form")).toHaveAttribute("data-flow-step", "generate");
  stepVisibility = await page.evaluate(() => ({
    upload: getComputedStyle(document.querySelector('#form > [data-flow-target="upload"]')).display,
    info: getComputedStyle(document.querySelector('#form > [data-flow-target="info"]')).display,
    settings: getComputedStyle(document.querySelector("#form > .optional-settings")).display,
    actions: getComputedStyle(document.querySelector("#form > .form-actions")).display,
  }));
  expect(stepVisibility.upload).not.toBe("none");
  expect(stepVisibility.info).not.toBe("none");
  expect(stepVisibility.settings).toBe("none");
  expect(stepVisibility.actions).not.toBe("none");
  const selectedLayout = await page.evaluate(() => {
    const reportTypes = document.querySelector("#reportTypes").getBoundingClientRect();
    const form = document.querySelector("#form").getBoundingClientRect();
    return { reportTypesBottom: reportTypes.bottom, formTop: form.top, scrollY: window.scrollY };
  });
  // The 94px desktop shell is intentionally taller than the legacy header.
  // Keep the selected form inside the first content band without coupling the
  // contract to the old 140px header geometry.
  expect(selectedLayout.formTop).toBeLessThan(180);
  await page.screenshot({ path: path.join(SCREEN_DIR, "desktop-1280.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/?report=chem-pre`, { waitUntil: "networkidle" });
  await expect(page.locator("#workspaceSummary")).toBeVisible();
  await expect(page.locator("#reportTypeFieldset")).toBeHidden();
  await page.screenshot({ path: path.join(SCREEN_DIR, "mobile-390.png"), fullPage: false });

  expect(errors).toEqual([]);
});

test("cloud providers use a separate account tab instead of the files panel", async ({ page }) => {
  await mockLoggedInApis(page);
  await page.goto(`${BASE_URL}/#integrations`, { waitUntil: "networkidle" });

  await expect(page.locator("body")).toHaveAttribute("data-auth", "in");
  await expect(page.locator('#acctDd a[data-tab="integrations"]')).toHaveText("외부 서비스 연결");
  await expect(page.locator("#integrationsPanel")).toBeVisible();
  await expect(page.locator("#cloudCard")).toBeVisible();
  await expect(page.locator("#integrationsPanel")).toContainText("Google Drive·Docs");
  await expect(page.locator("#integrationsPanel")).toContainText("Notion");
  await expect(page.locator("#filesPanel #cloudCard")).toHaveCount(0);
  await expect(page.locator("#filesPanel")).toBeHidden();
});

test("report entry links bypass the removed intermediary and open the free report form", async ({ page }) => {
  await mockLoggedInApis(page);
  await page.goto(`${BASE_URL}/?report=free`, { waitUntil: "networkidle" });

  await expect(page.locator("body")).toHaveAttribute("data-view", "workspace");
  await expect(page.locator('input[name="reportType"][value="free"]')).toBeChecked();
  await expect(page.locator('#freeForm[data-report-form="free"]')).toBeVisible();
  await expect(page.locator("#reportsPanel")).toHaveClass(/workspace-mode/);
  await expect(page.locator("#choosePrompt")).toHaveCount(0);
  await expect(page.locator(".home-hero-categories")).toHaveCount(0);
  await expect(page.locator('.nav-dd-menu a[data-report="free"]')).toHaveText("자유 보고서");
  await expect(page.locator('.home-start-cta[href="/?report=free"]')).toHaveText("무료로 시작하기");
});

test("all five core report routes resolve to their preserved form contracts", async ({ page }) => {
  await mockLoggedInApis(page);
  const cases = [
    ["chem-pre", "form"],
    ["chem-result", "chemResultForm"],
    ["phys-result", "physResultForm"],
    ["free", "freeForm"],
    ["reading-log", "readingLogForm"],
  ];
  for (const [type, formId] of cases) {
    await page.goto(`${BASE_URL}/?report=${type}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toHaveAttribute("data-view", "workspace");
    await expect(page.locator(`input[name="reportType"][value="${type}"]`)).toBeChecked();
    await expect(page.locator(`#${formId}[data-report-form="${type}"]`)).toBeVisible();
  }
});

test("secondary UX pages render without console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${page.url()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));

  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/community/posts") {
      return route.fulfill({ json: { storage: true, posts: [] } });
    }
    if (pathname === "/api/lab/entries") {
      return route.fulfill({ json: { entries: [] } });
    }
    if (pathname === "/api/me/beta") {
      return route.fulfill({ json: { admin: false, features: [] } });
    }
    if (pathname === "/api/artifacts/gallery") {
      return route.fulfill({ json: { items: [] } });
    }
    if (pathname === "/api/artifacts") {
      return route.fulfill({ json: { persistent: true, artifacts: [] } });
    }
    return route.fulfill({ json: {} });
  });

  for (const pathName of ["/tools/convert.html", "/guide.html", "/examples.html", "/community.html", "/create.html"]) {
    await page.goto(`${BASE_URL}${pathName}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
  }

  expect(errors).toEqual([]);
});
