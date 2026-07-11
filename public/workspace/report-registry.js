export const CORE_REPORTS = Object.freeze({
  "chem-pre": { title: "화학 사전보고서", formId: "form" },
  "chem-result": { title: "화학 결과보고서", formId: "chemResultForm" },
  "phys-result": { title: "물리 결과보고서", formId: "physResultForm" },
  free: { title: "자유 보고서", formId: "freeForm" },
  "reading-log": { title: "독서록", formId: "readingLogForm" },
});

export function reportExists(type) {
  return !!document.querySelector(`input[name="reportType"][value="${CSS.escape(String(type || ""))}"]`);
}

