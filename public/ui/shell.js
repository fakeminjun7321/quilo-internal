"use strict";

(function initStaticQuiloShell() {
  const header = document.querySelector("[data-ui-shell]");
  if (!header) return;

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
