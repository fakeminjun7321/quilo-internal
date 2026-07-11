const STEP_ORDER = ["upload", "analysis", "document", "ready"];

export function createProgressView({ onClearRetry } = {}) {
  const progressArea = document.getElementById("progressArea");
  const progress = document.getElementById("progress");
  const result = document.getElementById("resultArea");
  const title = document.getElementById("statusTitle");
  let timer = null;
  let startedAt = 0;
  let estimate = null;
  let lastProgressAt = 0;

  function formatClock(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  }

  function etaPhrase(value) {
    if (!value) return "";
    const format = (seconds) => seconds < 90 ? `${Math.round(seconds)}초` : `${Math.round(seconds / 60)}분`;
    if (Math.abs((value.hi || 0) - (value.lo || 0)) < 8) return `예상 ${format(value.hi || value.lo)}`;
    return `예상 ${format(value.lo)}~${format(value.hi)}`;
  }

  function renderTimer() {
    const node = document.getElementById("genTimer");
    if (!node) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    const eta = etaPhrase(estimate);
    const high = estimate?.hi || 0;
    const stalled = (Date.now() - (lastProgressAt || startedAt)) / 1000;
    const tail = high && elapsed > high + 8 ? " · 거의 다 됐어요" : stalled > 18 ? " · 계속 처리 중…" : "";
    node.textContent = `${eta ? `${eta} · ` : ""}경과 ${formatClock(elapsed)}${tail}`;
  }

  function startTimer(value) {
    stopTimer();
    startedAt = Date.now();
    lastProgressAt = startedAt;
    estimate = value && (value.lo != null || value.hi != null) ? value : null;
    const node = document.getElementById("genTimer");
    if (node) node.hidden = false;
    renderTimer();
    timer = setInterval(renderTimer, 1000);
  }

  function stopTimer(options = {}) {
    if (timer) clearInterval(timer);
    timer = null;
    const node = document.getElementById("genTimer");
    if (node && options.hide !== false) node.hidden = true;
  }

  function noteProgress() { lastProgressAt = Date.now(); }

  function resetSteps() {
    document.querySelectorAll("[data-progress-step]").forEach((node) => node.classList.remove("is-active", "is-done", "is-error"));
  }

  function setStep(step, state = "active") {
    const index = STEP_ORDER.indexOf(step);
    if (index < 0) return;
    document.querySelectorAll("[data-progress-step]").forEach((node) => {
      const current = STEP_ORDER.indexOf(node.dataset.progressStep);
      node.classList.toggle("is-done", state !== "error" && current >= 0 && current < index);
      node.classList.toggle("is-active", state !== "error" && current === index);
      node.classList.toggle("is-error", state === "error" && current === index);
    });
  }

  function inferStep(text) {
    const value = String(text || "");
    if (/오류|실패|중단|취소/.test(value)) return { step: "document", state: "error" };
    if (/완료|다운로드|저장|파일 준비/.test(value)) return { step: "ready", state: "active" };
    if (/문서|DOCX|HWPX|차트|그래프|렌더|생성/.test(value)) return { step: "document", state: "active" };
    if (/AI|분석|모델|응답|작성|파싱|보정/.test(value)) return { step: "analysis", state: "active" };
    if (/업로드|파일|입력|확인|검증/.test(value)) return { step: "upload", state: "active" };
    return null;
  }

  function begin(nextTitle, nextEstimate) {
    progressArea.hidden = false;
    progressArea.classList.remove("is-source-hidden");
    progress.replaceChildren();
    result.replaceChildren();
    onClearRetry?.();
    title.textContent = nextTitle || "생성 중...";
    const latest = document.getElementById("progressLatest");
    if (latest) latest.textContent = "생성을 시작합니다…";
    resetSteps();
    setStep("upload");
    startTimer(nextEstimate);
    progressArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function append(text) {
    const line = typeof text === "string" ? text : JSON.stringify(text);
    progress.append(document.createTextNode(`${line}\n`));
    progress.scrollTop = progress.scrollHeight;
    const latest = document.getElementById("progressLatest");
    if (latest && line.trim()) latest.textContent = line.trim();
    if (line.trim()) noteProgress();
    const next = inferStep(line);
    if (next) setStep(next.step, next.state);
  }

  return {
    begin,
    append,
    resetSteps,
    setStep,
    inferStep,
    startTimer,
    stopTimer,
    noteProgress,
  };
}

