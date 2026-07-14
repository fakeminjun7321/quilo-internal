const path = require("path");
const { spawn } = require("child_process");

function loadPlaywrightTest() {
  try { return require("@playwright/test"); }
  catch (error) {
    const marker = `${path.sep}node_modules${path.sep}`;
    const cacheKey = Object.keys(require.cache).find((key) => key.includes(`${marker}@playwright${path.sep}test${path.sep}`) || key.includes(`${marker}playwright${path.sep}`));
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
  catch { return false; }
}

test.beforeAll(async () => {
  if (await serverIsUp()) return;
  serverProcess = spawn("node", ["server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: "3000" }, stdio: "pipe" });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Quilo QA server did not start");
});

test.afterAll(() => { if (serverProcess) serverProcess.kill(); });

test("highest-accuracy OCR renders quality evidence and downloads image-preserving documents", async ({ page }) => {
  const consoleErrors = [];
  const exportBodies = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/tools/images/ocr") {
      return route.fulfill({ json: {
        model: "mistral-ocr-4-0",
        text: "# 스캔 제목\n\n본문 123",
        confidence: { average: 0.98, minimum: 0.91, lowConfidenceWords: 1 },
        quality: { agreement: 0.96, reviewRequired: false, selectedVariant: "handwriting" },
        source: { passes: 3, attemptedPasses: 3, mode: "ultra" },
        pages: [{ page: 1, markdown: "# 스캔 제목\n\n본문 123", dimensions: { width: 800, height: 1000 }, images: [{ id: "figure-1", topLeftX: 100, topLeftY: 500, bottomRightX: 400, bottomRightY: 750 }], blocks: [{ type: "text" }], tables: [] }],
      } });
    }
    if (pathname === "/api/tools/images/ocr/export") {
      exportBodies.push(request.postDataBuffer()?.toString("utf8") || "");
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": "attachment; filename=scan_OCR.docx",
          "x-quilo-source-image": "embedded",
          "x-quilo-detected-images": "1",
        },
        body: Buffer.from("PK\u0003\u0004mock-docx"),
      });
    }
    if (pathname === "/api/version") return route.fulfill({ json: { shortCommit: "qa", releaseVersion: "qa" } });
    if (pathname === "/api/me") return route.fulfill({ json: { user: "QA", isAdmin: false } });
    if (pathname === "/api/me/beta") return route.fulfill({ json: { tier: "pro", features: ["image-ocr"] } });
    return route.fulfill({ json: {} });
  });

  await page.goto(`${BASE_URL}/tools/image-ocr.html`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/이미지 OCR/);
  await expect(page.locator("#ocrMode")).toHaveValue("ultra");
  await page.locator("#ocrFile").setInputFiles({
    name: "scan.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zy1sAAAAASUVORK5CYII=", "base64"),
  });
  await page.locator("#ocrRun").click();
  await expect(page.locator("#ocrResult")).toBeVisible();
  await expect(page.locator("#ocrResultMeta")).toContainText("3회 비교");
  await expect(page.locator("#ocrQuality")).toContainText("판독 일치도");
  await expect(page.locator("#ocrQuality")).toContainText("96%");
  await expect(page.getByRole("button", { name: "Word (.docx)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "한글 (.hwpx)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "HTML 내보내기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "TXT 내보내기" })).toBeVisible();

  await page.locator("#ocrText").fill("사용자가 교정한 OCR 텍스트 456");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word (.docx)" }).click();
  await download;
  await expect(page.locator("#ocrExportStatus")).toContainText("감지 그림 1개");
  expect(exportBodies).toHaveLength(1);
  expect(exportBodies[0]).toContain("docx");
  expect(exportBodies[0]).toContain("사용자가 교정한 OCR 텍스트 456");
  expect(consoleErrors).toEqual([]);
});
