const PENDING_REPORT_KEY = "pendingReportType";

export function createRouter({ state, hooks }) {
  function writeReportUrl(type, mode = "push") {
    const reportType = String(type || "");
    if (!reportType) return;
    state.set({ reportType });
    const target = new URL("/", location.origin);
    target.searchParams.set("report", reportType);
    const next = `${target.pathname}${target.search}`;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current === next || mode === false || mode === "none") return;
    try {
      history[mode === "replace" ? "replaceState" : "pushState"]({}, "", next);
    } catch (_) {}
  }

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
    writeReportUrl(radio.value, options.history ?? "push");
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

  return { setPending, takePending, consumePending, requestedReport, select, writeReportUrl };
}
