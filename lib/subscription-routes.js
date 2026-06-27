// 백그라운드 실행 구독(background_subscriptions) 라우터.
//   - 사용자: GET  /api/subscriptions/me      (본인 백그라운드 권한 상태 — 토글 노출용)
//   - 관리자: GET  /api/subscriptions          (구독 목록)
//             POST /api/subscriptions          (부여)
//             POST /api/subscriptions/:id/revoke (회수)
//
// "백그라운드 실행"이란 보고서를 제출한 뒤 탭/창을 닫아도 서버가 끝까지 생성하고,
// '내 파일'과 완료 이메일로 받을 수 있는 기능이다. 관리자가 지정 사용자에게 기간 한정으로
// 부여하며(api_key_grants 와 동일 구조), 나중에 월 결제로 확장할 때는 결제 성공 시
// supa.createBackgroundSub({ expiresAt }) 만 호출하면 된다.
const express = require("express");
const supa = require("./supabase");

module.exports = function subscriptionRoutes({
  requireAuth,
  requireAdmin,
  getSessionUser,
}) {
  const router = express.Router();

  // 본인 백그라운드 권한 상태(토글 노출·배지용). 항상 200 — 실패해도 active:false 로 graceful.
  router.get("/me", requireAuth, async (req, res) => {
    const u = getSessionUser(req);
    if (!u || !u.id) return res.json({ active: false, admin: false });
    if (u.isAdmin) return res.json({ active: true, admin: true });
    if (!supa.isEnabled()) return res.json({ active: false, admin: false });
    try {
      const s = await supa.getActiveBackgroundSub(u.id);
      if (!s) return res.json({ active: false, admin: false });
      return res.json({
        active: true,
        admin: false,
        expiresAt: s.expires_at,
        note: s.note || "",
      });
    } catch (_) {
      return res.json({ active: false, admin: false });
    }
  });

  // 관리자: 구독 목록. ?active=1 이면 활성만.
  router.get("/", requireAdmin, async (req, res) => {
    try {
      const activeOnly = String(req.query.active || "") === "1";
      const subs = await supa.listBackgroundSubs({ activeOnly });
      res.json({ subs });
    } catch (e) {
      res
        .status(e.code === "BG_SUB_TABLE_MISSING" ? 400 : 500)
        .json({ error: e.message });
    }
  });

  // 관리자: 구독 부여. body = { name | userId, days?, hours?, expiresAt?, note? }
  router.post("/", requireAdmin, async (req, res) => {
    const admin = getSessionUser(req);
    try {
      let userId = String(req.body.userId || "").trim();
      const name = String(req.body.name || "").trim();
      if (!userId && name) {
        const target = await supa.findUserByName(name);
        if (!target) {
          return res
            .status(404)
            .json({ error: `사용자 '${name}'를 찾을 수 없습니다.` });
        }
        userId = target.id;
      }
      if (!userId) {
        return res.status(400).json({ error: "대상 사용자를 지정하세요." });
      }

      let expiresAt = req.body.expiresAt;
      const permanent =
        req.body.permanent === true || String(req.body.permanent) === "true";
      if (!expiresAt && permanent) {
        // 무기한(결제 도입 전 단계의 '프리미엄 지정'). 100년 후 만료 = 사실상 영구.
        // 해제는 '회수'(revoke)로 한다. 게이트는 expires_at>now 만 보므로 그대로 동작.
        expiresAt = new Date(
          Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
      if (!expiresAt) {
        const days = Math.max(0, Math.min(366, Number(req.body.days) || 0));
        const hours = Math.max(0, Math.min(24 * 366, Number(req.body.hours) || 0));
        const ms = (days * 24 + hours) * 60 * 60 * 1000;
        if (ms <= 0) {
          return res
            .status(400)
            .json({ error: "구독 기간(일/시간)을 1 이상으로 지정하세요." });
        }
        expiresAt = new Date(Date.now() + ms).toISOString();
      }

      const sub = await supa.createBackgroundSub({
        userId,
        grantedBy: admin && admin.id ? admin.id : null,
        expiresAt,
        note: req.body.note || "",
      });
      res.json({ ok: true, sub });
    } catch (e) {
      res
        .status(e.code === "BG_SUB_TABLE_MISSING" ? 400 : 500)
        .json({ error: e.message });
    }
  });

  // 관리자: 구독 회수(즉시 만료).
  router.post("/:id/revoke", requireAdmin, async (req, res) => {
    try {
      await supa.revokeBackgroundSub(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
