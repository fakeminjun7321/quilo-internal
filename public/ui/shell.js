"use strict";

(function initQuiloSiteShell() {
  const header = document.querySelector("[data-ui-shell]");
  if (!header) return;

  const MENU_GROUPS = Object.freeze([
    {
      label: "제품",
      items: [
        ["/?report=chem-pre", "화학 사전보고서", "매뉴얼 PDF에서 사전보고서 초안 생성", "chem-pre"],
        ["/?report=chem-result", "화학 결과보고서", "데이터와 사진에서 결과 추가분 생성", "chem-result"],
        ["/?report=phys-result", "물리 결과보고서", "Capstone·엑셀 기반 결과보고서 생성", "phys-result"],
        ["/?report=free", "자유 보고서", "지시와 자료를 원하는 형식으로 정리", "free"],
      ],
    },
    {
      label: "솔루션",
      items: [
        ["/tools/index.html", "보고서 도구", "파일·이미지·PDF·수식 도구"],
        ["/translate.html", "PDF 통번역", "문서 구조를 지키는 번역 작업"],
      ],
    },
    {
      label: "앱",
      items: [
        ["/apps/quilo.html", "Quilo Desktop", "Mac과 Windows용 작업 공간"],
        ["/apps/live-translator.html", "Live Translator", "실시간 음성 번역 앱"],
      ],
    },
    {
      label: "개발자",
      items: [
        ["/developers.html", "개발자 플랫폼", "API·ChatGPT·Codex 연결"],
        ["/developers.html#catalog", "기능 카탈로그", "연결 가능한 Quilo 기능"],
        ["/developers.html#tokenCard", "API 토큰", "범위 제한 토큰 관리"],
      ],
    },
    {
      label: "리소스",
      items: [
        ["/guide.html", "가이드", "기능별 시작 방법과 사용 원칙"],
        ["/examples.html", "예시", "Quilo로 만든 결과물 살펴보기"],
        ["/changelog.html", "업데이트", "새 기능과 개선 내역"],
        ["/community.html", "커뮤니티", "작업 사례와 질문 나누기"],
        ["/school-apply.html", "학교 도입", "기관용 도입 문의"],
      ],
    },
  ]);

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  function menuItem([href, title, description, report]) {
    const reportData = report ? ` data-report="${escapeHtml(report)}"` : "";
    return `<a href="${escapeHtml(href)}"${reportData}><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></a>`;
  }

  function desktopMenu(group, index) {
    const id = `ui-site-menu-${index + 1}`;
    const menuSize = Math.min(Math.max(group.items.length, 2), 5);
    return `
      <details class="ui-site-disclosure" data-ui-disclosure>
        <summary aria-controls="${id}">${escapeHtml(group.label)}</summary>
        <div class="ui-site-menu" id="${id}" role="region" aria-label="${escapeHtml(group.label)} 메뉴">
          <div class="ui-site-menu__inner ui-site-menu__inner--${menuSize}">
            ${group.items.map(menuItem).join("")}
          </div>
        </div>
      </details>`;
  }

  function mobileLinks() {
    return MENU_GROUPS.flatMap((group) => group.items)
      .map(([href, title, , report]) => {
        const reportData = report ? ` data-report="${escapeHtml(report)}"` : "";
        return `<a href="${escapeHtml(href)}"${reportData}>${escapeHtml(title)}</a>`;
      })
      .join("");
  }

  function shellMarkup() {
    return `
      <div class="ui-site-header__inner">
        <a class="ui-site-brand" href="/" aria-label="Quilo 홈">
          <img src="/favicon.png" alt="" width="38" height="38" />
          <span>Quilo</span>
        </a>
        <nav class="ui-site-nav" id="navMenu" aria-label="주요 메뉴">
          ${MENU_GROUPS.map(desktopMenu).join("")}
          <a class="ui-site-link" href="/pricing.html">요금</a>
          <a class="ui-site-link" href="https://www.instagram.com/quilo._.official/" target="_blank" rel="noopener">Instagram ↗</a>
        </nav>
        <div class="ui-site-actions">
          <div class="ui-session-slot" id="accountSlot">
            <a class="ui-site-action ui-session-trigger" id="sessionAction" data-ui-auth-action href="/?login=1" hidden><span id="user" data-ui-auth-label>로그인</span></a>
            <small class="ui-session-tier" id="accountTriggerMeta" aria-hidden="true" hidden>Account</small>
            <div class="ui-session-panel ui-login-panel" id="loginDd" hidden>
              <form id="loginForm" class="ui-login-form">
                <div class="ui-login-head">
                  <span>Account sign in</span>
                  <strong>Quilo에 로그인</strong>
                  <p>작업과 생성 파일을 이어서 관리하세요.</p>
                </div>
                <label for="li_username">아이디</label>
                <input id="li_username" name="username" required maxlength="50" autocomplete="username" />
                <label for="li_password">비밀번호</label>
                <input id="li_password" name="password" type="password" required autocomplete="current-password" />
                <label class="ui-login-remember"><input id="li_remember" name="remember" type="checkbox" checked /> 로그인 유지</label>
                <button type="submit" id="li_btn">로그인</button>
                <p id="li_err" class="ui-login-error" role="alert" aria-live="polite"></p>
                <a class="ui-login-alt" href="/signup.html">계정 만들기</a>
              </form>
            </div>
            <div class="ui-session-panel ui-account-panel" id="acctDd" hidden>
              <div class="ui-account-head"><strong id="accountMenuName">내 계정</strong><span id="accountMenuMeta">Quilo Account</span></div>
              <a href="/#settings" data-tab="settings"><strong>Account Center</strong><span>계정·사용량·기본 설정</span></a>
              <a href="/#files" data-tab="files"><strong>내 파일</strong><span>최근 생성 파일</span></a>
              <a href="/#integrations" data-tab="integrations"><strong>외부 서비스 연결</strong><span>Dropbox와 API 연결</span></a>
              <a href="/#feedback" data-tab="feedback"><strong>건의사항</strong><span>문제 제보와 기능 제안</span></a>
              <a href="/admin.html" id="adminLink" hidden><strong>관리자</strong><span>운영 화면 열기</span></a>
              <button type="button" id="logout">로그아웃</button>
            </div>
          </div>
          <button type="button" class="ui-site-action ui-theme-toggle" id="themeToggle" data-ui-theme>
            <span aria-hidden="true">🌙</span>
          </button>
          <a class="ui-site-action ui-site-cta" data-ui-start-action href="/signup.html">무료로 시작하기</a>
        </div>
        <details class="ui-mobile-menu" data-ui-mobile>
          <summary class="ui-mobile-trigger">메뉴</summary>
          <nav class="ui-mobile-panel" aria-label="모바일 메뉴">
            ${mobileLinks()}
            <a href="/pricing.html">요금</a>
            <a href="https://www.instagram.com/quilo._.official/" target="_blank" rel="noopener">Instagram ↗</a>
            <button type="button" data-ui-theme><span aria-hidden="true">🌙</span></button>
            <a data-ui-auth-action href="/?login=1" hidden><span data-ui-auth-label>로그인</span></a>
            <a class="ui-site-cta" data-ui-start-action href="/signup.html">무료로 시작하기</a>
          </nav>
        </details>
      </div>`;
  }

  header.className = "ui-site-header";
  header.dataset.uiShell = "";
  header.dataset.uiShellMounted = "true";
  header.dataset.uiAuthState = "pending";
  header.setAttribute("aria-busy", "true");
  header.innerHTML = shellMarkup();

  const disclosures = [...header.querySelectorAll("[data-ui-disclosure], [data-ui-mobile]")];
  const accountSlot = header.querySelector("#accountSlot");
  const loginPanel = header.querySelector("#loginDd");
  const accountPanel = header.querySelector("#acctDd");
  const authActions = [...header.querySelectorAll("[data-ui-auth-action]")];
  const currentUrl = new URL(window.location.href);
  let currentAuthState = { state: "pending", user: null, status: null };

  function accountName(user) {
    return String(user?.user || user?.name || user?.username || "내 계정").trim() || "내 계정";
  }

  function closeDropdowns({ restoreFocus = false } = {}) {
    const active = header.querySelector("[data-ui-disclosure][open] > summary, .ui-session-slot.is-open .ui-session-trigger");
    disclosures.forEach((details) => { details.open = false; });
    accountSlot?.classList.remove("is-open");
    loginPanel?.classList.remove("open");
    accountPanel?.classList.remove("open");
    header.querySelector("#sessionAction")?.setAttribute("aria-expanded", "false");
    if (restoreFocus) active?.focus();
  }

  function openSessionPanel(kind) {
    if (!accountSlot || currentAuthState.state === "unknown" || currentAuthState.state === "pending") return false;
    disclosures.forEach((details) => { details.open = false; });
    const expected = kind || (currentAuthState.state === "authenticated" ? "account" : "login");
    if (loginPanel) loginPanel.hidden = expected !== "login";
    if (accountPanel) accountPanel.hidden = expected !== "account";
    loginPanel?.classList.toggle("open", expected === "login");
    accountPanel?.classList.toggle("open", expected === "account");
    accountSlot.classList.add("is-open");
    header.querySelector("#sessionAction")?.setAttribute("aria-expanded", "true");
    if (expected === "login") setTimeout(() => header.querySelector("#li_username")?.focus(), 0);
    return true;
  }

  disclosures.forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      accountSlot?.classList.remove("is-open");
      disclosures.forEach((other) => { if (other !== details) other.open = false; });
    });
  });

  header.querySelector("#sessionAction")?.addEventListener("click", (event) => {
    if (!["anonymous", "authenticated"].includes(currentAuthState.state)) return;
    event.preventDefault();
    if (accountSlot?.classList.contains("is-open")) closeDropdowns();
    else openSessionPanel();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!header.contains(event.target)) closeDropdowns();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDropdowns({ restoreFocus: true });
  });

  header.querySelectorAll("a[href]").forEach((link) => {
    const target = new URL(link.href, currentUrl);
    if (target.origin !== currentUrl.origin) return;
    if (target.pathname === currentUrl.pathname && target.search === currentUrl.search && target.hash === currentUrl.hash) {
      link.setAttribute("aria-current", "page");
    }
  });

  function syncTheme() {
    const dark = document.documentElement.dataset.theme === "dark";
    header.querySelectorAll("[data-ui-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "라이트 테마로 변경" : "다크 테마로 변경");
      button.setAttribute("title", dark ? "라이트 테마로 변경" : "다크 테마로 변경");
      const label = button.querySelector("span") || button;
      label.textContent = dark ? "☀️" : "🌙";
    });
  }

  const usesThemeJs = [...document.scripts].some((script) => {
    try { return new URL(script.src, currentUrl).pathname === "/theme.js"; } catch (_) { return false; }
  });
  if (!usesThemeJs) {
    header.querySelectorAll("[data-ui-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem("theme", next); } catch (_) {}
        syncTheme();
      });
    });
  }
  document.addEventListener("quilo:theme-change", syncTheme);
  syncTheme();

  function renderAuthState(result) {
    currentAuthState = result;
    header.dataset.uiAuthState = result.state;
    header.setAttribute("aria-busy", "false");
    document.body.dataset.sessionState = result.state;
    closeDropdowns();

    const authenticated = result.state === "authenticated";
    const anonymous = result.state === "anonymous";
    const name = authenticated ? accountName(result.user) : "";
    const compactName = [...name].length > 14 ? `${[...name].slice(0, 14).join("")}…` : name;

    header.querySelectorAll("[data-ui-start-action]").forEach((action) => {
      if (authenticated) {
        action.href = "/?report=free";
        action.textContent = "작업 시작하기";
      } else {
        action.href = "/signup.html";
        action.textContent = "무료로 시작하기";
      }
    });

    if (loginPanel) loginPanel.hidden = !anonymous;
    if (accountPanel) accountPanel.hidden = !authenticated;
    const adminLink = header.querySelector("#adminLink");
    if (adminLink) adminLink.hidden = !authenticated || result.user?.isAdmin !== true;
    const accountMenuName = header.querySelector("#accountMenuName");
    if (accountMenuName && authenticated) accountMenuName.textContent = name;
    const accountTier = header.querySelector("#accountTriggerMeta");
    if (accountTier) accountTier.hidden = !authenticated;

    authActions.forEach((action) => {
      const label = action.querySelector("[data-ui-auth-label]") || action;
      action.hidden = false;
      action.dataset.uiAuthState = result.state;
      action.removeAttribute("title");
      if (authenticated) {
        label.textContent = `${compactName} 님`;
        action.href = "/#settings";
        action.setAttribute("aria-label", `${name} Account Center 열기`);
      } else if (anonymous) {
        label.textContent = "로그인";
        action.href = "/?login=1";
        action.setAttribute("aria-label", "Quilo 로그인");
      } else {
        label.textContent = "계정 확인";
        action.href = "/";
        action.setAttribute("aria-label", "로그인 상태를 다시 확인하려면 홈으로 이동");
        action.title = "로그인 상태를 확인하지 못했습니다.";
      }
    });

    try { document.dispatchEvent(new CustomEvent("quilo:auth-state", { detail: result })); } catch (_) {}
    return result;
  }

  async function syncAuthState() {
    try {
      const response = await fetch("/api/me", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (response.status === 401) return renderAuthState({ state: "anonymous", user: null, status: 401 });
      if (!response.ok) return renderAuthState({ state: "unknown", user: null, status: response.status });
      return renderAuthState({ state: "authenticated", user: await response.json(), status: response.status });
    } catch (_) {
      return renderAuthState({ state: "unknown", user: null, status: 0 });
    }
  }

  const authReady = syncAuthState();
  window.QuiloShellAuth = Object.freeze({
    ready: authReady,
    refresh: syncAuthState,
    current: () => currentAuthState,
  });
  window.QuiloSiteShell = Object.freeze({
    closeDropdowns,
    openLogin: () => openSessionPanel("login"),
    openAccount: () => openSessionPanel("account"),
  });

  const isWorkspace = document.body.classList.contains("home-page");
  if (!isWorkspace) {
    header.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = header.querySelector("#li_btn");
      const error = header.querySelector("#li_err");
      if (button) { button.disabled = true; button.textContent = "로그인 중…"; }
      if (error) error.textContent = "";
      try {
        const response = await fetch("/api/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            username: header.querySelector("#li_username")?.value || "",
            password: header.querySelector("#li_password")?.value || "",
            remember: header.querySelector("#li_remember")?.checked !== false,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "로그인하지 못했습니다.");
        location.reload();
      } catch (exception) {
        if (error) error.textContent = exception.message;
        if (button) { button.disabled = false; button.textContent = "로그인"; }
      }
    });
    header.querySelector("#logout")?.addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      location.assign("/");
    });
  }

  const downloadButtons = [...document.querySelectorAll("[data-app-download]")];
  const downloadStatus = document.querySelector("[data-app-download-status]");
  downloadButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const platform = button.dataset.platform === "mac" ? "macOS" : "Windows";
      const appName = button.dataset.app === "live-translator" ? "Live Translator" : "Quilo Desktop";
      if (downloadStatus) {
        downloadStatus.classList.remove("is-error");
        downloadStatus.textContent = `${appName} ${platform} 다운로드를 시작했습니다.`;
      }
    });
  });

  const versionNodes = [...document.querySelectorAll("[data-site-version]")];
  if (versionNodes.length) {
    fetch("/api/version", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("version fetch failed");
        return response.json();
      })
      .then((info) => {
        if (!info?.version) throw new Error("version missing");
        const label = info.shortCommit ? `v${info.version} · ${info.shortCommit}` : `v${info.version}`;
        versionNodes.forEach((node) => {
          node.textContent = label;
          node.title = info.commit ? `commit ${info.commit}` : "현재 배포 버전";
        });
      })
      .catch(() => versionNodes.forEach((node) => { node.textContent = "버전 확인 불가"; }));
  }
})();
