// 커뮤니티 API 라우터 — server.js 를 거의 수정하지 않도록 별도 모듈로 분리.
// 마운트: app.use("/api/community", require("./lib/community-routes")({ requireAuth, requireAdmin, getSessionUser }))
//
// 읽기(GET 목록/댓글): 비로그인 허용. 작성·공감·댓글·삭제: 로그인.
// 비속어 → 작성 거부 + 1주일 작성 금지(comm.banUser). 관리자는 모든 글/댓글 삭제·밴 해제.

const express = require("express");
const comm = require("./community");
const supa = require("./supabase");

module.exports = function communityRouter({
  requireAuth,
  requireAdmin,
  getSessionUser,
}) {
  const r = express.Router();
  const authorName = (u) => (u && (u.user || u.name)) || "익명";
  const meOf = (u) => (u ? { id: u.id, isAdmin: !!u.isAdmin } : null);

  // 목록(공개)
  r.get("/posts", async (req, res) => {
    if (!supa.isEnabled()) return res.json({ posts: [], storage: false });
    try {
      const u = getSessionUser(req);
      const category = ["feature", "suggestion"].includes(String(req.query.category))
        ? String(req.query.category)
        : null;
      const posts = await comm.listPosts({ category, viewerId: u && u.id });
      res.json({ posts, storage: true, me: meOf(u) });
    } catch (e) {
      console.error("[community] list:", e);
      res.status(500).json({ error: "목록을 불러오지 못했습니다." });
    }
  });

  // 글 작성(로그인) — 비속어 검사 + 밴 검사
  r.post("/posts", requireAuth, async (req, res) => {
    const u = getSessionUser(req);
    if (!supa.isEnabled())
      return res.status(503).json({ error: "커뮤니티를 사용할 수 없습니다." });
    try {
      const ban = await comm.getActiveBan(u.id);
      if (ban)
        return res
          .status(403)
          .json({ error: "작성이 제한된 상태입니다.", bannedUntil: ban });
      const title = String((req.body && req.body.title) || "").trim();
      const body = String((req.body && req.body.body) || "").trim();
      const category =
        req.body && req.body.category === "feature" ? "feature" : "suggestion";
      if (!title || !body)
        return res.status(400).json({ error: "제목과 내용을 입력하세요." });
      const vt = comm.validateText(title + "\n" + body, { max: 5200 });
      if (!vt.ok) {
        if (vt.profanity) {
          const until = await comm.banUser(u.id);
          return res.status(403).json({
            error:
              "비속어가 포함되어 글이 등록되지 않았고, 1주일간 작성이 금지됩니다.",
            bannedUntil: until,
            profanity: true,
          });
        }
        return res.status(400).json({ error: vt.reason });
      }
      const post = await comm.createPost({
        userId: u.id,
        authorName: authorName(u),
        category,
        title,
        body,
      });
      res.json({ ok: true, post });
    } catch (e) {
      console.error("[community] create:", e);
      res.status(500).json({ error: "등록에 실패했습니다." });
    }
  });

  // 글 삭제(작성자 또는 관리자)
  r.delete("/posts/:id", requireAuth, async (req, res) => {
    const u = getSessionUser(req);
    try {
      const post = await comm.getPost(req.params.id);
      if (!post) return res.status(404).json({ error: "글이 없습니다." });
      if (!u.isAdmin && post.user_id !== u.id)
        return res.status(403).json({ error: "권한이 없습니다." });
      await comm.deletePost(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "삭제에 실패했습니다." });
    }
  });

  // 공감 토글(로그인)
  r.post("/posts/:id/vote", requireAuth, async (req, res) => {
    const u = getSessionUser(req);
    try {
      const out = await comm.toggleVote(req.params.id, u.id);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ error: "공감 처리에 실패했습니다." });
    }
  });

  // 댓글 목록(공개)
  r.get("/posts/:id/comments", async (req, res) => {
    if (!supa.isEnabled()) return res.json({ comments: [] });
    try {
      const u = getSessionUser(req);
      const comments = await comm.listComments(req.params.id);
      res.json({ comments, me: meOf(u) });
    } catch (e) {
      res.status(500).json({ error: "댓글을 불러오지 못했습니다." });
    }
  });

  // 댓글 작성(로그인) — 비속어 검사 + 밴 검사
  r.post("/posts/:id/comments", requireAuth, async (req, res) => {
    const u = getSessionUser(req);
    try {
      const ban = await comm.getActiveBan(u.id);
      if (ban)
        return res
          .status(403)
          .json({ error: "작성이 제한된 상태입니다.", bannedUntil: ban });
      const body = String((req.body && req.body.body) || "").trim();
      if (!body) return res.status(400).json({ error: "댓글을 입력하세요." });
      const vt = comm.validateText(body, { max: 2000 });
      if (!vt.ok) {
        if (vt.profanity) {
          const until = await comm.banUser(u.id);
          return res.status(403).json({
            error:
              "비속어가 포함되어 댓글이 등록되지 않았고, 1주일간 작성이 금지됩니다.",
            bannedUntil: until,
            profanity: true,
          });
        }
        return res.status(400).json({ error: vt.reason });
      }
      const comment = await comm.addComment({
        postId: req.params.id,
        userId: u.id,
        authorName: authorName(u),
        body,
      });
      res.json({ ok: true, comment });
    } catch (e) {
      res.status(500).json({ error: "댓글 등록에 실패했습니다." });
    }
  });

  // 댓글 삭제(작성자 또는 관리자)
  r.delete("/comments/:id", requireAuth, async (req, res) => {
    const u = getSessionUser(req);
    try {
      const cm = await comm.getComment(req.params.id);
      if (!cm) return res.status(404).json({ error: "댓글이 없습니다." });
      if (!u.isAdmin && cm.user_id !== u.id)
        return res.status(403).json({ error: "권한이 없습니다." });
      await comm.deleteComment(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "삭제에 실패했습니다." });
    }
  });

  // 밴 해제(관리자)
  r.post("/unban/:userId", requireAdmin, async (req, res) => {
    try {
      await comm.unbanUser(req.params.userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "해제에 실패했습니다." });
    }
  });

  return r;
};
