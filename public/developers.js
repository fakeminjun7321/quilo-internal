"use strict";

const state = { catalog: null, loggedIn: false, isAdmin: false, sessionState: "pending" };
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("createTokenBtn").addEventListener("click", createToken);
  $("copyTokenBtn").addEventListener("click", copyToken);
  $("catalogSearch").addEventListener("input", renderCatalog);
  $("refreshLogsBtn").addEventListener("click", loadApiRequests);
  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", () => copyElementText(button));
  });
  observeDocumentSections();
  void Promise.all([loadStatus(), loadCatalog(), loadAccount()]);
});

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadStatus() {
  try {
    const data = await api("/api/version");
    const displayedVersion = data.releaseVersion || data.version || "";
    $("serviceDot").classList.add("ok");
    $("serviceStatus").textContent = `Quilo ${displayedVersion} 운영 서버 정상`;
  } catch (error) {
    $("serviceStatus").textContent = `서버 확인 실패 · ${error.message}`;
  }
}

async function loadAccount() {
  let session;
  try {
    session = window.QuiloShellAuth?.ready
      ? await window.QuiloShellAuth.ready
      : { state: "authenticated", user: await api("/api/me"), status: 200 };
  } catch (error) {
    session = error?.status === 401
      ? { state: "anonymous", user: null, status: 401 }
      : { state: "unknown", user: null, status: error?.status || 0 };
  }

  state.sessionState = session.state;
  document.body.dataset.sessionState = session.state;

  if (session.state === "authenticated") {
    const data = session.user || {};
    state.loggedIn = true;
    state.isAdmin = data.isAdmin === true;
    $("accountStatus").textContent = `${data.name || data.user || data.username || "사용자"} 계정으로 로그인됨`;
    $("loginLink").textContent = "Quilo로 돌아가기";
    $("loginLink").href = "/";
    $("createTokenBtn").disabled = false;
    await loadTokens();
    await loadApiRequests();
    updateCatalogSummary();
    renderCatalog();
    return;
  }

  state.loggedIn = false;
  state.isAdmin = false;
  $("createTokenBtn").disabled = true;
  if (session.state === "anonymous") {
    $("accountStatus").textContent = "토큰을 만들려면 Quilo 로그인이 필요합니다.";
    $("loginLink").textContent = "Quilo 로그인";
    $("loginLink").href = "/login.html?next=%2Fdevelopers.html";
    $("tokenMessage").textContent = "로그인 후 이 페이지로 돌아오세요.";
    return;
  }

  // A network/server error does not mean the session was cleared. Keep the
  // controls read-only and give the user a neutral way back to Quilo.
  $("accountStatus").textContent = "로그인 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.";
  $("loginLink").textContent = "Quilo로 돌아가기";
  $("loginLink").href = "/";
  $("tokenMessage").textContent = "계정 상태 확인이 복구되면 토큰을 관리할 수 있습니다.";
}

async function loadCatalog() {
  try {
    state.catalog = await api("/api/catalog");
    updateCatalogSummary();
    renderCatalog();
  } catch (error) {
    $("catalogSummary").textContent = `카탈로그를 불러오지 못했습니다: ${error.message}`;
  }
}

function catalogFeatures() {
  if (!state.catalog?.features) return [];
  return state.catalog.features.filter((item) => item.audience !== "admin" || state.isAdmin);
}

function updateCatalogSummary() {
  if (!state.catalog) return;
  const visibleFeatures = catalogFeatures();
  const modes = visibleFeatures.reduce((counts, item) => {
    counts[item.execution] = (counts[item.execution] || 0) + 1;
    return counts;
  }, {});
  $("catalogSummary").textContent = `${visibleFeatures.length}개 기능 · API ${modes.remote || 0} · 로컬 ${modes.local || 0} · 읽기 ${modes["read-only"] || 0} · 웹 연결 ${modes.handoff || 0} · 중단 ${modes.paused || 0}`;
}

function renderCatalog() {
  if (!state.catalog) return;
  const q = $("catalogSearch").value.trim().toLowerCase();
  const items = catalogFeatures().filter((item) => !q || [item.title, item.summary, item.id, item.category].join(" ").toLowerCase().includes(q));
  const html = Object.entries(state.catalog.categories).map(([id, category]) => {
    const features = items.filter((item) => item.category === id);
    if (!features.length) return "";
    return `<section class="category"><div class="category-head"><h3>${escapeHtml(category.title)}</h3><p>${escapeHtml(category.description)}</p></div><div class="feature-list">${features.map(featureRow).join("")}</div></section>`;
  }).join("");
  $("catalogBody").innerHTML = html || '<p>검색 결과가 없습니다.</p>';
}

function featureRow(item) {
  const label = { active: "운영 중", pro: "Pro", max: "Max", beta: "Beta", paused: "중단" }[item.status] || item.status;
  const execution = { remote: "API 실행", local: "로컬 실행", "read-only": "읽기", handoff: "웹 연결", paused: "중단" }[item.execution] || item.execution;
  return `<a class="feature" href="${escapeAttr(item.path)}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p><span class="feature-meta">${escapeHtml(execution)} · ${escapeHtml(item.audience)} · ${escapeHtml(item.kind)}</span><span class="badge ${escapeAttr(item.status)}">${escapeHtml(label)}</span><svg class="dev-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></a>`;
}

async function loadTokens() {
  try {
    const data = await api("/api/integrations/tokens");
    renderTokens(data.tokens || []);
  } catch (error) {
    $("tokenMessage").textContent = error.message;
  }
}

async function createToken() {
  if (!state.loggedIn) return;
  const scopes = [...document.querySelectorAll("#scopeGrid input:checked")].map((input) => input.value);
  $("createTokenBtn").disabled = true;
  $("tokenMessage").textContent = "토큰 생성 중…";
  try {
    const data = await api("/api/integrations/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: $("tokenName").value, expiresInDays: Number($("tokenDays").value), mode: $("tokenMode").value, scopes }),
    });
    $("tokenSecret").hidden = false;
    $("tokenValue").textContent = data.token;
    $("tokenMessage").textContent = "토큰을 만들었습니다. 이 페이지를 떠나기 전에 복사하세요.";
    await loadTokens();
  } catch (error) {
    $("tokenMessage").textContent = error.message;
  } finally {
    $("createTokenBtn").disabled = false;
  }
}

async function copyToken() {
  const value = $("tokenValue").textContent;
  if (!value) return;
  await navigator.clipboard.writeText(value);
  $("copyTokenBtn").textContent = "복사됨";
  setTimeout(() => { $("copyTokenBtn").textContent = "복사"; }, 1200);
}

async function copyElementText(button) {
  const target = $(button.dataset.copyTarget);
  if (!target) return;
  const value = target.textContent.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = "복사됨";
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch (_) {
    button.textContent = "복사 실패";
    setTimeout(() => { button.textContent = "복사"; }, 1200);
  }
}

function observeDocumentSections() {
  const links = [...document.querySelectorAll(".dev-sidebar a[href^='#']")];
  if (!("IntersectionObserver" in window) || !links.length) return;
  const byId = new Map(links.map((link) => [link.hash.slice(1), link]));
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle("is-active", link === byId.get(visible.target.id)));
  }, { rootMargin: "-18% 0px -68% 0px", threshold: 0 });
  byId.forEach((_, id) => {
    const section = $(id);
    if (section) observer.observe(section);
  });
}

function renderTokens(tokens) {
  if (!tokens.length) {
    $("tokenList").innerHTML = '<p class="dev-muted">아직 발급한 토큰이 없습니다.</p>';
    return;
  }
  $("tokenList").innerHTML = tokens.map((token) => `<div class="token-row"><div><b>${escapeHtml(token.name)}</b> <span class="badge ${token.mode === "test" ? "beta" : "active"}">${token.mode === "test" ? "TEST" : "LIVE"}</span> <small>quilo_${escapeHtml(token.mode || "live")}_${escapeHtml(token.prefix)}_…</small><br /><small>${escapeHtml((token.scopes || []).join(" · "))} · ${formatDate(token.expiresAt)} 만료${token.revokedAt ? " · 폐기됨" : ""}</small></div>${token.revokedAt ? "" : `<button type="button" data-revoke="${escapeAttr(token.id)}">폐기</button>`}</div>`).join("");
  document.querySelectorAll("[data-revoke]").forEach((button) => button.addEventListener("click", () => revokeToken(button.dataset.revoke)));
}

async function loadApiRequests() {
  if (!state.loggedIn) return;
  try {
    const data = await api("/api/integrations/api-requests?limit=50");
    const rows = data.requests || [];
    $("apiLogBody").innerHTML = rows.length ? rows.map((item) => {
      const ok = Number(item.status) < 400;
      return `<tr><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td><b>${escapeHtml(item.method)}</b> <code>${escapeHtml(item.path)}</code><br /><small>${escapeHtml(item.scope)}</small></td><td class="${ok ? "status-ok" : "status-error"}">${escapeHtml(item.status)}</td><td>${escapeHtml(item.durationMs)} ms</td><td>${escapeHtml(item.errorCode || "-")}</td><td><code>${escapeHtml(item.requestId)}</code></td></tr>`;
    }).join("") : '<tr><td colspan="6" class="dev-muted">아직 기록된 API 요청이 없습니다.</td></tr>';
  } catch (error) {
    $("apiLogBody").innerHTML = `<tr><td colspan="6" class="status-error">${escapeHtml(error.message)}</td></tr>`;
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

async function revokeToken(id) {
  if (!confirm("이 토큰을 즉시 폐기할까요?")) return;
  try {
    await api(`/api/integrations/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadTokens();
  } catch (error) {
    $("tokenMessage").textContent = error.message;
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
