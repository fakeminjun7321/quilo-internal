/* BYOK and plan status account extensions. */
// ── BYOK: 개인 설정 · 내 API 키 ──────────────────────────────────────────────
// 본인 Anthropic/OpenAI 키 등록 → 해당 제공자의 AI 생성이 크레딧 차감 없이 본인 키로 실행.
(function initByok() {
  const $id = (id) => document.getElementById(id);
  const status = $id("byokStatus");
  const msg = $id("byokMsg");
  if (!status) return;
  function note(t, ok) {
    if (msg) {
      msg.textContent = t;
      msg.dataset.tone = ok ? "success" : "danger";
    }
  }
  async function refresh() {
    try {
      const r = await fetch("/api/me/api-keys");
      if (r.status === 401) {
        status.textContent = "로그인 후 등록할 수 있습니다.";
        return;
      }
      const d = await r.json();
      const keys = Array.isArray(d.keys) ? d.keys : [];
      const a = keys.find((k) => k.provider === "anthropic");
      const o = keys.find((k) => k.provider === "openai");
      const fmt = (k) => (k ? "등록됨 (…" + (k.hint || "") + ")" : "미등록");
      status.innerHTML =
        "Anthropic: <b>" + fmt(a) + "</b> · OpenAI: <b>" + fmt(o) + "</b>" +
        (a || o ? " — 등록된 제공자의 생성은 <b>크레딧 미차감</b>" : "");
    } catch {
      status.textContent = "상태를 불러오지 못했습니다.";
    }
  }
  async function save(provider, inputId) {
    const input = $id(inputId);
    const key = ((input && input.value) || "").trim();
    if (!key) return note("키를 입력하세요.", false);
    try {
      const r = await fetch("/api/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return note(d.error || "저장에 실패했습니다.", false);
      if (input) input.value = "";
      note("저장했습니다. 이제 이 제공자의 AI 생성은 내 키로 실행됩니다(크레딧 미차감).", true);
      refresh();
    } catch {
      note("저장 중 오류가 발생했습니다.", false);
    }
  }
  async function del(provider) {
    try {
      const r = await fetch("/api/me/api-keys/" + provider, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return note(d.error || "삭제에 실패했습니다.", false);
      note("삭제했습니다. 이후 생성은 서버 키·크레딧으로 실행됩니다.", true);
      refresh();
    } catch {
      note("삭제 중 오류가 발생했습니다.", false);
    }
  }
  const on = (id, fn) => {
    const el = $id(id);
    if (el) el.addEventListener("click", fn);
  };
  on("byokSaveAnthropic", () => save("anthropic", "byokAnthropicInput"));
  on("byokDelAnthropic", () => del("anthropic"));
  on("byokSaveOpenai", () => save("openai", "byokOpenaiInput"));
  on("byokDelOpenai", () => del("openai"));
  refresh();
})();

// ── 개인 설정 · 내 등급 카드 ─────────────────────────────────────────────────
// 현재 등급(관리자/Max/Pro/일반) 표시 + Max가 아니면 업그레이드 안내·입금 신청 경로 제공.
// (Max 신청 모달은 '내 파일' 패널과 공유 — window.__openMaxModal)
(function initTierCard() {
  const box = document.getElementById("tierStatus");
  if (!box) return;
  const upsell = document.getElementById("maxUpsell");
  Promise.all([
    fetch("/api/subscriptions/me").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/me/beta").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([sub, beta]) => {
    if (!sub && !beta) {
      box.textContent = "로그인 후 확인할 수 있습니다.";
      return;
    }
    const feats = beta && Array.isArray(beta.features) ? beta.features : [];
    let tier;
    let desc;
    if ((sub && sub.admin) || (beta && beta.admin === true)) {
      tier = "관리자";
      desc = "모든 기능 사용 가능";
    } else if (sub && sub.active) {
      tier = "Max";
      desc = sub.expiresAt
        ? new Date(sub.expiresAt).toLocaleDateString("ko-KR") + " 까지"
        : "";
    } else if (feats.length) {
      tier = "Pro";
      desc = "Pro 기능 " + feats.length + "개 사용 가능";
    } else {
      tier = "일반";
      desc = "크레딧으로 보고서 생성";
    }
    box.innerHTML = "현재 등급: <b>" + tier + "</b>" + (desc ? " — " + desc : "");
    if (!upsell || tier === "Max" || tier === "관리자") return;
    upsell.hidden = false;
    const plan = (sub && sub.plan) || {};
    const price = plan.priceKrw
      ? Number(plan.priceKrw).toLocaleString() + "원"
      : "가격은 관리자 문의";
    const days = plan.periodDays || 30;
    const info = document.getElementById("maxPlanInfo");
    if (info) {
      // 서버/DB에서 온 계좌 정보는 innerHTML에 넣기 전 반드시 escape(XSS 방지).
      const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[c]);
      info.innerHTML =
        "<b>Max</b> (" + days + "일 · " + price + "): 🌙 백그라운드 실행(탭 닫아도 생성+이메일 수신) · 📄 PDF 통번역(월 300쪽) · 💎 승인 시 10크레딧 지급" +
        (plan.bank
          ? "<br>입금 계좌: " + esc(plan.bank) + " " + esc(plan.account || "") +
            (plan.holder ? " (" + esc(plan.holder) + ")" : "") +
            " — 입금자명은 <b>학번+이름</b>으로"
          : "");
    }
    const btn = document.getElementById("maxRequestBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        if (typeof window.__openMaxModal === "function") window.__openMaxModal();
        else alert("신청 창을 열 수 없습니다. 새로고침 후 다시 시도하거나 관리자에게 문의하세요.");
      });
    }
  });
})();
