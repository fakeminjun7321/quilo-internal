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
    const radio = document.querySelector(`input[name="reportType"][value="${CSS.escape(String(type || ""))}"]`);
    if (!radio || radio.disabled || radio.closest("label")?.hidden) return false;
    radio.checked = true;
    state.set({ reportType: radio.value });
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
