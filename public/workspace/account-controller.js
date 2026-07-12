import { jsonOptions, requestJson } from "./api.js";
import { byId } from "./dom-contract.js";
import {
  getStoredStudentId,
  getStoredStyleNote,
  normalizeStudentId,
  storeStudentId,
  storeStyleNote,
} from "./state.js";
import { initDefaultReportPreferences } from "./report-preferences.js";

function setStatus(node, text, tone = "muted") {
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function applyStyleNote(note) {
  const value = note || getStoredStyleNote();
  if (value) storeStyleNote(value);
  ["settingsStyleNote", "cpStyleNote", "crStyleNote", "prStyleNote", "piStyleNote", "miStyleNote", "frStyleNote"].forEach((id) => {
    const field = byId(id);
    if (field && !field.value) field.value = value;
  });
}

export function createAccountController({ state, router, hooks }) {
  const balanceState = { known: false, credits: 0, unlimited: false, isAdmin: false };

  function setStudentId(value) {
    const studentId = normalizeStudentId(value);
    state.set({ studentId });
    if (byId("settingsStudentId")) byId("settingsStudentId").textContent = studentId || "미설정";
    if (byId("settingsStudentIdInput")) byId("settingsStudentIdInput").value = studentId;
    hooks.studentIdChanged?.(studentId);
  }

  function applyReportAccess(blocked) {
    const denied = new Set(Array.isArray(blocked) ? blocked : []);
    document.querySelectorAll('input[name="reportType"]').forEach((radio) => {
      const label = radio.closest("label");
      if (!label) return;
      label.hidden = denied.has(radio.value);
      if (label.hidden && radio.checked) radio.checked = false;
    });
  }

  function applyVerification(user) {
    const eligible = !user || user.isAdmin || !!user.reportEligible;
    state.set({ reportEligible: eligible });
    document.body.dataset.reportEligible = eligible ? "yes" : "no";
    const banner = byId("verifyBanner");
    if (!banner) return;
    banner.hidden = eligible;
    if (eligible) return;
    const domains = Array.isArray(user.allowedEmailDomains) && user.allowedEmailDomains.length
      ? user.allowedEmailDomains : ["ts.hs.kr"];
    if (byId("verifyEmailLabel")) byId("verifyEmailLabel").textContent = `학교 이메일 (@${domains[0]})`;
    if (byId("verifyEmailInput") && !byId("verifyEmailInput").value) byId("verifyEmailInput").placeholder = `ts250002@${domains[0]}`;
    const waitingApproval = !!user.emailVerified;
    if (byId("verifyTitle")) byId("verifyTitle").textContent = waitingApproval ? "2단계 · 관리자 승인 대기 중" : "1단계 · 학교 이메일 인증";
    if (byId("verifyEmailForm")) byId("verifyEmailForm").hidden = waitingApproval;
    if (byId("verifyMsg")) {
      byId("verifyMsg").textContent = waitingApproval
        ? "학교 이메일 인증이 완료되었습니다. 관리자 승인을 기다려 주세요."
        : user.pendingEmail
          ? `${user.pendingEmail}로 인증 메일을 보냈습니다. 메일의 인증 링크를 눌러 주세요.`
          : `학교 이메일(@${domains[0]})을 입력하면 인증 링크를 보내드립니다.`;
    }
  }

  async function loadBalance() {
    try {
      const data = await requestJson("/api/me/balance");
      Object.assign(balanceState, {
        known: true,
        credits: Math.max(0, Math.trunc(Number(data.credits) || 0)),
        unlimited: !!data.unlimited || !!data.isAdmin,
        isAdmin: !!data.isAdmin,
      });
      if (data.isAdmin) return;
      if (data.restrictedModel) {
        document.querySelectorAll('input[name="model"],input[name="crModel"],input[name="prModel"]').forEach((radio) => {
          const allowed = radio.value === data.restrictedModel;
          radio.closest("label")?.toggleAttribute("hidden", !allowed);
          radio.checked = allowed;
        });
      }
      const credits = balanceState.credits;
      const box = byId("balanceBox");
      if (byId("balCredits")) byId("balCredits").textContent = data.unlimited ? "무제한 (Pro)" : `${credits} 크레딧`;
      if (byId("balConvert")) byId("balConvert").textContent = data.unlimited
        ? ""
        : `기본(Opus)으로 약 ${Math.floor(credits / 4)}건 · 무료 모델은 무제한`;
      box?.classList.toggle("is-low", !data.unlimited && credits < 4);
      if (box) box.hidden = false;
      document.querySelector(".report-toolbar")?.classList.add("has-balance");
    } catch (_) {}
  }

  async function loadUsage() {
    const credits = byId("usageCredits");
    if (!credits) return;
    const card = byId("usageCard");
    const recent = byId("usageRecent");
    card?.setAttribute("aria-busy", "true");
    if (recent) {
      recent.dataset.state = "loading";
      const loading = document.createElement("p");
      loading.className = "account-state-copy";
      loading.textContent = "사용 내역을 불러오는 중입니다.";
      recent.replaceChildren(loading);
    }
    try {
      const data = await requestJson("/api/me/usage");
      const unlimited = data.isAdmin || data.unlimited;
      credits.textContent = unlimited ? "무제한" : `${data.credits ?? 0}`;
      const generated = Math.max(0, Number(data.genCount) || 0);
      const limit = Math.max(1, Number(data.genLimit) || 5);
      if (byId("usageGen")) byId("usageGen").textContent = unlimited ? `${generated}회` : `${generated} / ${limit}`;
      if (byId("usageGenLabel")) byId("usageGenLabel").textContent = unlimited ? "이번 시간 · 제한 없음" : "생성";
      const restriction = byId("usageRestriction");
      if (restriction) restriction.hidden = !data.restrictedModel;
      if (byId("usageRestrict")) byId("usageRestrict").textContent = data.restrictedModel || "-";
      const meter = byId("usageMeter");
      if (meter) {
        meter.hidden = unlimited;
        meter.max = limit;
        meter.value = Math.min(limit, generated);
      }
      if (!recent) return;
      const rows = Array.isArray(data.recent) ? data.recent : [];
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "account-state-copy";
        empty.textContent = "최근 생성 기록이 없습니다.";
        recent.dataset.state = "empty";
        recent.replaceChildren(empty);
        return;
      }
      const table = document.createElement("table");
      table.className = "account-usage-table";
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["날짜", "작업", "모델", "크레딧"].forEach((label) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        headRow.appendChild(cell);
      });
      head.appendChild(headRow);
      const body = document.createElement("tbody");
      rows.forEach((entry) => {
        const row = document.createElement("tr");
        const values = [
          entry.date ? new Date(entry.date).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-",
          entry.label || "생성",
          entry.model || "-",
          entry.credits == null ? "Pro·무료" : entry.credits ? `${entry.credits}크레딧` : "무료",
        ];
        values.forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
        body.append(row);
      });
      table.append(head, body);
      recent.dataset.state = "ready";
      recent.replaceChildren(table);
    } catch (_) {
      if (recent) {
        const error = document.createElement("p");
        error.className = "account-state-copy";
        error.dataset.tone = "danger";
        error.textContent = "사용 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        recent.dataset.state = "error";
        recent.replaceChildren(error);
      }
    } finally {
      card?.setAttribute("aria-busy", "false");
    }
  }

  function bindAccountNavigation() {
    const panel = byId("settingsPanel");
    if (!panel) return;
    const links = Array.from(panel.querySelectorAll("[data-account-nav]"));
    const sections = Array.from(panel.querySelectorAll("[data-account-section]"));
    const activate = (name) => links.forEach((link) => {
      const active = link.dataset.accountNav === name;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    links.forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = panel.querySelector(link.getAttribute("href"));
      if (!target) return;
      activate(link.dataset.accountNav);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.dataset.accountSection) activate(visible.target.dataset.accountSection);
    }, { rootMargin: "-20% 0px -65% 0px", threshold: [0, .1, .35] });
    sections.forEach((section) => observer.observe(section));
  }

  function applyAuth(loggedIn, user = null) {
    state.set({ auth: loggedIn ? "in" : "out", user });
    document.body.dataset.auth = loggedIn ? "in" : "out";
    if (byId("loginDd")) byId("loginDd").hidden = loggedIn;
    if (byId("acctDd")) byId("acctDd").hidden = !loggedIn;
    if (!loggedIn) {
      applyReportAccess([]);
      applyVerification(null);
      const requested = router.requestedReport();
      if (requested) { router.setPending(requested); hooks.shell?.openLogin(); }
      hooks.shell?.setView("landing");
      return;
    }
    if (byId("user")) byId("user").textContent = `${user.user} 님`;
    if (byId("accountMenuName")) byId("accountMenuName").textContent = user.user;
    if (byId("settingsUserName")) byId("settingsUserName").textContent = user.user;
    if (byId("settingsUserRole")) byId("settingsUserRole").textContent = user.isAdmin ? "관리자" : "일반 사용자";
    setStudentId(user.studentId || getStoredStudentId());
    applyStyleNote(user.styleNote);
    ["piWhoPreview", "miWhoPreview", "frWhoPreview"].forEach((id) => {
      const node = byId(id);
      if (node) node.textContent = state.get().studentId ? `${state.get().studentId} ${user.user}` : `${user.user} (학번 미설정)`;
    });
    if (byId("adminLink")) byId("adminLink").hidden = !user.isAdmin;
    hooks.shell?.loadEntitlements?.();
    if (user.isAdmin) {
      if (!user.fableDisabled) document.querySelectorAll("label.fable-model").forEach((node) => { node.hidden = false; });
      document.querySelectorAll("label.beta-model").forEach((node) => { node.hidden = false; });
    }
    applyReportAccess(user.isAdmin ? [] : user.blockedReportTypes);
    applyVerification(user);
    if (!user.isAdmin) loadBalance();
    hooks.filesController?.loadFiles();
    hooks.filesController?.loadCloudStatus();
    const selected = router.consumePending({ scroll: true });
    if (!selected) {
      const requested = router.requestedReport();
      if (!requested || !router.select(requested)) hooks.shell?.setView("landing");
    }
    if (hooks.requestedAccountTab) hooks.shell?.showTab(hooks.requestedAccountTab);
  }

  function bindForms() {
    byId("verifyEmailForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = byId("verifyEmailInput")?.value.trim();
      if (!email) return;
      const button = byId("verifyEmailBtn");
      const status = byId("verifyStatus");
      if (button) button.disabled = true;
      try {
        await requestJson("/api/verify-email/request", jsonOptions("POST", { email }));
        if (status) { status.hidden = false; setStatus(status, `${email}로 인증 메일을 보냈습니다.`, "success"); }
      } catch (error) {
        if (status) { status.hidden = false; setStatus(status, error.message, "danger"); }
      } finally { if (button) button.disabled = false; }
    });
    byId("loginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = byId("li_err");
      const button = byId("li_btn");
      const remember = byId("li_remember")?.checked !== false;
      const username = byId("li_username").value;
      if (error) error.hidden = true;
      button.disabled = true;
      button.textContent = "로그인 중...";
      try {
        const data = await requestJson("/api/login", jsonOptions("POST", { username, password: byId("li_password").value, remember }));
        try { remember ? localStorage.setItem("lastUsername", username) : localStorage.removeItem("lastUsername"); } catch (_) {}
        if (data.redirect && String(data.redirect).startsWith("/oauth/authorize?")) location.assign(data.redirect);
        else location.reload();
      } catch (exception) {
        if (error) { error.hidden = false; error.textContent = exception.message; }
        button.disabled = false;
        button.textContent = "로그인";
      }
    });
    byId("logout")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await fetch("/api/logout", { method: "POST" });
      location.href = "/";
    });
    byId("profileForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const studentId = normalizeStudentId(byId("settingsStudentIdInput").value);
      byId("profileBtn").disabled = true;
      setStatus(byId("profileStatus"), "저장 중...");
      try {
        const data = await requestJson("/api/me/profile", jsonOptions("PATCH", { studentId }));
        setStudentId(data.studentId || studentId);
        storeStudentId(data.studentId || studentId);
        setStatus(byId("profileStatus"), "저장 완료", "success");
      } catch (_) {
        setStudentId(studentId); storeStudentId(studentId);
        setStatus(byId("profileStatus"), "이 브라우저에 저장됨", "warning");
      } finally { byId("profileBtn").disabled = false; }
    });
    byId("styleSaveBtn")?.addEventListener("click", async () => {
      const note = byId("settingsStyleNote")?.value.trim() || "";
      storeStyleNote(note); applyStyleNote(note);
      try {
        await requestJson("/api/me/profile", jsonOptions("PATCH", { studentId: state.get().studentId, styleNote: note }));
        setStatus(byId("styleSaveStatus"), "저장 완료", "success");
      } catch (_) { setStatus(byId("styleSaveStatus"), "이 브라우저에 저장됨", "warning"); }
    });
    byId("pwForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const currentPassword = byId("currentPw").value;
      const newPassword = byId("newPw").value;
      if (newPassword !== byId("confirmPw").value) return setStatus(byId("pwStatus"), "새 비밀번호가 일치하지 않습니다.", "danger");
      try {
        await requestJson("/api/me/password", jsonOptions("POST", { currentPassword, newPassword }));
        setStatus(byId("pwStatus"), "변경 완료", "success");
        byId("pwForm").reset();
      } catch (error) { setStatus(byId("pwStatus"), error.message, "danger"); }
    });
    byId("feedbackForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        category: byId("feedbackCategory").value,
        title: byId("feedbackTitle").value.trim(),
        message: byId("feedbackMessage").value.trim(),
        contactEmail: byId("feedbackContactEmail").value.trim(),
        pageUrl: location.href,
      };
      try {
        await requestJson("/api/feedback", jsonOptions("POST", payload));
        setStatus(byId("feedbackStatus"), "접수 완료", "success");
        byId("feedbackForm").reset();
      } catch (error) { setStatus(byId("feedbackStatus"), error.message, "danger"); }
    });
  }

  async function init() {
    bindForms();
    bindAccountNavigation();
    initDefaultReportPreferences();
    try {
      const saved = localStorage.getItem("lastUsername");
      if (saved && byId("li_username") && !byId("li_username").value) byId("li_username").value = saved;
    } catch (_) {}
    try { applyAuth(true, await requestJson("/api/me")); }
    catch (_) {
      applyAuth(false);
      if (new URLSearchParams(location.search).get("login") === "1") hooks.shell?.openLogin();
    }
  }

  return { init, applyAuth, loadBalance, loadUsage, balanceState, setStudentId };
}
