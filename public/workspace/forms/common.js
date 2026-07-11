export const $ = (id) => document.getElementById(id);
export const value = (id) => ($(id)?.value || "").trim();
export const file = (id) => $(id)?.files?.[0] || null;
export const files = (id) => Array.from($(id)?.files || []);
export const selected = (name, fallback = "") =>
  document.querySelector(`input[name="${name}"]:checked`)?.value ||
  document.querySelector(`input[name="${name}"]`)?.value || fallback;

export function appendFiles(formData, field, inputFiles) {
  inputFiles.forEach((entry) => formData.append(field, entry));
}

export function appendSlashDate(formData, field, rawDate) {
  if (!rawDate) return;
  const [year, month, day] = rawDate.split("-");
  formData.append(field, `${year}/ ${month} / ${day}`);
}

export function appendPolicy(formData) {
  formData.append("copyrightAccepted", "true");
  formData.append("academicIntegrityAccepted", "true");
  formData.append("policyAcceptedAt", new Date().toISOString());
}

export function sumBytes(entries) {
  return entries.reduce((sum, entry) => sum + (entry?.size || 0), 0);
}

const REPORT_UI_REGISTRY = Object.freeze({
  "chem-pre": { upload: ["manual"], info: ["date"], settings: ["cpStyleRefs", "cpAllowImageGen", "fontFace"] },
  "chem-result": { upload: ["crPreReport"], info: ["crDate"], settings: ["crStyleRefs", "crFontFace"] },
  "phys-result": { upload: ["prCap"], info: ["prDate"], settings: ["prStyleRefs", "prFontFace"] },
  free: { upload: ["frInstructions"], info: ["frDate"], settings: ["frStyleRefs", "frFontFace"] },
});

export function createCommonFormsController({
  getModelLabel,
  formatBytes,
  setView,
  showTab,
  setPending,
  openLogin,
  reportChecklistItems,
}) {
  const radios = document.querySelectorAll('input[name="reportType"]');
  const forms = document.querySelectorAll("[data-report-form]");
  const comingSoon = $("comingSoon");
  const checklist = $("reportChecklist");
  const checklistTitle = $("workspaceChecklistTitle");

  function updateReportChecklist(type) {
    if (!checklist || !checklistTitle) return;
    const config = reportChecklistItems[type];
    checklistTitle.textContent = config ? config.title : "보고서 종류를 선택하세요";
    checklist.replaceChildren();
    (config ? config.items : ["위에서 만들 보고서 종류를 먼저 고르세요."]).forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      checklist.append(item);
    });
  }

  function setFlowStep(form, step = "upload", options = {}) {
    if (!form) return;
    form.dataset.flowStep = step;
    form.querySelectorAll(":scope > .form-flow-steps [data-flow-jump]").forEach((button) => {
      const active = button.dataset.flowJump === step;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const optional = form.querySelector(":scope > .optional-settings");
    if (optional) optional.open = step === "settings";
    if (options.scroll) {
      const target = step === "settings" ? optional
        : step === "generate" ? form.querySelector(":scope > .form-actions")
          : form.querySelector(`:scope > [data-flow-target="${step}"]`);
      (target || form).scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function updateOptionalSummary(form) {
    const note = form?.querySelector(":scope > .optional-settings .optional-settings-summary-note");
    if (!note) return;
    const selectedRadios = Array.from(form.querySelectorAll(":scope > .optional-settings input[type=radio]:checked"));
    const format = selectedRadios.find((radio) => /format$/i.test(radio.name || ""));
    const model = selectedRadios.find((radio) => /model$/i.test(radio.name || ""));
    const parts = [];
    if (format) parts.push(format.value === "hwpx" ? ".hwpx" : `.${format.value}`);
    if (model) parts.push(getModelLabel(model.value));
    note.textContent = parts.length ? `· ${parts.join(" · ")}` : "";
  }

  function updateAllOptionalSummaries() {
    forms.forEach(updateOptionalSummary);
  }

  function enhanceForms() {
    forms.forEach((form) => {
      if (form.dataset.flowInit) return;
      form.dataset.flowInit = "1";
      form.classList.add("report-flow");
      const flow = document.createElement("div");
      flow.className = "form-flow-steps";
      [["upload", "자료"], ["info", "정보"], ["settings", "선택 설정"], ["generate", "생성"]].forEach(([target, label], index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.flowJump = target;
        button.textContent = `${index + 1}. ${label}`;
        button.addEventListener("click", () => setFlowStep(form, target, { scroll: true }));
        flow.append(button);
      });
      form.prepend(flow);
      const optional = document.createElement("details");
      optional.className = "optional-settings";
      const summary = document.createElement("summary");
      summary.innerHTML = '<span>선택 설정</span><span class="optional-settings-summary-note"></span>';
      const body = document.createElement("div");
      body.className = "optional-settings-body";
      optional.append(summary, body);
      const registry = REPORT_UI_REGISTRY[form.dataset.reportForm] || {};
      ["upload", "info", "settings"].forEach((step) => {
        (registry[step] || []).forEach((anchorId) => {
          const section = $(anchorId)?.closest(".form-section");
          if (!section || section.closest("form") !== form) return;
          section.dataset.flowTarget = step;
          section.dataset.step = step;
          if (step === "settings" && section.parentNode === form) body.append(section);
        });
      });
      if (body.childElementCount) {
        form.insertBefore(optional, form.querySelector(":scope > .policy-check") || form.querySelector(":scope > .form-actions"));
        updateOptionalSummary(form);
        optional.addEventListener("change", () => updateOptionalSummary(form));
      }
      form.addEventListener("invalid", (event) => {
        setFlowStep(form, event.target.closest(".form-section")?.dataset.flowTarget || "generate", { scroll: true });
      }, true);
      form.querySelectorAll('button[type="submit"]').forEach((button) => button.addEventListener("click", () => setFlowStep(form, "generate")));
      setFlowStep(form, "upload");
    });
  }

  function updateReportTypeView(options = {}) {
    const selected = document.querySelector('input[name="reportType"]:checked')?.value || "";
    $("reportsPanel")?.classList.toggle("workspace-mode", !!selected && document.body.dataset.auth !== "out");
    if (selected && document.body.dataset.auth === "in") setView("workspace");
    let matched = false;
    forms.forEach((form) => {
      const active = form.dataset.reportForm === selected;
      form.classList.toggle("active", active);
      form.hidden = !active;
      matched ||= active;
    });
    if (comingSoon) comingSoon.hidden = !selected || matched;
    updateReportChecklist(selected);
    const config = reportChecklistItems[selected];
    if ($("workspaceTitle")) $("workspaceTitle").textContent = config?.title || "보고서 작업 공간";
    if (!selected) return;
    if (options.scroll) (matched ? document.querySelector(`[data-report-form="${CSS.escape(selected)}"]`) : comingSoon)?.scrollIntoView({ behavior: "smooth", block: "start" });
    forms.forEach((form) => { if (form.dataset.reportForm === selected) setFlowStep(form, "upload"); });
    const dateId = selected === "chem-result" ? "crDate" : selected === "phys-result" ? "prDate" : "";
    if (dateId && !$(dateId).value) $(dateId).value = new Date().toISOString().slice(0, 10);
  }

  function initDropzones(maxFileMb = 64) {
    document.querySelectorAll(".dropzone").forEach((zone) => {
      const input = zone.querySelector('input[type="file"]');
      if (!input || zone.dataset.dzInit) return;
      zone.dataset.dzInit = "1";
      const label = zone.querySelector("[data-dz-file]");
      const render = () => {
        const selectedFiles = Array.from(input.files || []);
        zone.classList.toggle("is-filled", !!selectedFiles.length);
        if (label) label.textContent = selectedFiles.length === 1 ? selectedFiles[0].name : selectedFiles.length ? `${selectedFiles.length}개 파일 선택됨` : "";
        let warning = zone.nextElementSibling?.classList.contains("dropzone-warn") ? zone.nextElementSibling : null;
        const tooBig = selectedFiles.some((entry) => entry.size > maxFileMb * 1024 * 1024);
        if (tooBig && !warning) { warning = document.createElement("div"); warning.className = "dropzone-warn"; zone.after(warning); }
        if (warning) { warning.hidden = !tooBig; warning.textContent = tooBig ? `파일당 최대 ${maxFileMb}MB입니다. 선택 파일을 줄여 주세요. (${formatBytes(selectedFiles.reduce((sum, entry) => sum + entry.size, 0))})` : ""; }
      };
      input.addEventListener("change", render);
      ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, () => zone.classList.add("is-dragover")));
      ["dragleave", "dragend", "drop"].forEach((name) => zone.addEventListener(name, () => zone.classList.remove("is-dragover")));
      render();
    });
  }

  function slimMemoSections() {
    document.querySelectorAll(".field.user-notes-field").forEach((field) => {
      if (field.dataset.memoSlim) return;
      field.dataset.memoSlim = "1";
      const label = field.querySelector(".field-label");
      if (label) label.textContent = label.textContent.replace(/\(선택\)\s*$/, "(선택 · 안 써도 됩니다)");
    });
  }

  function init() {
    enhanceForms();
    updateReportChecklist("");
    radios.forEach((radio) => radio.addEventListener("change", () => {
      if (document.body.dataset.auth === "out") {
        setPending(radio.value); radio.checked = false; openLogin(); return;
      }
      updateReportTypeView({ scroll: true });
    }));
    updateReportTypeView();
    initDropzones();
    slimMemoSections();
  }

  return { init, setFlowStep, updateReportTypeView, updateReportChecklist, updateOptionalSummary, updateAllOptionalSummaries, initDropzones, slimMemoSections };
}
