"use strict";

const crypto = require("node:crypto");
const express = require("express");
const multer = require("multer");
const providers = require("./oauth-providers");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

function createCloudIntegrationRouter({ requireAuth, getSessionUser, supa, baseUrl }) {
  const router = express.Router();
  const redirectUri = (req, provider) => `${baseUrl(req)}/api/cloud/${provider}/callback`;
  const connection = async (req, provider) => {
    const user = getSessionUser(req);
    if (!user?.id) throw new Error("로그인이 필요합니다.");
    const row = await supa.getCloudConnection(user.id, provider);
    if (!row?.refresh_token) throw new Error(`${provider} 연결이 없습니다.`);
    return { user, row };
  };
  const googleToken = async (req) => {
    const { row } = await connection(req, "google");
    return providers.googleAccessToken(providers.decryptToken(row.refresh_token));
  };

  router.get("/providers/status", requireAuth, async (req, res) => {
    const user = getSessionUser(req);
    const status = {};
    for (const provider of ["dropbox", "google", "notion"]) {
      let row = null;
      try { row = user?.id ? await supa.getCloudConnection(user.id, provider) : null; } catch {}
      status[provider] = {
        configured: provider === "dropbox" ? !!(process.env.DROPBOX_APP_KEY && process.env.CLOUD_TOKEN_SECRET) : providers.configured(provider),
        connected: !!row,
        accountEmail: row?.account_email || null,
        accountName: row?.account_name || null,
        connectUrl: provider === "dropbox" ? "/api/cloud/dropbox/connect" : `/api/cloud/${provider}/connect`,
      };
    }
    res.json({ integrations: status });
  });

  for (const provider of ["google", "notion"]) {
    router.get(`/${provider}/connect`, requireAuth, (req, res) => {
      if (!providers.configured(provider)) return res.status(503).json({ error: `${provider} OAuth 환경변수가 설정되지 않았습니다.` });
      const state = crypto.randomBytes(24).toString("hex");
      req.session.cloudOAuth ||= {};
      req.session.cloudOAuth[provider] = { state, createdAt: Date.now() };
      res.redirect(providers.authorizationUrl(provider, { state, redirectUri: redirectUri(req, provider) }));
    });
    router.get(`/${provider}/callback`, requireAuth, async (req, res) => {
      const saved = req.session.cloudOAuth?.[provider];
      if (req.session.cloudOAuth) delete req.session.cloudOAuth[provider];
      if (!saved || Date.now() - saved.createdAt > 10 * 60 * 1000 || String(req.query.state || "") !== saved.state || !req.query.code) {
        return res.redirect("/?cloud=error");
      }
      try {
        const token = await providers.exchangeCode(provider, { code: String(req.query.code), redirectUri: redirectUri(req, provider) });
        const user = getSessionUser(req);
        let credential = provider === "google" ? token.refresh_token : token.access_token;
        if (!credential) throw new Error("OAuth 장기 토큰을 받지 못했습니다.");
        let email = "";
        let name = "";
        if (provider === "google") {
          const account = await providers.googleAccount(token.access_token);
          email = account.email;
          name = account.name;
        } else {
          email = token.owner?.user?.person?.email || "";
          name = token.workspace_name || token.owner?.user?.name || "";
        }
        await supa.saveCloudConnection(user.id, provider, { refreshToken: providers.encryptToken(credential), accountEmail: email, accountName: name });
        res.redirect(`/?cloud=${provider}-connected`);
      } catch (error) {
        console.error(`[cloud] ${provider} callback:`, error.message);
        res.redirect("/?cloud=error");
      }
    });
  }

  router.post("/:provider/disconnect", requireAuth, async (req, res) => {
    const provider = String(req.params.provider || "");
    if (!["dropbox", "google", "notion"].includes(provider)) return res.status(400).json({ error: "지원하지 않는 provider입니다." });
    await supa.deleteCloudConnection(getSessionUser(req).id, provider);
    res.json({ ok: true });
  });

  router.get("/google/drive/files", requireAuth, async (req, res) => {
    try { res.json({ files: await providers.listDriveFiles(await googleToken(req), { pageSize: req.query.limit }) }); }
    catch (error) { res.status(502).json({ error: error.message }); }
  });
  router.post("/google/drive/upload", requireAuth, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "업로드할 파일이 필요합니다." });
    try {
      const file = await providers.uploadDriveFile(await googleToken(req), { name: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer });
      res.status(201).json({ file });
    } catch (error) { res.status(502).json({ error: error.message }); }
  });
  router.post("/google/docs", requireAuth, async (req, res) => {
    try { res.status(201).json({ document: await providers.createGoogleDoc(await googleToken(req), req.body || {}) }); }
    catch (error) { res.status(502).json({ error: error.message }); }
  });
  router.post("/notion/pages", requireAuth, async (req, res) => {
    try {
      const { row } = await connection(req, "notion");
      res.status(201).json({ page: await providers.createNotionPage(providers.decryptToken(row.refresh_token), req.body || {}) });
    } catch (error) { res.status(502).json({ error: error.message }); }
  });
  return router;
}

module.exports = { createCloudIntegrationRouter };
