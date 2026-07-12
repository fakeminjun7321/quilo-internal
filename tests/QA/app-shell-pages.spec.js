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
const PAGES = [
  "create.html",
  "editor.html",
  "exam-prep.html",
  "filechat.html",
  "physics-studio.html",
  "studio.html",
  "study.html",
  "translate-app.html",
  "translate.html",
  "vibe-coding.html",
];

const EXPECTED_IDS = {
  "create.html": ["betaNotice", "chips", "cmtClose", "cmtList", "cmtModal", "cmtSend", "cmtSlug", "cmtText", "cmtTitle", "galcount", "gallery", "launch", "main-content", "mineWrap", "mylist", "sort", "themeToggle", "whoami"],
  "editor.html": ["agentClear", "agentClose", "agentModel", "agentMsgs", "agentPrompt", "agentSend", "app", "ceFrame", "ceLang", "ceOut", "gate", "ideAgent", "ideFileInput", "ideFiles", "ideNewFile", "ideOpenFile", "ideOpenFolder", "idePanel", "idePanelClose", "ideSide", "ideTabs", "ideWelcome", "main-content", "monaco", "stDownload", "stFormat", "stMinimap", "stMsg", "stPip", "stPos", "stRun", "stSave", "stTheme", "wOpenFile", "wOpenFolder", "wStart"],
  "exam-prep.html": ["badgeCoding", "badgeMath", "badgePhys", "badgeReading", "btnConsole", "btnReset", "btnRunEx", "btnSubmit", "codingGate", "codingMain", "ctAssist", "ctAssistInput", "ctAssistMsgs", "ctAssistSend", "ctDetail", "ctEditor", "ctFallback", "ctList", "ctResults", "ctStatus", "main-content", "mathGate", "mathMain", "paneCoding", "paneMath", "panePhys", "paneReading", "physGate", "physMain", "readingGate", "readingMain", "tabCoding", "tabMath", "tabPhys", "tabReading"],
  "filechat.html": ["accessNote", "fcChat", "fcClear", "fcFileChips", "fcFiles", "fcInput", "fcModel", "fcSend", "gate", "main-content", "themeToggle", "tool"],
  "physics-studio.html": ["MathJax-script", "app", "bal", "copyMd", "cost", "count", "difficulty", "dlMd", "err", "formCard", "gate", "go", "hint", "main-content", "model", "notes", "out", "sol", "style", "themeToggle", "toggleAll", "topic"],
  "studio.html": ["addFileBtn", "app", "balChip", "chips", "devseg", "dlZip", "fileTree", "gate", "imgBtn", "imgFile", "instatus", "main-content", "model", "modeseg", "monacoHost", "msgs", "o", "openPublish", "pCancel", "pCat", "pDo", "pPublic", "pSlug", "pTitle", "popout", "preview", "prompt", "pubModal", "pubModalTitle", "pubStatus", "pv", "pvhost", "refresh", "restoreBar", "restoreMeta", "restoreNo", "restoreYes", "sendBtn", "stage", "tabs", "thumbs", "toStage", "undoBtn"],
  "study.html": ["analyzeBtn", "assumptionList", "betaOut", "betaRange", "closeZoomBtn", "description", "diagramExplanation", "diagramTitle", "downloadBtn", "etaOut", "etaRange", "eventList", "main-content", "minkowskiCanvas", "minkowskiZoomCanvas", "modelHint", "modelSelect", "openZoomBtn", "problemImage", "resetBtn", "studyGate", "studyMain", "studyMsg", "studyStatus", "studyZoomModal", "studyZoomStage", "studyZoomTitle", "themeToggle", "warningList", "worldlineList", "zoomFitBtn", "zoomMinusBtn", "zoomPlusBtn", "zoomScaleOut"],
  "translate-app.html": ["agree", "app", "drop", "est", "file", "gate", "gateBtn", "gateErr", "gateLoginForm", "gatePassword", "gateRemember", "gateUsername", "go", "log", "logout", "main-content", "mode", "model", "result", "terms", "termsClose", "termsLink", "termsLink2", "themeToggle"],
  "translate.html": ["gate", "genSpinner", "main-content", "progress", "progressArea", "resultArea", "retypesetDlgBody", "retypesetDlgTitle", "retypesetMultiBody", "retypesetMultiTitle", "statusTitle", "stopBtn", "themeToggle", "tool", "trBg", "trBgField", "trBgNotify", "trBgNotifyWrap", "trBtn", "trChartRedraw", "trError", "trEstimate", "trForm", "trMode", "trModeHint", "trModel", "trPdf", "trRestoreOnly"],
  "vibe-coding.html": ["again", "chatLog", "chatMsg", "chatSend", "copyMd", "costLine", "dlMd", "err", "gate", "goBtn", "heroImg", "i_free", "i_idea", "i_img", "i_model", "intro", "loadMsg", "loadTitle", "loading", "main-content", "nextBtn", "planArea", "prevBtn", "progress", "refineChat", "refineCost", "result", "stage", "themeToggle", "toStudio", "wizard"],
};

const EXPECTED_DATA = {
  "create.html": ["data-cat", "data-cmt", "data-del", "data-embed", "data-like", "data-q-shell", "data-report", "data-src", "data-title"],
  "editor.html": ["data-act", "data-panel", "data-q-shell"],
  "exam-prep.html": ["data-id", "data-q-shell"],
  "filechat.html": ["data-q-shell"],
  "physics-studio.html": ["data-q-shell"],
  "studio.html": ["data-dev", "data-f", "data-mode", "data-q-shell", "data-rm", "data-tab", "data-tpl", "data-ver"],
  "study.html": ["data-beta", "data-example", "data-q-shell"],
  "translate-app.html": ["data-q-shell"],
  "translate.html": ["data-dz-file", "data-q-shell"],
  "vibe-coding.html": ["data-chip", "data-ex", "data-opt", "data-q-shell"],
};

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let server;
let baseUrl;

function fixture(pathname) {
  const fixtures = {
    "/api/me": { user: "QA 사용자", username: "qa-user", isAdmin: false },
    "/api/me/beta": { admin: false, features: ["create", "relativity-study"], blockedReportTypes: [] },
    "/api/me/balance": { credits: 8, isAdmin: false, modelCredits: { "claude-sonnet-5": 1 } },
    "/api/artifacts": { artifacts: [], persistent: true },
    "/api/artifacts/gallery": { items: [] },
    "/api/artifacts/models": { models: ["claude-sonnet-5"], default: "claude-sonnet-5" },
    "/api/artifacts/image-models": { models: ["gpt-image"], default: "gpt-image" },
    "/api/filechat/access": { allowed: true, reason: "beta" },
    "/api/physics-studio/config": {
      models: [{ id: "claude-sonnet-5", label: "Sonnet 5", credits: 1 }],
      defaultModel: "claude-sonnet-5",
      difficulties: ["상위 학부 중상", "올림피아드"],
      styles: [{ id: "olympiad-deep", label: "올림피아드 심화" }],
    },
    "/api/study/relativity/models": {
      models: [
        { id: "auto", label: "자동", available: true },
        { id: "claude-sonnet-5", label: "Sonnet 5", provider: "anthropic", available: true },
      ],
      defaultModel: "auto",
      autoLadder: ["claude-sonnet-5"],
    },
    "/api/subscriptions/me": { active: true, subscription: { tier: "max" } },
    "/api/vibe/config": {
      models: [{ id: "claude-sonnet-5", label: "Sonnet 5", credits: 1 }],
      defaultModel: "claude-sonnet-5",
      imageAvailable: false,
      imageCredits: 1,
    },
    "/api/chat/status": { enabled: false },
  };
  return fixtures[pathname] || {};
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end("Read-only QA");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(fixture(url.pathname)));
      return;
    }
    const relative = url.pathname === "/" ? "create.html" : url.pathname.replace(/^\/+/, "");
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
        "Content-Type": CONTENT_TYPES[path.extname(file)] || "application/octet-stream",
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

test("all work surfaces use the isolated CompactAppShell and preserve DOM contracts", () => {
  for (const pageName of PAGES) {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, pageName), "utf8");
    const markupOnly = source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
    const localStyles = [...markupOnly.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)/gi)]
      .map((match) => match[1])
      .filter((href) => href.startsWith("/"));
    expect(localStyles, pageName).toEqual(["/ui/foundation.css", "/ui/app-shell.css"]);
    expect(source, pageName).not.toMatch(/\/(?:style\.css|site-shell\.css|site-shell\.js)/);
    expect(markupOnly, pageName).not.toMatch(/<style\b|\sstyle\s*=/i);
    expect(markupOnly.match(/<main\b[^>]*id=["']main-content["']/gi) || [], pageName).toHaveLength(1);
    expect(markupOnly, `${pageName} shell root`).toMatch(/<body\b[^>]*data-app-shell/);
    expect(markupOnly, `${pageName} accessible page name`).toMatch(
      /<main\b[^>]*(?:aria-label=["'][^"']+["'])|<h1\b/i,
    );
    for (const id of EXPECTED_IDS[pageName]) {
      expect(source, `${pageName} keeps #${id}`).toContain(`id="${id}"`);
    }
    for (const dataName of EXPECTED_DATA[pageName]) {
      expect(source, `${pageName} keeps ${dataName}`).toContain(dataName);
    }
  }

  for (const pageName of ["filechat.html", "translate-app.html", "translate.html"]) {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, pageName), "utf8");
    expect(source, `${pageName} runtime markup`).not.toMatch(/\sstyle\s*=/i);
  }
});

test("translate app uses the production Quilo account contract instead of the retired access code", () => {
  const source = fs.readFileSync(path.join(PUBLIC_DIR, "translate-app.html"), "utf8");
  expect(source).not.toContain("me.authed");
  expect(source).not.toContain('id="code"');
  expect(source).not.toContain("JSON.stringify({ code })");
  expect(source).toContain('id="gateUsername"');
  expect(source).toContain('id="gatePassword"');
  expect(source).toContain('href="/login.html"');
  expect(source).toContain("JSON.stringify({ username, password, remember })");
});

test("translate app shows the account login form when the production me endpoint returns 401", async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "로그인이 필요합니다." }) }),
  );
  await page.goto(`${baseUrl}/translate-app.html`, { waitUntil: "networkidle" });
  await expect(page.locator("#gate")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await expect(page.locator("#gateUsername")).toBeFocused();
  await expect(page.locator('#gateLoginForm input[name="username"]')).toHaveAttribute("autocomplete", "username");
  await expect(page.locator('#gateLoginForm input[name="password"]')).toHaveAttribute("autocomplete", "current-password");
  await expect(page.locator('#gate a[href="/login.html"]')).toHaveText("전체 로그인 페이지 열기");
});

async function installNetworkFixtures(page, writes) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin === baseUrl && url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture(url.pathname)) });
      return;
    }
    if (url.origin !== baseUrl) {
      const type = request.resourceType();
      if (type === "script") {
        await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
      } else if (type === "stylesheet") {
        await route.fulfill({ status: 200, contentType: "text/css", body: "" });
      } else {
        await route.fulfill({ status: 204, body: "" });
      }
      return;
    }
    await route.continue();
  });
}

async function exerciseCoreInteraction(page, pageName) {
  if (pageName === "create.html") {
    await page.locator("#sort").selectOption("likes");
    await expect(page.locator("#sort")).toHaveValue("likes");
  } else if (pageName === "editor.html") {
    const before = await page.locator("html").getAttribute("data-theme");
    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", before || "light");
  } else if (pageName === "exam-prep.html") {
    await page.locator("#tabReading").click();
    await expect(page.locator("#paneReading")).toBeVisible();
  } else if (pageName === "filechat.html") {
    await expect(page.locator("#tool")).toBeVisible();
    await page.locator("#fcInput").fill("요약해 줘");
    await page.locator("#fcClear").click();
    await expect(page.locator("#fcChat")).toContainText("대화를 초기화했습니다");
  } else if (pageName === "physics-studio.html") {
    await expect(page.locator("#app")).toBeVisible();
    await page.locator("#topic").fill("특수상대론 운동량");
    await expect(page.locator("#topic")).toHaveValue("특수상대론 운동량");
  } else if (pageName === "studio.html") {
    await expect(page.locator("#app")).toBeVisible();
    await page.locator('[data-mode="image"]').click();
    await expect(page.locator('[data-mode="image"]')).toHaveClass(/on/);
  } else if (pageName === "study.html") {
    await expect(page.locator("#studyMain")).toBeVisible();
    await page.locator('[data-example="boost"]').click();
    await expect(page.locator("#description")).toHaveValue(/막대/);
  } else if (pageName === "translate-app.html") {
    await expect(page.locator("#app")).toBeVisible();
    await page.locator("#mode").selectOption("retypeset");
    await expect(page.locator("#mode")).toHaveValue("retypeset");
  } else if (pageName === "translate.html") {
    await expect(page.locator("#tool")).toBeVisible();
    await page.locator("#trMode").selectOption("inplace");
    await expect(page.locator("#trModeHint")).toContainText("레이아웃");
  } else if (pageName === "vibe-coding.html") {
    await expect(page.locator("#wizard")).toBeVisible();
    await page.locator("#i_idea").fill("실험 일정 관리 웹앱");
    await page.locator("#nextBtn").click();
    await expect(page.locator("#stage h2")).toContainText("어떤 느낌");
  }
}

async function shellGeometry(page) {
  return page.evaluate(() => {
    const header = document.querySelector(".app-commandbar");
    const status = document.querySelector(".app-statusbar");
    const headerRect = header.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    const commandbarOffenders = [...header.querySelectorAll("a, button")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      })
      .map((element) => element.id || element.textContent.trim());
    return {
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      headerPosition: getComputedStyle(header).position,
      headerTop: Math.round(headerRect.top),
      statusPosition: getComputedStyle(status).position,
      statusBottom: Math.round(innerHeight - statusRect.bottom),
      commandbarOffenders,
    };
  });
}

async function verifyPinnedChrome(page, pageName) {
  const maxScroll = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - innerHeight),
  );
  if (maxScroll === 0) return;
  await page.evaluate((top) => window.scrollTo(0, top), Math.min(240, maxScroll));
  await page.waitForTimeout(40);
  const pinned = await page.evaluate(() => {
    const headerRect = document.querySelector(".app-commandbar").getBoundingClientRect();
    const statusRect = document.querySelector(".app-statusbar").getBoundingClientRect();
    return {
      headerTop: Math.round(headerRect.top),
      statusBottom: Math.round(innerHeight - statusRect.bottom),
    };
  });
  expect(pinned, `${pageName} pinned chrome after scroll`).toEqual({ headerTop: 0, statusBottom: 0 });
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const pageName of PAGES) {
  test(`${pageName} renders at 1440×933, responds, and has no runtime errors`, async ({ page }) => {
    const writes = [];
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    await installNetworkFixtures(page, writes);
    await page.setViewportSize({ width: 1440, height: 933 });
    await page.goto(`${baseUrl}/${pageName}`, { waitUntil: "networkidle" });

    await expect(page.locator(".app-commandbar")).toBeVisible();
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator(".app-statusbar")).toBeVisible();
    await expect(page.locator("body")).toHaveClass(new RegExp(`app-shell--${pageName.replace(/\.html$/, "")}`));
    await exerciseCoreInteraction(page, pageName);
    const geometry = await shellGeometry(page);
    expect(geometry, pageName).toEqual({
      overflow: 0,
      headerPosition: "sticky",
      headerTop: 0,
      statusPosition: "fixed",
      statusBottom: 0,
      commandbarOffenders: [],
    });
    await verifyPinnedChrome(page, pageName);
    if (["create.html", "studio.html", "study.html", "translate.html"].includes(pageName)) {
      await page.screenshot({ path: `/tmp/quilo-${pageName.replace(".html", "")}-app-shell.png`, fullPage: false });
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("all work surfaces reflow and respond at the 933px compact desktop width", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await installNetworkFixtures(page, []);
  await page.setViewportSize({ width: 933, height: 768 });

  for (const pageName of PAGES) {
    const errorCount = errors.length;
    await page.goto(`${baseUrl}/${pageName}`, { waitUntil: "networkidle" });
    await exerciseCoreInteraction(page, pageName);
    const geometry = await shellGeometry(page);
    expect(geometry, pageName).toEqual({
      overflow: 0,
      headerPosition: "sticky",
      headerTop: 0,
      statusPosition: "fixed",
      statusBottom: 0,
      commandbarOffenders: [],
    });
    await verifyPinnedChrome(page, pageName);
    if (["create.html", "studio.html", "translate.html"].includes(pageName)) {
      await page.screenshot({
        path: `/tmp/quilo-${pageName.replace(".html", "")}-app-shell-933.png`,
        fullPage: false,
      });
    }
    expect(errors.slice(errorCount), `${pageName} console health`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("representative empty, modal, and loading states remain contained in CompactAppShell", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await installNetworkFixtures(page, []);
  await page.setViewportSize({ width: 1440, height: 933 });

  await page.goto(`${baseUrl}/create.html`, { waitUntil: "networkidle" });
  await expect(page.locator("#gallery .empty")).toBeVisible();
  await page.locator("#cmtModal").evaluate((modal) => { modal.hidden = false; });
  await expect(page.locator("#cmtModal")).toBeVisible();
  const modalRect = await page.locator("#cmtModal .card").boundingBox();
  expect(modalRect.x).toBeGreaterThanOrEqual(0);
  expect(modalRect.y).toBeGreaterThanOrEqual(0);
  expect(modalRect.x + modalRect.width).toBeLessThanOrEqual(1440);
  expect(modalRect.y + modalRect.height).toBeLessThanOrEqual(933);
  await page.locator("#cmtClose").click();
  await expect(page.locator("#cmtModal")).toBeHidden();

  await page.goto(`${baseUrl}/translate-app.html`, { waitUntil: "networkidle" });
  await page.locator("#termsLink").click();
  await expect(page.locator("#terms")).toBeVisible();
  await page.locator("#termsClose").click();
  await expect(page.locator("#terms")).toBeHidden();

  await page.route("**/api/physics-studio/generate", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { title: "QA", problems: [] }, newBalance: 7 }),
    });
  });
  await page.goto(`${baseUrl}/physics-studio.html`, { waitUntil: "networkidle" });
  await page.locator("#topic").fill("특수상대론 운동량");
  await page.locator("#go").click();
  await expect(page.locator("#go")).toContainText("생성 중");
  await expect(page.locator("#out .spinner")).toBeVisible();
  await expect(page.locator("#go")).toHaveText("문제 생성", { timeout: 3000 });
  expect(errors).toEqual([]);
});
