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
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function resolvePublicFile(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch (_) {
    return null;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;
  try {
    if (fs.statSync(filePath).isDirectory()) return path.join(filePath, "index.html");
  } catch (_) {}
  return filePath;
}

function createStaticServer() {
  return http.createServer((request, response) => {
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
      response.end(body);
    });
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

let server;
let baseUrl;

test.beforeAll(async () => {
  server = createStaticServer();
  baseUrl = await listen(server);
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function mockLoggedIn(page) {
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me") {
      return route.fulfill({
        json: {
          user: "QA",
          studentId: "2402",
          isAdmin: false,
          styleNote: "",
          blockedReportTypes: [],
          reportEligible: true,
          emailVerified: true,
        },
      });
    }
    if (pathname === "/api/announcements") return route.fulfill({ json: { announcements: [] } });
    if (pathname === "/api/me/beta") return route.fulfill({ json: { admin: false, features: [] } });
    if (pathname === "/api/me/balance") return route.fulfill({ json: { credits: 8, unlimited: false } });
    if (pathname === "/api/subscriptions/me") return route.fulfill({ json: { active: false, subscription: null } });
    if (pathname === "/api/catalog") return route.fulfill({ json: { total: 0, categories: {}, features: [] } });
    return route.fulfill({ json: {} });
  });
}

async function expectBulkModeOpen(page) {
  await expect(page.locator("#readingLogForm")).toBeVisible();
  await expect(page.locator('input[name="reportType"][value="reading-log"]')).toBeChecked();
  await expect(page.locator('#readingLogForm input[name="rlMode"][value="bulk"]')).toBeChecked();
  await expect(page.locator("#rlBulkSection")).toBeVisible();
  await expect(page.locator("#rlBtn")).toHaveText("독서록 대량 생성 (ZIP)");
  await expect(page.locator("body")).toHaveAttribute("data-view", "workspace");
}

test("/?report=reading-log-bulk opens the 독서록 form in bulk mode", async ({ page }) => {
  await mockLoggedIn(page);
  await page.goto(`${baseUrl}/?report=reading-log-bulk`, { waitUntil: "load" });
  // select()가 report 런타임 lazy import보다 먼저 실행되는 경로까지 그대로 검증한다.
  await expectBulkModeOpen(page);
});

test("in-page 독서록 대량 생성 nav link selects bulk mode", async ({ page }) => {
  await mockLoggedIn(page);
  await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  await expect(page.locator("body")).toHaveAttribute("data-auth", "in");
  // 데스크톱 메가메뉴 패널은 열 때 lazy 렌더되지만 모바일 패널 앵커는 로드 시 즉시 존재한다.
  // 숨겨진 앵커라 locator 클릭 대신 위임 핸들러(shell-controller)로 이벤트를 흘린다.
  await page.waitForSelector('[data-ui-shell] a[data-report="reading-log-bulk"]', { state: "attached" });
  await page.evaluate(() => {
    document.querySelector('[data-ui-shell] a[data-report="reading-log-bulk"]').click();
  });
  await expectBulkModeOpen(page);
});

// ── 회귀: 출력 형식 필수 항목 ────────────────────────────────────────────────
// rlFormat 이 hidden input 이던 시절, 체크리스트 '출력 형식'(checked 판정)이 영원히
// 미완료라 화면에 고를 것이 없는데도 필수 미충족으로 남고 생성 버튼이 잠겼다.
// 폼에 보이는 .hwpx 고정 라디오가 기본 선택되어 항목이 즉시 완료되어야 한다.

const checklistItem = (page, label) =>
  page.locator("#reportChecklist li").filter({ hasText: label });

test("독서록 출력 형식 항목은 열자마자 완료 상태다 (보이는 .hwpx 라디오)", async ({ page }) => {
  await mockLoggedIn(page);
  await page.goto(`${baseUrl}/?report=reading-log`, { waitUntil: "load" });
  await expect(page.locator("#readingLogForm")).toBeVisible();

  const formatRadio = page.locator('#readingLogForm input[name="rlFormat"][value="hwpx"]');
  await expect(formatRadio).toBeVisible();
  await expect(formatRadio).toBeChecked();
  await expect(checklistItem(page, "출력 형식")).toHaveClass(/chk-done/);
});

test("독서록 필수 입력을 채우면 생성 버튼이 실제로 활성화된다", async ({ page }) => {
  await mockLoggedIn(page);
  await page.goto(`${baseUrl}/?report=reading-log`, { waitUntil: "load" });
  await expect(page.locator("#readingLogForm")).toBeVisible();

  // 한 권씩 모드: 도서명 + 정책 동의만 남는다 (기록 영역·출력 형식·모델은 기본값).
  await expect(page.locator("#rlBtn")).toBeDisabled();
  await page.fill("#rlTitle", "코스모스");
  await page.check('#readingLogForm .policy-check input[type="checkbox"]');
  await expect(checklistItem(page, "도서명 또는 책 목록")).toHaveClass(/chk-done/);
  await expect(page.locator("#rlBtn")).toBeEnabled();
});

test("대량 모드에서 책 목록 파일을 올리면 생성 버튼이 활성화된다", async ({ page }) => {
  await mockLoggedIn(page);
  await page.goto(`${baseUrl}/?report=reading-log-bulk`, { waitUntil: "load" });
  await expectBulkModeOpen(page);

  await expect(page.locator("#rlBtn")).toBeDisabled();
  await page.setInputFiles("#rlExcel", {
    name: "책목록.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("분야,책이름,출판사,작가\n물리,부분과 전체,서커스,하이젠베르크\n문학,1984,민음사,조지 오웰\n", "utf8"),
  });
  await page.check('#readingLogForm .policy-check input[type="checkbox"]');
  await expect(checklistItem(page, "도서명 또는 책 목록")).toHaveClass(/chk-done/);
  await expect(checklistItem(page, "출력 형식")).toHaveClass(/chk-done/);
  await expect(page.locator("#rlBtn")).toBeEnabled();
});
