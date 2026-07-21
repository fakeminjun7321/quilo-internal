const fs = require("fs");
const http = require("http");
const path = require("path");

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

const PUBLIC_DIR = path.join(process.cwd(), "public");
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let server;
let baseUrl;

function resolvePublicFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;
  return filePath;
}

function createStaticServer() {
  return http.createServer((request, response) => {
    if (!["GET", "HEAD"].includes(String(request.method || "GET").toUpperCase())) {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Read-only QA server");
      return;
    }
    const filePath = resolvePublicFile(request.url || "/");
    if (!filePath) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(error.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    });
  });
}

function apiFixture(pathname) {
  const fixtures = {
    "/api/announcements": { announcements: [] },
    "/api/catalog": {
      total: 2,
      categories: { reports: { title: "보고서", description: "보고서 생성 기능" } },
      features: [
        { id: "chem-pre", title: "화학 사전보고서", summary: "실험 매뉴얼에서 사전보고서 초안을 만듭니다.", category: "reports", path: "/?report=chem-pre", status: "active", execution: "remote", audience: "member", kind: "generator" },
        { id: "paused-report", title: "준비 중 보고서", summary: "아직 사용할 수 없는 기능입니다.", category: "reports", path: "/?report=paused-report", status: "paused", execution: "paused", audience: "public", kind: "generator" },
      ],
    },
    "/api/chat/status": { enabled: false, writeAssistEnabled: false },
    "/api/cloud/providers/status": { integrations: {} },
    "/api/integrations/api-requests": { requests: [] },
    "/api/integrations/tokens": { tokens: [] },
    "/api/me/balance": { credits: 12, unlimited: false, isAdmin: false, modelCredits: {} },
    "/api/me/beta": { admin: false, tier: "free", features: [], blockedReportTypes: [] },
    "/api/me/files": { storage: true, files: [] },
    "/api/openapi.json": { paths: { "/api/catalog": { get: {} }, "/api/v1/account": { get: {} }, "/api/v1/reports": { post: {} } } },
    "/api/subscriptions/me": { active: false, subscription: null },
    "/api/version": { app: "quilo", version: "1.0.0", releaseVersion: "1.0.23", shortCommit: "auth" },
    "/api/write-assist/models": { enabled: false, models: [] },
  };
  return fixtures[pathname] || {};
}

async function installApi(page, { meStatus, meBody, delayMe = false }) {
  const calls = [];
  let releaseMe;
  const meGate = delayMe ? new Promise((resolve) => { releaseMe = resolve; }) : Promise.resolve();

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    calls.push({ method, pathname: url.pathname });

    if (url.origin !== baseUrl) return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/api/")) {
      if (method !== "GET") return route.abort("blockedbyclient");
      if (url.pathname === "/api/me") {
        await meGate;
        return route.fulfill({
          status: meStatus,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify(meBody),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(apiFixture(url.pathname)),
      });
    }
    return route.continue();
  });

  return {
    calls,
    releaseMe: () => releaseMe?.(),
  };
}

async function headerAuthSnapshot(page) {
  return page.evaluate(() => ({
    headerState: document.querySelector("[data-ui-shell]")?.dataset.uiAuthState,
    bodyState: document.body.dataset.sessionState,
    actions: [...document.querySelectorAll("[data-ui-shell] [data-ui-auth-action]")].map((link) => ({
      text: link.textContent.trim(),
      href: link.getAttribute("href"),
      hidden: link.hidden,
      state: link.dataset.uiAuthState,
    })),
  }));
}

test.beforeAll(async () => {
  server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("authenticated shell keeps home and developer account labels consistent", async ({ page }) => {
  const network = await installApi(page, {
    meStatus: 200,
    meBody: { user: "세션사용자", username: "session-user", isAdmin: false, blockedReportTypes: [] },
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-auth", "in");
  await expect(page.locator("#user")).toHaveText("세션사용자 님");

  const meCallsBeforeDevelopers = network.calls.filter((call) => call.pathname === "/api/me").length;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/developers.html`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-ui-shell]")).toHaveAttribute("data-ui-auth-state", "authenticated");
  await expect(page.locator(".ui-site-actions [data-ui-auth-action]")).toBeVisible();
  await expect(page.locator("#accountStatus")).toHaveText("세션사용자 계정으로 로그인됨");
  await expect(page.locator("#createTokenBtn")).toBeEnabled();

  let snapshot = await headerAuthSnapshot(page);
  expect(snapshot.bodyState).toBe("authenticated");
  expect(snapshot.actions).toEqual([
    { text: "세션사용자 님", href: "/#settings", hidden: false, state: "authenticated" },
    { text: "세션사용자 님", href: "/#settings", hidden: false, state: "authenticated" },
  ]);
  expect(network.calls.filter((call) => call.pathname === "/api/me").length - meCallsBeforeDevelopers).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".ui-mobile-trigger").click();
  await expect(page.locator(".ui-mobile-panel [data-ui-auth-action]")).toBeVisible();
  await expect(page.locator(".ui-mobile-panel [data-ui-auth-action]")).toHaveText("세션사용자 님");

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await expect(page.locator("#user")).toHaveText("세션사용자 님");
  expect(network.calls.filter((call) => call.method !== "GET" && call.method !== "HEAD")).toEqual([]);
});

test("logged-out shell shows login on desktop and mobile and locks token controls", async ({ page }) => {
  const network = await installApi(page, {
    meStatus: 401,
    meBody: { error: "로그인이 필요합니다." },
  });

  await page.goto(`${baseUrl}/developers.html`, { waitUntil: "networkidle" });
  const snapshot = await headerAuthSnapshot(page);
  expect(snapshot.headerState).toBe("anonymous");
  expect(snapshot.bodyState).toBe("anonymous");
  expect(snapshot.actions).toEqual([
    { text: "로그인", href: "/?login=1", hidden: false, state: "anonymous" },
    { text: "로그인", href: "/?login=1", hidden: false, state: "anonymous" },
  ]);
  await expect(page.locator("#accountStatus")).toContainText("로그인이 필요합니다");
  await expect(page.locator("#createTokenBtn")).toBeDisabled();
  expect(network.calls.filter((call) => call.method !== "GET" && call.method !== "HEAD")).toEqual([]);
});

test("server failure remains neutral and never writes to logout", async ({ page }) => {
  const network = await installApi(page, {
    meStatus: 500,
    meBody: { error: "일시적인 서버 오류" },
  });

  await page.goto(`${baseUrl}/developers.html`, { waitUntil: "networkidle" });
  const snapshot = await headerAuthSnapshot(page);
  expect(snapshot.headerState).toBe("unknown");
  expect(snapshot.bodyState).toBe("unknown");
  expect(snapshot.actions).toEqual([
    { text: "계정 확인", href: "/", hidden: false, state: "unknown" },
    { text: "계정 확인", href: "/", hidden: false, state: "unknown" },
  ]);
  await expect(page.locator("#accountStatus")).toContainText("로그인 상태를 확인하지 못했습니다");
  await expect(page.locator("#createTokenBtn")).toBeDisabled();
  expect(network.calls.filter((call) => call.pathname === "/api/logout")).toEqual([]);
  expect(network.calls.filter((call) => call.method !== "GET" && call.method !== "HEAD")).toEqual([]);
});

test("pending shell hides login copy until the account check resolves", async ({ page }) => {
  const network = await installApi(page, {
    meStatus: 200,
    meBody: { user: "세션사용자", isAdmin: false, blockedReportTypes: [] },
    delayMe: true,
  });

  await page.goto(`${baseUrl}/developers.html`, { waitUntil: "domcontentloaded" });
  let snapshot = await headerAuthSnapshot(page);
  expect(snapshot.headerState).toBe("pending");
  expect(snapshot.actions.every((action) => action.hidden)).toBeTruthy();

  network.releaseMe();
  await expect(page.locator("[data-ui-shell]")).toHaveAttribute("data-ui-auth-state", "authenticated");
  snapshot = await headerAuthSnapshot(page);
  expect(snapshot.actions.every((action) => !action.hidden && action.text === "세션사용자 님")).toBeTruthy();
  expect(network.calls.filter((call) => call.method !== "GET" && call.method !== "HEAD")).toEqual([]);
});

test("developer portal presents a task-first responsive connection flow", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  const network = await installApi(page, {
    meStatus: 401,
    meBody: { error: "로그인이 필요합니다." },
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/developers.html`, { waitUntil: "networkidle" });

  await expect(page.locator("#devHeroTitle")).toHaveText("Quilo를 어디에 연결할까요?");
  await expect(page.locator(".dev-path-toggle")).toHaveText([
    /ChatGPT에서 보고서와 도구 사용/, /내 Mac의 Codex에서 파일 작업/, /내 서비스에 API 연결/,
  ]);
  await expect(page.locator("#serviceStatus")).toHaveText("Quilo 1.0.23 운영 서버 정상");
  await expect(page.locator(".dev-endpoints > div")).toHaveCount(6);
  await expect(page.locator("#apiReferenceSummary")).toHaveText("3개 주소 · 3개 작업");
  await expect(page.locator("#scopeCount")).toHaveText("22개 권한");
  await expect(page.locator("#catalogBody .feature")).toHaveCount(1);

  await expect(page.locator("#chatgptPanel")).toBeVisible();
  await expect(page.locator("#codexPanel")).toBeHidden();
  await page.locator('[data-connection="codex"] .dev-path-toggle').click();
  await expect(page.locator("#chatgptPanel")).toBeHidden();
  await expect(page.locator("#codexPanel")).toBeVisible();
  await expect(page.locator('[data-connection="codex"] .dev-path-toggle')).toHaveAttribute("aria-expanded", "true");

  await expect(page.locator("#scopeGrid input:checked")).toHaveCount(3);
  await page.locator('[data-scope-preset="none"]').click();
  await expect(page.locator("#scopeGrid input:checked")).toHaveCount(0);
  await expect(page.locator("#scopeSelectionSummary")).toHaveText("선택된 권한이 없습니다.");
  await page.locator('[data-scope-preset="connection"]').click();
  await expect(page.locator("#scopeGrid input:checked")).toHaveCount(3);

  const developerMenu = page.locator("[data-ui-menu-trigger]", { hasText: "개발자" });
  await developerMenu.click();
  await expect(page.locator("#uiSiteMega")).toContainText("빠른 시작");
  await expect(page.locator("#uiSiteMega")).toContainText("액세스 토큰");
  await expect(page.locator("#uiSiteMega")).not.toContainText("계산 API");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "/tmp/quilo-developer-menu-light-1440.png", fullPage: false });
  await developerMenu.press("Escape");

  await page.locator("#catalogSearch").fill("화학");
  await expect(page.locator("#catalogBody .feature strong")).toHaveText("화학 사전보고서");
  await page.locator("#catalogSearch").fill("없는 기능");
  await expect(page.locator("#catalogBody")).toHaveText("조건에 맞는 기능이 없습니다.");
  await page.locator("#catalogSearch").fill("");
  await page.locator("#catalogAccess").selectOption("paused");
  await expect(page.locator("#catalogBody .feature--paused")).toHaveCount(1);
  await expect(page.locator("#catalogBody a.feature")).toHaveCount(0);
  await page.locator("#catalogAccess").selectOption("connected");

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(desktopOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "/tmp/quilo-developers-light-1440.png", fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".dev-path-toggle").first()).toBeVisible();
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(mobileOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "/tmp/quilo-developers-light-390.png", fullPage: false });

  expect(network.calls.filter((call) => call.method !== "GET" && call.method !== "HEAD")).toEqual([]);
});

test("token copy failure is handled without an unhandled rejection", async ({ page }) => {
  await installApi(page, {
    meStatus: 200,
    meBody: { user: "세션사용자", username: "session-user", isAdmin: false, blockedReportTypes: [] },
  });
  await page.goto(`${baseUrl}/developers.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.getElementById("tokenSecret").hidden = false;
    document.getElementById("tokenValue").textContent = "quilo_test_example";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await page.locator("#copyTokenBtn").click();
  await expect(page.locator("#tokenMessage")).toContainText("자동 복사에 실패했습니다");
});
