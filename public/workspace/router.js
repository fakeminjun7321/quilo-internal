import { REPORT_ALIASES } from "./report-registry.js";

const PENDING_REPORT_KEY = "pendingReportType";

export function createRouter({ state, hooks }) {
  function setPending(type) {
    try {
      if (type) sessionStorage.setItem(PENDING_REPORT_KEY, String(type));
    } catch (_) {}
  }

  function takePending() {
    let type = "";
    try {
      type = sessionStorage.getItem(PENDING_REPORT_KEY) || "";
      if (type) sessionStorage.removeItem(PENDING_REPORT_KEY);
    } catch (_) {}
    return type;
  }

  function select(type, options = {}) {
    const key = String(type || "");
    const alias = Object.prototype.hasOwnProperty.call(REPORT_ALIASES, key) ? REPORT_ALIASES[key] : null;
    const radio = document.querySelector(`input[name="reportType"][value="${CSS.escape(alias ? alias.base : key)}"]`);
    if (!radio || radio.disabled || radio.closest("label")?.hidden) return false;
    radio.checked = true;
    state.set({ reportType: radio.value });
    if (alias?.mode) {
      const form = document.querySelector(`form[data-report-form="${CSS.escape(radio.value)}"]`);
      const modeRadio = (form || document).querySelector(
        `input[name="${CSS.escape(alias.mode.name)}"][value="${CSS.escape(alias.mode.value)}"]`,
      );
      if (modeRadio && !modeRadio.disabled) {
        modeRadio.checked = true;
        // 폼 런타임 설치 전엔 설치 시점 초기화(rlSetMode)가 checked 상태를 읽고,
        // 설치 후엔 change 리스너가 즉시 반응한다. 모드 라디오가 없으면 base 단일 모드로 연다.
        modeRadio.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    if (hooks.selectReport) hooks.selectReport(radio.value, options);
    else hooks.ensureReportRuntime?.().then(() => hooks.selectReport?.(radio.value, options));
    return true;
  }

  function consumePending(options = {}) {
    if (state.get().auth !== "in") return false;
    const type = takePending();
    return type ? select(type, options) : false;
  }

  function requestedReport() {
    try { return new URLSearchParams(location.search).get("report") || ""; }
    catch (_) { return ""; }
  }

  return { setPending, takePending, consumePending, requestedReport, select };
}
