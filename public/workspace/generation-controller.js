export function createGenerationController(deps) {
  async function submitReport({ formEl, buttonEl, formData, busyText = "생성 중...", estimate = null }) {
    deps.lockForm(formEl);
    if (buttonEl) buttonEl.textContent = busyText;
    try {
      if (formData) {
        try {
          if (localStorage.getItem("quilo.googleDrive.autoSaveReports") === "1") {
            formData.set("saveToGoogleDrive", "true");
            const folderId = localStorage.getItem("quilo.googleDrive.folderId") || "";
            if (folderId) formData.set("googleDriveFolderId", folderId);
            else formData.delete("googleDriveFolderId");
          } else {
            formData.delete("saveToGoogleDrive");
            formData.delete("googleDriveFolderId");
          }
        } catch (_) {}
      }
      const background = deps.backgroundChoice();
      if (formData && !formData.has("backgroundMode") && background.enabled) {
        formData.set("backgroundMode", "true");
        if (background.notifyEmail) formData.set("notifyEmail", "true");
      }
    } catch (_) {}
    deps.capturePreferences(formData);
    deps.rememberSubmission({ formEl, buttonEl, formData, busyText, estimate });
    deps.clearRetryCard();
    deps.beginProgress("생성 중...", estimate);
    try {
      const response = await fetch("/api/generate", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `요청 실패 (HTTP ${response.status})`);
        error.httpStatus = response.status;
        error.suspended = !!data.suspended;
        error.suspendReason = data.reason || "";
        throw error;
      }
      const background = formData.get("backgroundMode") === "true";
      deps.setCurrentJob(data.jobId, background);
      deps.streamJob(data.jobId);
      if (background) deps.showBackgroundToast();
    } catch (error) {
      if (error?.suspended) {
        deps.stopTimer();
        deps.resetForm();
        deps.showSuspendedAppeal(error.suspendReason || "", error.message || "");
        return;
      }
      const status = error?.httpStatus || 0;
      const inputError = status === 400;
      const creditError = status === 402 || /크레딧|credit|잔액|충전/i.test(error?.message || "");
      deps.showError({
        message: error?.message,
        detail: error?.message,
        phase: "submit",
        httpStatus: status,
        allowRetry: !inputError && !creditError,
        scrollToForm: inputError ? formEl : null,
      });
      deps.stopTimer();
      deps.resetForm();
    }
  }

  return { submitReport };
}
