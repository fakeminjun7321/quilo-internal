"use strict";

(function initQuiloShell() {
  const mount = document.querySelector("[data-q-shell]");
  if (!mount) return;

  const currentPath = window.location.pathname;

  mount.outerHTML = `
    <a class="q-shell__skip" href="#main-content">본문으로 건너뛰기</a>
    <header class="q-shell" data-q-shell-root>
      <div class="q-shell__inner">
        <a class="q-shell__brand" href="/" aria-label="Quilo 홈">
          <img src="/favicon.png" alt="" width="34" height="34" />
          <span>Quilo</span>
        </a>

        <nav class="q-shell__nav" aria-label="주요 메뉴">
          <details>
            <summary>제품</summary>
            <div class="q-shell__menu">
              <a href="/?report=chem-pre"><strong>화학 사전보고서</strong><span>매뉴얼 PDF에서 사전보고서 초안 생성</span></a>
              <a href="/?report=chem-result"><strong>화학 결과보고서</strong><span>데이터와 사진에서 결과 추가분 생성</span></a>
              <a href="/?report=phys-result"><strong>물리 결과보고서</strong><span>Capstone·엑셀 기반 결과보고서 생성</span></a>
              <a href="/?report=free"><strong>자유 보고서</strong><span>지시와 자료를 원하는 형식으로 정리</span></a>
            </div>
          </details>
          <details>
            <summary>솔루션</summary>
            <div class="q-shell__menu">
              <a href="/tools/index.html"><strong>보고서 도구</strong><span>파일·이미지·PDF·수식 도구</span></a>
              <a href="/translate.html"><strong>PDF 통번역</strong><span>문서 구조를 지키는 번역 작업</span></a>
            </div>
          </details>
          <details>
            <summary>앱</summary>
            <div class="q-shell__menu q-shell__menu--narrow">
              <a href="/apps/quilo.html"><strong>Quilo Desktop</strong><span>Mac과 Windows용 작업 공간</span></a>
              <a href="/apps/live-translator.html"><strong>Live Translator</strong><span>실시간 음성 번역 앱</span></a>
            </div>
          </details>
          <details>
            <summary>개발자</summary>
            <div class="q-shell__menu q-shell__menu--narrow">
              <a href="/developers.html"><strong>개발자 플랫폼</strong><span>API·ChatGPT·Codex 연결</span></a>
              <a href="/developers.html#catalogSection"><strong>기능 카탈로그</strong><span>연결 가능한 Quilo 기능</span></a>
              <a href="/developers.html#tokenSection"><strong>API 토큰</strong><span>범위 제한 토큰 관리</span></a>
            </div>
          </details>
          <details>
            <summary>리소스</summary>
            <div class="q-shell__menu q-shell__menu--narrow">
              <a href="/guide.html"><strong>가이드</strong><span>기능별 시작 방법과 사용 원칙</span></a>
              <a href="/examples.html"><strong>예시</strong><span>Quilo로 만든 결과물 살펴보기</span></a>
              <a href="/changelog.html"><strong>업데이트</strong><span>새 기능과 개선 내역</span></a>
              <a href="/community.html"><strong>커뮤니티</strong><span>작업 사례와 질문 나누기</span></a>
              <a href="/school-apply.html"><strong>학교 도입</strong><span>기관용 도입 문의</span></a>
            </div>
          </details>
          <a href="/#balanceBox">요금</a>
          <a href="https://www.instagram.com/" target="_blank" rel="noopener">Instagram ↗</a>
        </nav>

        <div class="q-shell__actions">
          <button class="q-shell__theme" type="button" data-q-theme><span class="q-shell__theme-moon" aria-hidden="true">🌙</span><span class="q-shell__theme-sun" aria-hidden="true">☀️</span></button>
          <a class="q-shell__plain-action" href="/?login=1">로그인</a>
          <a class="q-shell__cta" href="/?report=free">무료로 시작하기</a>
        </div>

        <details class="q-shell__mobile">
          <summary>메뉴</summary>
          <nav class="q-shell__mobile-panel" aria-label="모바일 메뉴">
            <a href="/?report=chem-pre">보고서 만들기</a>
            <a href="/tools/index.html">기능</a>
            <a href="/apps/quilo.html">앱</a>
            <a href="/developers.html">개발자 플랫폼</a>
            <a href="/guide.html">가이드</a>
            <button type="button" data-q-theme><span aria-hidden="true">🌙</span> 테마 변경</button>
            <a href="/?login=1">로그인</a>
            <a class="q-shell__cta" href="/?report=free">무료로 시작하기</a>
          </nav>
        </details>
      </div>
    </header>`;

  const root = document.querySelector("[data-q-shell-root]");
  const disclosures = [...root.querySelectorAll("details")];
  const mobileDisclosure = root.querySelector(".q-shell__mobile");

  root.querySelectorAll("a[href]").forEach((link) => {
    const target = new URL(link.href, window.location.href);
    if (target.origin === window.location.origin && target.pathname === currentPath && !target.hash) {
      link.setAttribute("aria-current", "page");
    }
  });

  function syncThemeButtons() {
    const dark = document.documentElement.dataset.theme === "dark";
    root.querySelectorAll("[data-q-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", dark ? "라이트 테마로 변경" : "다크 테마로 변경");
      button.title = dark ? "라이트 테마로 변경" : "다크 테마로 변경";
    });
  }

  syncThemeButtons();

  root.addEventListener("toggle", (event) => {
    if (!(event.target instanceof HTMLDetailsElement) || !event.target.open) return;
    disclosures.forEach((item) => {
      if (item !== event.target) item.open = false;
    });
    if (event.target === mobileDisclosure) document.body.classList.add("q-shell-menu-open");
  }, true);

  mobileDisclosure?.addEventListener("toggle", () => {
    document.body.classList.toggle("q-shell-menu-open", mobileDisclosure.open);
  });

  document.addEventListener("pointerdown", (event) => {
    if (root.contains(event.target)) return;
    disclosures.forEach((item) => { item.open = false; });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openItem = disclosures.find((item) => item.open);
    disclosures.forEach((item) => { item.open = false; });
    openItem?.querySelector(":scope > summary")?.focus();
  });

  root.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (mobileDisclosure) mobileDisclosure.open = false;
    });
  });

  root.querySelectorAll("[data-q-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const html = document.documentElement;
      const next = html.dataset.theme === "dark" ? "light" : "dark";
      html.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (_) {}
      syncThemeButtons();
    });
  });
})();
