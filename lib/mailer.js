// 범용 이메일 발송(Resend) + 학교 이메일 인증 메일.
// feedback-mailer.js 와 같은 Resend HTTP API 를 쓰되, 인증 메일 등 다른 용도로
// 재사용할 수 있게 일반 sendEmail() 로 분리했다.
//
// 환경변수
//  - RESEND_API_KEY                : 필수(없으면 발송 비활성, sent:false)
//  - RESEND_FROM / FEEDBACK_EMAIL_FROM : 발신 주소(둘 중 하나)
//  - ALLOWED_EMAIL_DOMAINS         : 가입 허용 이메일 도메인(쉼표구분, 기본 "ts.hs.kr")
//  - PUBLIC_BASE_URL / APP_BASE_URL: 인증 링크 절대주소(없으면 요청 origin 사용)

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── 허용 이메일 도메인 ────────────────────────────────────────────────────────
function allowedEmailDomains() {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS || "ts.hs.kr";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

// 이메일 형식 + 허용 도메인 검증. 통과하면 정규화된(소문자) 이메일을 반환.
function normalizeSchoolEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  // 보수적 형식 검증: 로컬파트는 영문/숫자/._%+- 만(따옴표·HTML 특수문자 차단 → 저장/표시
  // 경로의 속성 인젝션 원천 차단), 도메인은 영문/숫자/.- 에 점 포함.
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z0-9-]+$/.test(e)) {
    return { ok: false, reason: "이메일 형식이 올바르지 않습니다." };
  }
  const domain = e.split("@")[1] || "";
  const allowed = allowedEmailDomains();
  const match = allowed.some((d) => domain === d || domain.endsWith("." + d));
  if (!match) {
    return {
      ok: false,
      reason: `학교 이메일(@${allowed[0] || "ts.hs.kr"})만 인증할 수 있습니다.`,
    };
  }
  return { ok: true, email: e, domain };
}

// ── 범용 발송 ────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.FEEDBACK_EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }
  if (!to) return { sent: false, reason: "no_recipient" };

  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
  } catch (e) {
    return { sent: false, reason: "network", detail: String(e.message || e) };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      sent: false,
      reason: `resend_${response.status}`,
      detail: detail.slice(0, 500),
    };
  }
  const data = await response.json().catch(() => ({}));
  return { sent: true, id: data.id || null };
}

// ── 학교 이메일 인증 메일 ─────────────────────────────────────────────────────
function buildVerificationHtml({ name, link }) {
  const safeName = escapeHtml(name || "");
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html lang="ko">
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif; color:#1f2937; line-height:1.6;">
    <div style="max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">Quilo 학교 이메일 인증</h2>
      <p style="margin:0 0 16px;">${safeName ? safeName + "님, " : ""}아래 버튼을 눌러 학교 이메일 인증을 완료하세요. 인증 후 관리자 승인을 받으면 보고서 생성을 사용할 수 있습니다.</p>
      <p style="margin:0 0 24px;">
        <a href="${safeLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">이메일 인증하기</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;">버튼이 동작하지 않으면 아래 주소를 브라우저에 붙여넣으세요.</p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${safeLink}" style="color:#2563eb;">${safeLink}</a></p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">이 링크는 24시간 동안 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    </div>
  </body>
</html>`;
}

function buildVerificationText({ name, link }) {
  return [
    `${name ? name + "님, " : ""}Quilo 학교 이메일 인증을 완료하세요.`,
    "",
    "아래 주소를 브라우저에서 열면 인증이 완료됩니다(24시간 유효):",
    link,
    "",
    "인증 후 관리자 승인을 받으면 보고서 생성을 사용할 수 있습니다.",
    "본인이 요청하지 않았다면 이 메일을 무시하세요.",
  ].join("\n");
}

async function sendVerificationEmail({ to, name, link }) {
  return sendEmail({
    to,
    subject: "[Quilo] 학교 이메일 인증을 완료하세요",
    html: buildVerificationHtml({ name, link }),
    text: buildVerificationText({ name, link }),
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  allowedEmailDomains,
  normalizeSchoolEmail,
};
