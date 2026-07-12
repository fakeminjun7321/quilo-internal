import { byId } from "./dom-contract.js";
import { loadEntitlementsSnapshot } from "./entitlements.js";

const TAB_TITLES = Object.freeze({
  files: "내 파일",
  integrations: "외부 서비스 연결",
  settings: "개인 설정",
  feedback: "건의사항",
  reports: "보고서 만들기",
});

export function createShellController({ state, router, hooks }) {
  const filesController = () => hooks.filesController;
  const accountController = () => hooks.accountController;

  function setView(view) {
    const authenticated = state.get().auth === "in";
    const next = view === "workspace" && authenticated ? "workspace" : "landing";
    state.set({ view: next });
    document.body.dataset.view = next;
    byId("landingSurface").hidden = next !== "landing";
    byId("workspaceSurface").hidden = next !== "workspace";
    document.querySelectorAll("[data-workspace-only]").forEach((node) => {
      node.hidden = next !== "workspace";
    });
    const summary = byId("workspaceSummary");
    if (summary) summary.hidden = !(authenticated && next === "workspace");
  }

  function showTab(tabName) {
    if (state.get().auth === "in") setView("workspace");
    const title = byId("workspaceTitle");
    if (title) title.textContent = TAB_TITLES[tabName] || "Quilo 작업 공간";
    document.querySelectorAll(".page-tabs [data-tab]").forEach((button) => {
      const active = button.dataset.tab === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      const active = panel.dataset.tabPanel === tabName;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
    if (tabName === "files") filesController()?.loadFiles();
    if (tabName === "integrations") filesController()?.loadCloudStatus();
    if (tabName === "settings") {
      hooks.ensureAccountExtensions?.();
      accountController()?.loadUsage();
    }
  }

  function closeDropdowns() {
    window.QuiloSiteShell?.closeDropdowns?.();
  }

  function openLogin() {
    return window.QuiloSiteShell?.openLogin?.() === true;
  }

  function reveal(id) {
    const node = byId(id);
    if (node) node.hidden = false;
  }

  function refreshDropdownVisibility() {
    // The global navigation is deliberately identical for every account tier.
    // Entitlement gates remain on the destination screens instead of hiding links.
  }

  async function loadEntitlements() {
    loadEntitlementsSnapshot()
      .then(({ subscription, beta }) => {
        if (subscription?.active) reveal("navBetaTranslate");
        const tier = subscription?.admin || beta?.admin
          ? "Admin"
          : subscription?.active || beta?.tier === "max"
            ? "Max"
            : beta?.tier === "pro"
              ? "Pro"
              : "Free";
        if (byId("accountTriggerMeta")) byId("accountTriggerMeta").textContent = tier;
        if (byId("accountMenuMeta")) byId("accountMenuMeta").textContent = `${tier} plan`;
        const features = Array.isArray(beta?.features) ? beta.features : [];
        const has = (name) => beta?.admin === true || features.includes(name);
        if (has("code-editor")) reveal("navBetaEditor");
        if (has("create")) reveal("navBetaCreate");
        if (has("vibe-coding")) reveal("navBetaVibe");
        if (has("physics-studio")) reveal("navBetaPhysStudio");
        if (has("file-chat") || has("create")) reveal("navBetaFilechat");
        if (has("problem-set")) reveal("navBetaProblemSet");
        if (has("form-maker")) { reveal("navBetaFormMaker"); reveal("rtFormMaker"); }
        if (["coding-test", "phys-inquiry", "math-inquiry", "reading-log"].some(has)) reveal("navExamPrep");
        const requested = router.requestedReport();
        const gated = {
          "phys-inquiry": ["phys-inquiry", "rtPhysInquiry"],
          "math-inquiry": ["math-inquiry", "rtMathInquiry"],
          "problem-set": ["problem-set", "rtProblemSet"],
          "form-maker": ["form-maker", "rtFormMaker"],
          "reading-log": ["reading-log", "rtReadingLog"],
        }[requested];
        if (gated && has(gated[0])) reveal(gated[1]);
        refreshDropdownVisibility();
      })
      .catch(refreshDropdownVisibility);
  }

  function init() {
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      if (action.dataset.action === "open-quilo-assist") {
        const target = action.dataset.target || "";
        if (action.dataset.assistKind === "style") window.Quilo?.openStyle?.(target);
        else window.Quilo?.openMemo?.(target);
      }
      if (action.dataset.action === "copy-memo-guide") {
        const textarea = action.previousElementSibling;
        if (!textarea || textarea.tagName !== "TEXTAREA") return;
        const original = action.textContent;
        const copy = navigator.clipboard?.writeText
          ? navigator.clipboard.writeText(textarea.value)
          : Promise.reject(new Error("clipboard unavailable"));
        copy.catch(() => {
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
        }).finally(() => {
          action.textContent = "복사됨";
          setTimeout(() => { action.textContent = original; }, 1200);
        });
      }
    });
    document.querySelectorAll("[data-ui-shell] a[data-report]").forEach((anchor) => {
      anchor.addEventListener("click", async (event) => {
        event.preventDefault();
        closeDropdowns();
        if (state.get().auth !== "in") {
          router.setPending(anchor.dataset.report);
          openLogin();
          return;
        }
        anchor.setAttribute("aria-busy", "true");
        await hooks.ensureReportRuntime?.();
        anchor.removeAttribute("aria-busy");
        showTab("reports");
        router.select(anchor.dataset.report, { scroll: true });
      });
    });
    document.querySelectorAll("[data-ui-shell] a[data-tab], .page-tabs [data-tab]").forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        showTab(anchor.dataset.tab);
        closeDropdowns();
      });
    });
    byId("workspaceFilesBtn")?.addEventListener("click", () => showTab("files"));
    byId("workspaceHomeBtn")?.addEventListener("click", () => {
      setView("landing");
      try { history.replaceState({}, "", location.pathname); } catch (_) {}
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  return { init, setView, showTab, openLogin, closeDropdowns, loadEntitlements };
}
