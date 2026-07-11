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
const screenshotPath = "/tmp/quilo-admin-redesign.png";
let server;
let baseUrl;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function fixture(pathname) {
  if (pathname === "/api/me") return { isAdmin: true, name: "관리자" };
  if (pathname === "/api/admin/users") return { users: [], krwPerUsd: 1400 };
  if (pathname === "/api/admin/usage-logs") return { logs: [] };
  if (pathname === "/api/admin/problemset-limit") return { limit: 120 };
  if (pathname === "/api/admin/chat/models" || pathname === "/api/admin/code-assist/models") {
    return { models: [{ id: "default", label: "기본 모델" }] };
  }
  if (pathname === "/api/admin/beta") {
    return {
      features: [
        { key: "pro", label: "Pro 회원", enabled: true, testers: [], dailyLimit: 0 },
      ],
    };
  }
  if (pathname === "/api/admin/beta/pro/testers") return { testers: [] };
  if (pathname === "/api/announcements/all" || pathname === "/api/announcements") {
    return { announcements: [] };
  }
  if (pathname === "/api/grants") return { grants: [] };
  if (pathname === "/api/subscriptions") return { subscriptions: [] };
  if (pathname === "/api/subscriptions/requests") return { requests: [] };
  if (pathname === "/api/community/appeals") return { appeals: [] };
  if (pathname === "/api/school-apply/admin/list") return { applications: [] };
  return {};
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end("Read-only QA");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(fixture(url.pathname)));
      return;
    }
    const relative = url.pathname === "/" ? "admin.html" : url.pathname.replace(/^\/+/, "");
    const file = path.resolve(PUBLIC_DIR, relative);
    if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
      });
      response.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("admin console keeps all operational groups reachable without write requests", async ({ page }) => {
  const writes = [];
  page.on("request", (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto(`${baseUrl}/admin.html`, { waitUntil: "networkidle" });

  await expect(page.locator(".brand-copy strong")).toHaveText("Quilo");
  await expect(page.locator("#adminTabs .atab.on")).toHaveAttribute("data-go", "ai");
  await expect(page.locator("#adminAiSection")).toBeVisible();

  for (const group of ["users", "subs", "grants", "beta", "schools", "logs", "announce", "appeals", "editor"]) {
    await page.locator(`#adminTabs .atab[data-go="${group}"]`).click();
    await expect(page.locator(`section.settings-card[data-atab="${group}"]`).first()).toBeVisible();
  }

  await page.locator('#adminTabs .atab[data-go="ai"]').click();
  await expect(page.locator("#adminPageTitle")).toHaveText("운영 개요");
  await expect(page.locator("#adminTabs .atab.on")).toHaveCount(1);
  await expect(page.locator('#adminTabs .atab[data-go="ai"]')).toHaveCSS(
    "background-color",
    "rgb(31, 79, 183)",
  );
  await expect(page.locator('#adminTabs .atab[data-go="editor"]')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  expect(writes).toEqual([]);
});
