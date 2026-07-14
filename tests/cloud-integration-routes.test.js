"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const providers = require("../lib/cloud/oauth-providers");
const { createCloudIntegrationRouter } = require("../lib/cloud/integration-routes");

async function startRouter(t, supa) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/cloud", createCloudIntegrationRouter({
    requireAuth: (_req, _res, next) => next(),
    getSessionUser: () => ({ id: "user-1", name: "민준" }),
    supa,
    baseUrl: () => "https://quilolab.com",
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("Google integration routes support status, report conversion, import, comments, revoke, and reconnect", async (t) => {
  const previousEnv = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    tokenSecret: process.env.CLOUD_TOKEN_SECRET,
  };
  process.env.GOOGLE_CLIENT_ID = "client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.CLOUD_TOKEN_SECRET = "cloud-test-secret";
  t.after(() => {
    for (const [key, value] of Object.entries({
      GOOGLE_CLIENT_ID: previousEnv.clientId,
      GOOGLE_CLIENT_SECRET: previousEnv.clientSecret,
      CLOUD_TOKEN_SECRET: previousEnv.tokenSecret,
    })) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const originals = {};
  const replace = (name, value) => {
    originals[name] = providers[name];
    providers[name] = value;
  };
  t.after(() => Object.entries(originals).forEach(([name, value]) => { providers[name] = value; }));

  let revokedToken = "";
  let deletedProvider = "";
  let uploaded = null;
  let imported = null;
  replace("googleAccessToken", async (refresh) => {
    assert.equal(refresh, "refresh-token");
    return "access-token";
  });
  replace("revokeGoogleToken", async (refresh) => {
    revokedToken = refresh;
    return true;
  });
  replace("ensureDriveFolder", async () => ({ id: "folder-quilo", name: "Quilo" }));
  replace("findDriveFileBySource", async () => null);
  replace("uploadDriveFile", async (_token, options) => {
    uploaded = options;
    return { id: "gdoc-1", name: options.name, mimeType: options.targetMimeType || options.mimeType, webViewLink: "https://docs.google.com/document/d/gdoc-1/edit" };
  });
  replace("downloadDriveFile", async () => ({
    filename: "가져온 문서.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("drive-file"),
    file: { id: "drive-file-1" },
  }));
  replace("listDriveComments", async () => [{ id: "comment-1", content: "검토 의견", replies: [] }]);
  replace("createDriveComment", async (_token, _fileId, body) => ({ id: "comment-2", content: body.content }));

  const encrypted = providers.encryptToken("refresh-token");
  const supa = {
    isEnabled: () => true,
    getCloudConnection: async (_userId, provider) => provider === "google"
      ? { provider, refresh_token: encrypted, account_email: "user@example.com", account_name: "민준", connected_at: "2026-07-14T00:00:00Z" }
      : null,
    deleteCloudConnection: async (_userId, provider) => { deletedProvider = provider; return true; },
    downloadReportFile: async () => ({
      row: { filename: "물리 결과.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      buffer: Buffer.from("report-docx"),
    }),
    saveReportFile: async (value) => {
      imported = value;
      return { id: "saved-1", filename: value.filename };
    },
  };
  const origin = await startRouter(t, supa);

  const statusResponse = await fetch(`${origin}/api/cloud/providers/status`);
  assert.equal(statusResponse.status, 200);
  const google = (await statusResponse.json()).integrations.google;
  assert.equal(google.connected, true);
  assert.equal(google.reconnectUrl, "/api/cloud/google/connect?reconnect=1");
  assert.equal(google.disconnectUrl, "/api/cloud/google/disconnect");

  const reportResponse = await fetch(`${origin}/api/cloud/google/drive/reports/report-1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ convertToGoogleDoc: true }),
  });
  assert.equal(reportResponse.status, 201);
  assert.equal(uploaded.folderId, "folder-quilo");
  assert.equal(uploaded.targetMimeType, providers.GOOGLE_DOC_MIME);
  assert.equal(uploaded.name, "물리 결과");
  assert.equal(uploaded.appProperties.quiloSourceKey, "report:report-1:gdoc");

  const importResponse = await fetch(`${origin}/api/cloud/google/drive/files/drive-file-1/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(importResponse.status, 201);
  assert.equal(imported.userId, "user-1");
  assert.equal(imported.filename, "가져온 문서.docx");
  assert.equal(imported.buffer.toString(), "drive-file");

  const commentsResponse = await fetch(`${origin}/api/cloud/google/drive/files/drive-file-1/comments`);
  assert.equal(commentsResponse.status, 200);
  assert.equal((await commentsResponse.json()).comments[0].content, "검토 의견");

  const commentResponse = await fetch(`${origin}/api/cloud/google/drive/files/drive-file-1/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "새 댓글" }),
  });
  assert.equal(commentResponse.status, 201);
  assert.equal((await commentResponse.json()).comment.content, "새 댓글");

  const disconnectResponse = await fetch(`${origin}/api/cloud/google/disconnect`, { method: "POST" });
  assert.equal(disconnectResponse.status, 200);
  const disconnected = await disconnectResponse.json();
  assert.equal(disconnected.revoked, true);
  assert.equal(disconnected.reconnectUrl, "/api/cloud/google/connect?reconnect=1");
  assert.equal(revokedToken, "refresh-token");
  assert.equal(deletedProvider, "google");
});
