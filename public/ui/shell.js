"use strict";

(function initStaticQuiloShell() {
  const header = document.querySelector("[data-ui-shell]");
  if (!header) return;

  const authActions = [...header.querySelectorAll('[data-ui-auth-action], a[href="/?login=1"]')];
  let currentAuthState = { state: "pending", user: null };

  authActions.forEach((link) => {
    link.dataset.uiAuthAction = "";
    link.hidden = true;
  });
  if (authActions.length) {
    header.dataset.uiAuthState = "pending";
    header.setAttribute("aria-busy", "true");
  }

  function accountName(user) {
    return String(user?.user || user?.name || user?.username || "내 계정").trim() || "내 계정";
  }

  function renderAuthState(result) {
    currentAuthState = result;
    header.dataset.uiAuthState = result.state;
    header.setAttribute("aria-busy", "false");

    authActions.forEach((link) => {
      link.hidden = false;
      link.dataset.uiAuthState = result.state;
      link.removeAttribute("title");

      if (result.state === "authenticated") {
        const name = accountName(result.user);
        const compactName = [...name].length > 14 ? `${[...name].slice(0, 14).join("")}…` : name;
        link.textContent = `${compactName} 님`;
        link.href = "/#settings";
        link.setAttribute("aria-label", `${name} Account Center 열기`);
        return;
      }

      if (result.state === "anonymous") {
        link.textContent = "로그인";
        link.href = "/?login=1";
        link.setAttribute("aria-label", "Quilo 로그인");
        return;
      }

      // A failed status check is not proof that the browser session ended.
      // Keep this neutral and never call the logout endpoint from the shell.
      link.textContent = "Quilo로 돌아가기";
      link.href = "/";
      link.setAttribute("aria-label", "Quilo로 돌아가기");
      link.title = "로그인 상태를 확인하지 못했습니다.";
    });

    try {
      document.dispatchEvent(new CustomEvent("quilo:auth-state", { detail: result }));
    } catch (_) {}
    return result;
  }

  async function syncAuthState() {
    if (!authActions.length) return { state: "unsupported", user: null };
    try {
      const response = await fetch("/api/me", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (response.status === 401) {
        return renderAuthState({ state: "anonymous", user: null, status: 401 });
      }
      if (!response.ok) {
        return renderAuthState({ state: "unknown", user: null, status: response.status });
      }
      const user = await response.json();
      return renderAuthState({ state: "authenticated", user, status: response.status });
    } catch (_) {
      return renderAuthState({ state: "unknown", user: null, status: 0 });
    }
  }

  const authReady = authActions.length
    ? syncAuthState()
    : Promise.resolve({ state: "unsupported", user: null });

  window.QuiloShellAuth = Object.freeze({
    ready: authReady,
    refresh: syncAuthState,
    current: () => currentAuthState,
  });

  const desktopActions = header.querySelector(".ui-site-actions");
  if (desktopActions && !desktopActions.querySelector("[data-ui-theme]")) {
    const desktopTheme = document.createElement("button");
    desktopTheme.type = "button";
    desktopTheme.className = "ui-site-action ui-theme-toggle";
    desktopTheme.setAttribute("data-ui-theme", "");
    desktopTheme.innerHTML =
      '<span class="ui-theme-toggle__icon ui-theme-toggle__icon--moon" aria-hidden="true">☾</span>' +
      '<span class="ui-theme-toggle__icon ui-theme-toggle__icon--sun" aria-hidden="true">☀</span>';
    desktopActions.insertBefore(desktopTheme, desktopActions.lastElementChild);
  }

  const disclosures = [...header.querySelectorAll("details")];
  const themeButtons = [...document.querySelectorAll("[data-ui-theme]")];
  const currentPath = window.location.pathname;

  header.querySelectorAll('a[href*="instagram.com"]').forEach((link) => {
    link.href = "https://www.instagram.com/quilo._.official/";
  });

  function syncTheme() {
    const dark = document.documentElement.dataset.theme === "dark";
    themeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "라이트 테마로 변경" : "다크 테마로 변경");
      button.setAttribute("title", dark ? "라이트 테마로 변경" : "다크 테마로 변경");
      if (!button.classList.contains("ui-theme-toggle")) {
        button.textContent = dark ? "라이트 테마" : "다크 테마";
      }
    });
  }

  header.querySelectorAll("a[href]").forEach((link) => {
    const target = new URL(link.href, window.location.href);
    if (target.origin === window.location.origin && target.pathname === currentPath && !target.hash) {
      link.setAttribute("aria-current", "page");
    }
  });

  disclosures.forEach((details) => {
    const summary = details.querySelector(":scope > summary");
    const menu = details.querySelector(":scope > .ui-site-menu");
    if (summary && menu) {
      if (!menu.id) menu.id = `site-menu-${Math.random().toString(36).slice(2, 9)}`;
      menu.setAttribute("role", "region");
      menu.setAttribute("aria-label", `${summary.textContent.trim()} 메뉴`);
      summary.setAttribute("aria-controls", menu.id);
    }
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      disclosures.forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (header.contains(event.target)) return;
    disclosures.forEach((details) => { details.open = false; });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = disclosures.find((details) => details.open);
    disclosures.forEach((details) => { details.open = false; });
    open?.querySelector(":scope > summary")?.focus();
  });

  themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (_) {}
      syncTheme();
    });
  });

  syncTheme();

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
