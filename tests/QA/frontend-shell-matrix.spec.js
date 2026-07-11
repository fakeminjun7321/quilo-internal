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
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const TOOL_ROUTES = Object.freeze([
  "/tools/convert.html",
  "/tools/image.html",
  "/tools/index.html",
  "/tools/pdf-compress.html",
  "/tools/pdf-crop.html",
  "/tools/pdf-extract.html",
  "/tools/pdf-merge.html",
  "/tools/pdf-organize.html",
  "/tools/pdf-pagenum.html",
  "/tools/pdf-remove.html",
  "/tools/pdf-rotate.html",
  "/tools/pdf-split.html",
  "/tools/pdf-watermark.html",
]);

const GENERAL_PUBLIC_ROUTES = Object.freeze([
  "/changelog.html",
  "/community.html",
  "/create.html",
  "/developers.html",
  "/equation/index.html",
  "/exam-prep.html",
  "/examples.html",
  "/filechat.html",
  "/guide.html",
  "/physics-studio.html",
  "/privacy.html",
  "/refund.html",
  "/school-apply.html",
  "/study.html",
  "/terms.html",
  "/translate.html",
]);

const APP_ROUTES = Object.freeze([
  "/apps/live-translator.html",
  "/apps/quilo.html",
]);

const COMMON_SHELL_ROUTES = Object.freeze([
  ...TOOL_ROUTES,
  ...GENERAL_PUBLIC_ROUTES,
  ...APP_ROUTES,
]);

// These surfaces intentionally keep dedicated authentication, administration,
// or full-screen application chrome and are not part of the marketing shell matrix.
const EXCLUDED_ROUTES = Object.freeze({
  auth: Object.freeze(["/login.html", "/signup.html", "/verify-email.html"]),
  admin: Object.freeze(["/admin.html"]),
  fullscreenApps: Object.freeze([
    "/editor.html",
    "/studio.html",
    "/translate-app.html",
    "/vibe-coding.html",
  ]),
});

const VIEWPORTS = Object.freeze([
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "desktop-933", width: 933, height: 844 },
  { name: "mobile-390", width: 390, height: 844 },
]);

let staticServer;
let baseUrl;
const unsafeBrowserRequests = new WeakMap();
const unsafeServerRequests = [];

function resolvePublicFile(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch (_) {
    return null;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;

  try {
    if (fs.statSync(filePath).isDirectory()) return path.join(filePath, "index.html");
  } catch (_) {}
  return filePath;
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const method = String(request.method || "GET").toUpperCase();
    if (!SAFE_METHODS.has(method)) {
      unsafeServerRequests.push(`${method} ${request.url}`);
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
      response.end(method === "HEAD" ? undefined : body);
    });
  });
}

function readOnlyApiFixture(pathname) {
  if (pathname === "/api/me") {
    // An empty successful response follows each page's existing parse-error path
    // into its logged-out state without adding an expected 401 to the console.
    return { status: 200, rawBody: "" };
  }

  const fixtures = {
    "/api/announcements": { announcements: [] },
    "/api/artifacts/gallery": { items: [] },
    "/api/catalog": { total: 0, categories: {}, features: [] },
    "/api/chat/status": { enabled: false, writeAssistEnabled: false },
    "/api/community/posts": { storage: true, posts: [] },
    "/api/filechat/access": { allowed: false },
    "/api/integrations/api-requests": { requests: [] },
    "/api/integrations/tokens": { tokens: [] },
    "/api/lab/entries": { entries: [] },
    "/api/me/balance": { credits: 0, unlimited: false, isAdmin: false, modelCredits: {} },
    "/api/me/beta": { admin: false, features: [], blockedReportTypes: [] },
    "/api/physics-studio/config": { models: [], difficulties: [], styles: [] },
    "/api/subscriptions/me": { active: false, subscription: null },
    "/api/version": {
      app: "quilo",
      version: "qa",
      shortCommit: "matrix",
      commit: "matrix",
      branch: "qa",
      serverStartedAt: "2026-07-11T00:00:00.000Z",
      patchNotes: [],
    },
    "/api/write-assist/models": { enabled: false, models: [] },
  };
  return { status: 200, body: fixtures[pathname] || {} };
}

async function installReadOnlyNetworkGuard(page) {
  const unsafe = [];
  unsafeBrowserRequests.set(page, unsafe);

  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());

    if (!SAFE_METHODS.has(method)) {
      unsafe.push(`${method} ${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (url.origin === baseUrl && url.pathname.startsWith("/api/")) {
      const fixture = readOnlyApiFixture(url.pathname);
      await route.fulfill({
        status: fixture.status,
        contentType: "application/json; charset=utf-8",
        body: Object.prototype.hasOwnProperty.call(fixture, "rawBody")
          ? fixture.rawBody
          : JSON.stringify(fixture.body),
      });
      return;
    }

    if (url.origin !== baseUrl) {
      const resourceType = request.resourceType();
      if (resourceType === "script") {
        await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: "" });
      } else if (resourceType === "stylesheet") {
        await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: "" });
      } else {
        await route.fulfill({ status: 204, body: "" });
      }
      return;
    }

    await route.continue();
  });
}

function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function horizontalOverflowReport(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > viewportWidth + 1 || rect.left < -1);
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    return { viewportWidth, documentWidth, offenders };
  });
}

test.beforeAll(async () => {
  staticServer = createStaticServer();
  await new Promise((resolve, reject) => {
    staticServer.once("error", reject);
    staticServer.listen(0, "127.0.0.1", resolve);
  });
  const address = staticServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => {
    staticServer.close((error) => (error ? reject(error) : resolve()));
  });
  expect(unsafeServerRequests, "The local QA server must never receive a write request").toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await installReadOnlyNetworkGuard(page);
});

test.afterEach(async ({ page }) => {
  expect(
    unsafeBrowserRequests.get(page),
    "Frontend shell QA must not initiate POST, PUT, PATCH, DELETE, or other write requests",
  ).toEqual([]);
});

test("shell matrix inventory is explicit and excludes specialized chrome", () => {
  expect(TOOL_ROUTES).toHaveLength(13);
  expect(GENERAL_PUBLIC_ROUTES).toHaveLength(16);
  expect(APP_ROUTES).toHaveLength(2);
  expect(COMMON_SHELL_ROUTES).toHaveLength(31);
  expect(new Set(COMMON_SHELL_ROUTES).size).toBe(COMMON_SHELL_ROUTES.length);

  const excluded = Object.values(EXCLUDED_ROUTES).flat();
  expect(excluded).toEqual([
    "/login.html",
    "/signup.html",
    "/verify-email.html",
    "/admin.html",
    "/editor.html",
    "/studio.html",
    "/translate-app.html",
    "/vibe-coding.html",
  ]);
  for (const route of excluded) expect(COMMON_SHELL_ROUTES).not.toContain(route);
});

test("removed standalone tools are absent from the public tree", () => {
  for (const route of [
    "/tools/word-count.html",
    "/tools/regression.html",
    "/tools/graph.html",
  ]) {
    expect(fs.existsSync(path.join(PUBLIC_DIR, route.replace(/^\/+/, ""))), route).toBe(false);
  }
});

for (const viewport of VIEWPORTS) {
  test.describe(`common shell ${viewport.name}`, () => {
    for (const route of COMMON_SHELL_ROUTES) {
      test(`${route} renders the shared shell without overflow or console errors`, async ({ page }) => {
        const consoleErrors = collectConsoleErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });

        await expect(page.locator("[data-q-shell-root]"), `${route} shared shell`).toBeVisible();
        await expect(page.locator("#main-content"), `${route} main landmark`).toHaveCount(1);
        await expect(page.locator("#main-content"), `${route} visible main content`).toBeVisible();
        await expect(page.locator(".landing-nav"), `${route} legacy navigation`).toHaveCount(0);

        if (viewport.width > 760) {
          await expect(page.locator(".q-shell__nav"), `${route} desktop navigation`).toBeVisible();
          await expect(page.locator(".q-shell__actions"), `${route} desktop actions`).toBeVisible();
          await expect(page.locator(".q-shell__mobile"), `${route} mobile disclosure`).toBeHidden();
        }

        const overflow = await horizontalOverflowReport(page);
        expect(
          overflow.documentWidth,
          `${route} at ${viewport.name} overflows ${overflow.viewportWidth}px; offenders: ${JSON.stringify(overflow.offenders)}`,
        ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
        expect(consoleErrors, `${route} at ${viewport.name} console health`).toEqual([]);
      });
    }
  });
}

test("index mobile custom topnav opens as a left-aligned, scroll-contained full-width menu", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

  await expect(page.locator("body")).toHaveAttribute("data-auth", "out");
  const burger = page.locator("#navBurger");
  const nav = page.locator("#navMenu");
  await expect(burger).toBeVisible();
  await burger.click();
  await expect(burger).toHaveAttribute("aria-expanded", "true");
  await expect(nav).toHaveClass(/open/);
  await expect(nav).toBeVisible();

  const metrics = await page.evaluate(() => {
    const navElement = document.getElementById("navMenu");
    const firstMenuButton = navElement.querySelector(".nav-dd-btn");
    const cta = navElement.querySelector(".home-start-cta");
    const navRect = navElement.getBoundingClientRect();
    const firstRect = firstMenuButton.getBoundingClientRect();
    const ctaRect = cta.getBoundingClientRect();
    const navStyle = getComputedStyle(navElement);
    const firstStyle = getComputedStyle(firstMenuButton);
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      navLeft: navRect.left,
      navRight: navRect.right,
      navTop: navRect.top,
      navBottom: navRect.bottom,
      navWidth: navRect.width,
      navHeight: navRect.height,
      navMaxHeight: navStyle.maxHeight,
      navOverflowY: navStyle.overflowY,
      navAlignItems: navStyle.alignItems,
      firstLeft: firstRect.left,
      firstTextAlign: firstStyle.textAlign,
      ctaLeft: ctaRect.left,
      ctaWidth: ctaRect.width,
    };
  });

  expect(metrics.navHeight).toBeGreaterThan(120);
  expect(metrics.navBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.navMaxHeight).not.toBe("none");
  expect(metrics.navOverflowY).toMatch(/auto|scroll/);
  expect(metrics.navAlignItems).toBe("stretch");
  expect(Math.abs(metrics.navLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.navRight - metrics.viewportWidth)).toBeLessThanOrEqual(1);
  expect(metrics.firstTextAlign).toBe("left");
  expect(metrics.firstLeft).toBeLessThanOrEqual(metrics.navLeft + 28);
  expect(metrics.ctaLeft).toBeGreaterThanOrEqual(metrics.navLeft + 15);
  expect(metrics.ctaWidth).toBeGreaterThanOrEqual(metrics.navWidth - 34);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(consoleErrors, "index mobile topnav console health").toEqual([]);
});
