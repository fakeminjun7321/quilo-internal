"use strict";

const state = { catalog: null, loggedIn: false };
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("createTokenBtn").addEventListener("click", createToken);
  $("copyTokenBtn").addEventListener("click", copyToken);
  $("catalogSearch").addEventListener("input", renderCatalog);
  void Promise.all([loadStatus(), loadCatalog(), loadAccount()]);
});

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function loadStatus() {
  try {
    const data = await api("/api/version");
    $("serviceDot").classList.add("ok");
    $("serviceStatus").textContent = `Quilo ${data.version || ""} · 운영 서버 정상`;
  } catch (error) {
    $("serviceStatus").textContent = `서버 확인 실패 · ${error.message}`;
  }
}

async function loadAccount() {
  try {
    const data = await api("/api/me");
    state.loggedIn = true;
    $("accountDot").classList.add("ok");
    $("accountStatus").textContent = `${data.name || data.user || "사용자"} 계정으로 로그인됨`;
    $("loginLink").textContent = "Quilo로 돌아가기";
    $("loginLink").href = "/";
    await loadTokens();
  } catch (_) {
    state.loggedIn = false;
    $("accountStatus").textContent = "토큰을 만들려면 Quilo 로그인이 필요합니다.";
    $("createTokenBtn").disabled = true;
    $("tokenMessage").textContent = "로그인 후 이 페이지로 돌아오세요.";
  }
}

async function loadCatalog() {
  try {
    state.catalog = await api("/api/catalog");
    const modes = state.catalog.features.reduce((counts, item) => {
      counts[item.execution] = (counts[item.execution] || 0) + 1;
      return counts;
    }, {});
    $("catalogSummary").textContent = `${state.catalog.total}개 기능 · API ${modes.remote || 0} · 로컬 ${modes.local || 0} · 읽기 ${modes["read-only"] || 0} · 웹 연결 ${modes.handoff || 0} · 중단 ${modes.paused || 0}`;
    renderCatalog();
  } catch (error) {
    $("catalogSummary").textContent = `카탈로그를 불러오지 못했습니다: ${error.message}`;
  }
}

function renderCatalog() {
  if (!state.catalog) return;
  const q = $("catalogSearch").value.trim().toLowerCase();
  const items = state.catalog.features.filter((item) => !q || [item.title, item.summary, item.id, item.category].join(" ").toLowerCase().includes(q));
  const html = Object.entries(state.catalog.categories).map(([id, category]) => {
    const features = items.filter((item) => item.category === id);
    if (!features.length) return "";
    return `<section class="category"><h3>${escapeHtml(category.title)}</h3><p class="dev-muted">${escapeHtml(category.description)}</p><div class="feature-grid">${features.map(featureCard).join("")}</div></section>`;
  }).join("");
  $("catalogBody").innerHTML = html || '<p class="dev-muted">검색 결과가 없습니다.</p>';
}

function featureCard(item) {
  const label = { active: "운영 중", pro: "Pro", max: "Max", beta: "Beta", paused: "중단" }[item.status] || item.status;
  const execution = { remote: "API 실행", local: "로컬 실행", "read-only": "읽기", handoff: "웹 연결", paused: "중단" }[item.execution] || item.execution;
  return `<a class="feature" href="${escapeAttr(item.path)}"><span class="feature-top"><strong>${escapeHtml(item.title)}</strong><span class="badge ${escapeAttr(item.status)}">${escapeHtml(label)}</span></span><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(execution)} · ${escapeHtml(item.audience)} · ${escapeHtml(item.kind)}</small></a>`;
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
      body: JSON.stringify({ name: $("tokenName").value, expiresInDays: Number($("tokenDays").value), scopes }),
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

function renderTokens(tokens) {
  if (!tokens.length) {
    $("tokenList").innerHTML = '<p class="dev-muted">아직 발급한 토큰이 없습니다.</p>';
    return;
  }
  $("tokenList").innerHTML = tokens.map((token) => `<div class="token-row"><div><b>${escapeHtml(token.name)}</b> <small>quilo_${escapeHtml(token.prefix)}_…</small><br /><small>${escapeHtml((token.scopes || []).join(" · "))} · ${formatDate(token.expiresAt)} 만료${token.revokedAt ? " · 폐기됨" : ""}</small></div>${token.revokedAt ? "" : `<button type="button" data-revoke="${escapeAttr(token.id)}">폐기</button>`}</div>`).join("");
  document.querySelectorAll("[data-revoke]").forEach((button) => button.addEventListener("click", () => revokeToken(button.dataset.revoke)));
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
