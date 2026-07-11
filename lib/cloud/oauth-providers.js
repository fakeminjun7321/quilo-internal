"use strict";

const crypto = require("node:crypto");

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const NOTION_AUTH = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN = "https://api.notion.com/v1/oauth/token";
const NOTION_VERSION = "2026-03-11";

function configured(provider) {
  if (provider === "google") return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.CLOUD_TOKEN_SECRET);
  if (provider === "notion") return !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET && process.env.CLOUD_TOKEN_SECRET);
  return false;
}

function encryptionKey() {
  if (!process.env.CLOUD_TOKEN_SECRET) throw new Error("CLOUD_TOKEN_SECRET가 설정되지 않았습니다.");
  return crypto.createHash("sha256").update(process.env.CLOUD_TOKEN_SECRET).digest();
}

function encryptToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptToken(value) {
  const [version, iv, tag, encrypted] = String(value || "").split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("클라우드 토큰 형식이 올바르지 않습니다.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function authorizationUrl(provider, { state, redirectUri }) {
  if (!configured(provider)) throw new Error(`${provider} OAuth가 설정되지 않았습니다.`);
  if (provider === "google") {
    return `${GOOGLE_AUTH}?${new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      scope: [
        "openid", "email", "profile",
        // Google Docs create/batchUpdate 모두 drive.file을 허용한다. 앱이 만들거나
        // 사용자가 명시적으로 선택한 파일만 다루고 전체 문서함 권한은 요청하지 않는다.
        "https://www.googleapis.com/auth/drive.file",
      ].join(" "),
    })}`;
  }
  return `${NOTION_AUTH}?${new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    owner: "user",
    state,
  })}`;
}

async function exchangeCode(provider, { code, redirectUri }) {
  if (provider === "google") {
    return postForm(GOOGLE_TOKEN, {
      code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    });
  }
  const response = await fetch(NOTION_TOKEN, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  return checkedJson(response, "Notion OAuth");
}

async function postForm(url, values) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
  return checkedJson(response, "OAuth token");
}

async function googleAccessToken(refreshToken) {
  const token = await postForm(GOOGLE_TOKEN, {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!token.access_token) throw new Error("Google access token을 받지 못했습니다.");
  return token.access_token;
}

async function googleAccount(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await checkedJson(response, "Google userinfo");
  return { email: data.email || "", name: data.name || "" };
}

async function listDriveFiles(accessToken, { pageSize = 50 } = {}) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(100, Math.max(1, pageSize))),
    q: "trashed = false",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,iconLink)",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { authorization: `Bearer ${accessToken}` } });
  return (await checkedJson(response, "Google Drive list")).files || [];
}

async function uploadDriveFile(accessToken, { name, mimeType, buffer }) {
  const boundary = `quilo_${crypto.randomBytes(12).toString("hex")}`;
  const metadata = Buffer.from(JSON.stringify({ name: String(name).slice(0, 255) }), "utf8");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`), metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    buffer, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return checkedJson(response, "Google Drive upload");
}

async function createGoogleDoc(accessToken, { title, text }) {
  const createResponse = await fetch("https://docs.googleapis.com/v1/documents", {
    method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ title: String(title || "Quilo 문서").slice(0, 200) }),
  });
  const document = await checkedJson(createResponse, "Google Docs create");
  const content = String(text || "").slice(0, 500000);
  if (content) {
    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(document.documentId)}:batchUpdate`, {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
    });
    await checkedJson(updateResponse, "Google Docs batchUpdate");
  }
  return { id: document.documentId, title: document.title, url: `https://docs.google.com/document/d/${document.documentId}/edit` };
}

async function createNotionPage(accessToken, { title, markdown }) {
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "notion-version": NOTION_VERSION },
    body: JSON.stringify({
      parent: { type: "workspace", workspace: true },
      properties: { title: { type: "title", title: [{ type: "text", text: { content: String(title || "Quilo 페이지").slice(0, 200) } }] } },
      markdown: String(markdown || "").slice(0, 500000),
    }),
  });
  const page = await checkedJson(response, "Notion page create");
  return { id: page.id, url: page.url, title: String(title || "Quilo 페이지") };
}

async function checkedJson(response, label) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(`${label} ${response.status}: ${String(data.message || data.error_description || text).slice(0, 400)}`);
  return data;
}

module.exports = {
  authorizationUrl, configured, createGoogleDoc, createNotionPage, decryptToken, encryptToken,
  exchangeCode, googleAccessToken, googleAccount, listDriveFiles, uploadDriveFile,
};
