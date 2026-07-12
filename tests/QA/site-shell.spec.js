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
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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
    return { status: 401, body: { error: "로그인이 필요합니다." } };
  }

  const fixtures = {
    "/api/announcements": { announcements: [] },
    "/api/chat/status": { enabled: false, writeAssistEnabled: false },
    "/api/filechat/access": { allowed: false },
    "/api/me/beta": { admin: false, features: [] },
    "/api/subscriptions/me": { active: false, subscription: null },
    "/api/version": { version: "qa" },
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
        body: JSON.stringify(fixture.body),
      });
      return;
    }

    if (url.origin !== baseUrl) {
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
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
  expect(unsafeBrowserRequests.get(page), "Shell smoke tests must not initiate write requests").toEqual([]);
});

test("guide desktop shell renders with real navigation destinations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/guide.html`, { waitUntil: "domcontentloaded" });

  await expect(page.locator("[data-ui-shell]")).toBeVisible();
  await expect(page.locator(".ui-site-nav")).toBeVisible();
  await expect(page.locator(".ui-site-actions")).toBeVisible();
  await expect(page.locator(".ui-mobile-menu")).toBeHidden();
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator('.ui-skip-link[href="#main-content"]')).toHaveText("본문으로 건너뛰기");

  const desktopHrefs = await page.locator(".ui-site-nav a[href]").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(desktopHrefs).toEqual([
    "/?report=chem-pre",
    "/?report=chem-result",
    "/?report=phys-result",
    "/?report=free",
    "/tools/index.html",
    "/translate.html",
    "/apps/quilo.html",
    "/apps/live-translator.html",
    "/developers.html",
    "/developers.html#catalog",
    "/developers.html#tokenCard",
    "/guide.html",
    "/examples.html",
    "/changelog.html",
    "/community.html",
    "/school-apply.html",
    "/pricing.html",
    "https://www.instagram.com/quilo._.official/",
  ]);
  await expect(page.locator('.ui-site-actions a[href="/?login=1"]')).toHaveText("로그인");
  await expect(page.locator('.ui-site-actions .ui-site-cta[href="/?report=free"]')).toHaveText("무료로 시작하기");

  const placeholderLinks = page.locator('[data-ui-shell] a[href="#"], [data-ui-shell] a:not([href])');
  await expect(placeholderLinks).toHaveCount(0);
});

test("guide 933px shell keeps the approved full navigation without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 933, height: 844 });
  await page.goto(`${baseUrl}/guide.html`, { waitUntil: "domcontentloaded" });

  await expect(page.locator(".ui-site-nav")).toBeVisible();
  await expect(page.locator(".ui-site-actions")).toBeVisible();
  await expect(page.locator(".ui-mobile-menu")).toBeHidden();
  await expect(page.locator(".ui-site-nav > details > summary")).toHaveText([
    "제품",
    "솔루션",
    "앱",
    "개발자",
    "리소스",
  ]);
  await expect(page.locator(".ui-site-nav > a")).toHaveText(["요금", "Instagram ↗"]);
  await expect(page.locator('.ui-site-actions a[href="/?login=1"]')).toHaveText("로그인");
  await expect(page.locator(".ui-site-actions .ui-site-cta")).toHaveText("무료로 시작하기");

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("pricing page explains plan differences without inventing a fixed price", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/pricing.html`, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("요금 및 플랜 — Quilo");
  await expect(page.locator("#main-content h1")).toHaveText("요금 및 플랜");
  await expect(page.locator("#main-content tbody th")).toHaveText(["Free", "Pro", "Max"]);
  await expect(page.locator('#main-content a[href="/?login=1"]')).toHaveText("로그인하고 현재 플랜 확인");
  await expect(page.locator("#main-content")).toContainText("Max 가격·기간·입금 안내는 그 화면에 표시되는 현재 운영 설정을 기준으로 합니다.");
  const mainText = await page.locator("#main-content").innerText();
  expect(mainText).not.toMatch(/\d[\d,]*\s*원/);
});

test("every public pricing navigation points to the visible pricing page", () => {
  const htmlFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(target);
    }
  };
  visit(PUBLIC_DIR);

  expect(fs.existsSync(path.join(PUBLIC_DIR, "pricing.html"))).toBe(true);
  for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    expect(source, path.relative(PUBLIC_DIR, file)).not.toMatch(/href=["']\/?#balanceBox["']/);
  }
});

test("app shells and developer menu use existing account and section destinations", () => {
  const compactShellPages = [
    "create.html", "editor.html", "exam-prep.html", "filechat.html", "physics-studio.html",
    "studio.html", "study.html", "translate.html", "vibe-coding.html",
  ];
  for (const file of compactShellPages) {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");
    expect(source, file).not.toContain('/account.html');
    expect(source, file).toContain('href="/#settings"');
  }

  const retiredTranslator = fs.readFileSync(path.join(PUBLIC_DIR, "translate-app.html"), "utf8");
  expect(retiredTranslator).toContain('content="0;url=/translate.html"');
  expect(retiredTranslator).toContain('location.replace("/translate.html"');

  const home = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const developers = fs.readFileSync(path.join(PUBLIC_DIR, "developers.html"), "utf8");
  expect(home).toContain('href="/developers.html#catalog"');
  expect(home).toContain('href="/developers.html#tokenCard"');
  expect(developers).toContain('id="catalog"');
  expect(developers).toContain('id="tokenCard"');
});

test("desktop disclosures keep one menu open and return focus on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/guide.html`, { waitUntil: "domcontentloaded" });

  const productSummary = page.locator(".ui-site-nav > details > summary").filter({ hasText: /^제품$/ });
  const resourceSummary = page.locator(".ui-site-nav > details > summary").filter({ hasText: /^리소스$/ });
  const product = productSummary.locator("..");
  const resource = resourceSummary.locator("..");

  await productSummary.click();
  await expect(product).toHaveAttribute("open", "");

  await resourceSummary.click();
  await expect(resource).toHaveAttribute("open", "");
  await expect(product).not.toHaveAttribute("open", "");
  await expect(page.locator(".ui-site-nav > details[open]")).toHaveCount(1);

  const focusedMenuLink = resource.locator('a[href="/guide.html"]');
  await focusedMenuLink.focus();
  await expect(focusedMenuLink).toBeFocused();
  await focusedMenuLink.press("Escape");

  await expect(page.locator(".ui-site-nav > details[open]")).toHaveCount(0);
  await expect(resourceSummary).toBeFocused();
});

test("guide mobile shell exposes the same real destinations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/guide.html`, { waitUntil: "domcontentloaded" });

  await expect(page.locator(".ui-site-nav")).toBeHidden();
  await expect(page.locator(".ui-site-actions")).toBeHidden();

  const mobile = page.locator(".ui-mobile-menu");
  const mobileSummary = mobile.locator(":scope > summary");
  const mobilePanel = mobile.locator(".ui-mobile-panel");
  await expect(mobile).toBeVisible();
  await mobileSummary.click();
  await expect(mobile).toHaveAttribute("open", "");
  await expect(mobilePanel).toBeVisible();

  const mobileHrefs = await mobilePanel.locator("a[href]").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(mobileHrefs).toEqual([
    "/?report=free",
    "/tools/index.html",
    "/apps/quilo.html",
    "/developers.html",
    "/guide.html",
    "/?login=1",
    "/?report=free",
  ]);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("login query opens the logged-out login dropdown without a write request", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/?login=1`, { waitUntil: "domcontentloaded" });

  const loginDropdown = page.locator("#loginDd");
  await expect(page.locator("body")).toHaveAttribute("data-auth", "out");
  await expect(loginDropdown).toBeVisible();
  await expect(loginDropdown).toHaveClass(/open/);
  await expect(page.locator("#li_username")).toBeFocused();
});

test("logged-out report entry preserves intent and opens login instead of the removed hub", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/?report=free`, { waitUntil: "domcontentloaded" });

  await expect(page.locator("body")).toHaveAttribute("data-auth", "out");
  await expect(page.locator("#loginDd")).toHaveClass(/open/);
  await expect(page.locator("#choosePrompt")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("pendingReportType"))).toBe("free");
});
