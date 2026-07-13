"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const sharp = require("sharp");
const editorial = require("../lib/editorial-content");
const createEditorialRouter = require("../lib/editorial-routes");

test("rich HTML sanitizer preserves editor formatting while removing executable markup", () => {
  const dirty = [
    '<h2 onclick="steal()" style="font-family:Pretendard;text-align:center;position:fixed">개발 팁</h2>',
    '<script><img src="https://evil.example/x" onerror="steal()">alert(1)</script>',
    '<p><strong>굵게</strong> <u>밑줄</u> <span style="font-size:18px;color:#123456;background-image:url(javascript:1)">본문 🙂</span></p>',
    '<a href="jav&#x61;script:alert(1)" target="_blank">위험</a>',
    '<a href="https://quilolab.com/guide" target="_blank">안전</a>',
    '<img src="/api/editorial/attachments/123/download?inline=1" onload="steal()" width="800">',
    '<iframe srcdoc="<script>alert(1)</script>">숨김</iframe>',
  ].join("");
  const clean = editorial.sanitizeRichHtml(dirty);

  assert.match(clean, /<h2 style="font-family:pretendard;text-align:center">개발 팁<\/h2>/);
  assert.match(clean, /<strong>굵게<\/strong>/);
  assert.match(clean, /font-size:18px;color:#123456/);
  assert.match(clean, /href="https:\/\/quilolab\.com\/guide" target="_blank" rel="noopener noreferrer nofollow"/);
  assert.match(clean, /src="\/api\/editorial\/attachments\/123\/download\?inline=1" width="800" loading="lazy"/);
  assert.doesNotMatch(clean, /script|iframe|onerror|onload|onclick|javascript|position|background-image|alert\(1\)|숨김/i);
});

test("sanitizer rejects encoded and whitespace-obfuscated dangerous URLs", () => {
  const clean = editorial.sanitizeRichHtml([
    '<a href="java&#x09;script:alert(1)">a</a>',
    '<img src="data:image/svg+xml,%3Csvg%20onload=alert(1)%3E">',
    '<a href="//evil.example/x">b</a>',
    '<a href="mailto:help@quilolab.com">mail</a>',
    '<svg><a href="https://evil.example">dropped</a></svg>',
  ].join(""));
  assert.equal(clean, '<a>a</a><img loading="lazy"><a>b</a><a href="mailto:help@quilolab.com">mail</a>');
});

test("post normalization creates stable Korean slugs, deduplicates tags and sanitizes HTML", () => {
  const post = editorial.normalizePostInput({
    kind: "developer",
    title: "  Quilo 개발 꿀팁  ",
    tags: ["#API", "api", "실험", ""],
    richHtml: '<p onmouseover="x()">안전한 본문</p>',
    status: "draft",
  });
  assert.equal(post.slug, "quilo-개발-꿀팁");
  assert.deepEqual(post.tags, ["API", "실험"]);
  assert.equal(post.rich_html, "<p>안전한 본문</p>");
  assert.equal(post.published_at, null);

  const transitional = editorial.normalizePostInput({
    kind: "developer_note",
    title: "전환기 입력",
    status: "draft",
  });
  assert.equal(transitional.kind, "developer");
});

test("developer, staff and admin permissions remain independent", () => {
  const developer = { isDeveloper: true, isStaff: false, isAdmin: false };
  const staff = { isDeveloper: false, isStaff: true, isAdmin: false };
  const admin = { isDeveloper: false, isStaff: false, isAdmin: true };
  assert.equal(editorial.canWriteKind(developer, "developer"), true);
  assert.equal(editorial.canWriteKind(developer, "resource"), false);
  assert.equal(editorial.canWriteKind(staff, "resource"), true);
  assert.equal(editorial.canWriteKind(staff, "developer"), false);
  assert.equal(editorial.canWriteKind(admin, "developer"), true);
  assert.equal(editorial.canWriteKind(admin, "resource"), true);
  assert.equal(editorial.canManageRequests(developer), false);
  assert.equal(editorial.canManageRequests(staff), true);
});

test("attachment validation checks size, filename, extension, MIME and file signature", () => {
  const pdf = Buffer.from("%PDF-1.7\nvalid fixture");
  const valid = editorial.validateAttachment({
    originalname: "실험 자료.pdf",
    mimetype: "application/pdf",
    size: pdf.length,
    buffer: pdf,
  });
  assert.equal(valid.filename, "실험 자료.pdf");
  assert.equal(valid.mimeType, "application/pdf");

  const fakePdf = Buffer.from("notapdf!");
  assert.throws(() => editorial.validateAttachment({
    originalname: "가짜.pdf", mimetype: "application/pdf", size: fakePdf.length, buffer: fakePdf,
  }), (error) => error.code === "EDITORIAL_INVALID_ATTACHMENT_MIME" && error.status === 415);
  const html = Buffer.from("<b>x</b>");
  assert.throws(() => editorial.validateAttachment({
    originalname: "payload.html", mimetype: "text/html", size: html.length, buffer: html,
  }), (error) => error.code === "EDITORIAL_INVALID_ATTACHMENT_MIME");
  assert.throws(() => editorial.validateAttachment({
    originalname: "notes.txt", mimetype: "text/plain", size: 3, buffer: Buffer.from([65, 0, 66]),
  }), (error) => error.code === "EDITORIAL_INVALID_ATTACHMENT_MIME");

  const huge = Buffer.alloc(editorial.MAX_ATTACHMENT_BYTES + 1, 65);
  assert.throws(() => editorial.validateAttachment({
    originalname: "large.txt", mimetype: "text/plain", size: huge.length, buffer: huge,
  }), (error) => error.code === "EDITORIAL_ATTACHMENT_TOO_LARGE" && error.status === 413);
});

test("avatar validation and processing verify real pixels and output a 512px WebP", async () => {
  const png = await sharp({
    create: { width: 900, height: 450, channels: 4, background: { r: 40, g: 90, b: 210, alpha: 1 } },
  }).png().toBuffer();
  const file = { originalname: "profile.png", mimetype: "image/png", size: png.length, buffer: png };
  const validated = editorial.validateAvatarInput(file);
  assert.equal(validated.sharpFormat, "png");

  const processed = await editorial.prepareAvatarImage(file);
  assert.equal(processed.mimeType, "image/webp");
  assert.ok(processed.buffer.length <= editorial.MAX_AVATAR_OUTPUT_BYTES);
  const metadata = await sharp(processed.buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.throws(() => editorial.validateAvatarInput({
    originalname: "avatar.svg", mimetype: "image/svg+xml", size: svg.length, buffer: svg,
  }), (error) => error.code === "EDITORIAL_INVALID_AVATAR_MIME" && error.status === 415);

  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
  await assert.rejects(() => editorial.prepareAvatarImage({
    originalname: "fake.jpg", mimetype: "image/jpeg", size: fakeJpeg.length, buffer: fakeJpeg,
  }), (error) => error.code === "EDITORIAL_INVALID_AVATAR_DATA");
});

test("avatar storage reports a missing profile-images bucket as 503", async (t) => {
  const supa = require("../lib/supabase");
  const originalGetClient = supa.getClient;
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#123456" },
  }).png().toBuffer();
  const query = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: { avatar_url: null }, error: null }); },
  };
  supa.getClient = () => ({
    from: () => Object.create(query),
    storage: {
      from: () => ({
        upload: async () => ({ error: { message: "Bucket not found" } }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove: async () => ({ error: null }),
      }),
    },
  });
  t.after(() => { supa.getClient = originalGetClient; });

  await assert.rejects(() => editorial.saveAvatarImage(
    "123e4567-e89b-42d3-a456-426614174000",
    { originalname: "avatar.png", mimetype: "image/png", size: png.length, buffer: png },
  ), (error) => error.code === "EDITORIAL_AVATAR_STORAGE_UNAVAILABLE" && error.status === 503);
});

test("database migration errors become an explicit 503 contract", () => {
  const source = { code: "PGRST204", message: "Could not find the 'is_staff' column of 'users' in the schema cache" };
  assert.equal(editorial.isSchemaMissingError(source), true);
  const error = editorial.dbError("권한 조회", source);
  assert.equal(error.status, 503);
  assert.equal(error.code, "EDITORIAL_SCHEMA_MISSING");
  assert.match(error.message, /20260714_add_editorial_platform\.sql/);
});

test("router blocks cross-account draft edits and attachment downloads", async (t) => {
  const authorId = "11111111-1111-4111-8111-111111111111";
  const viewerId = "22222222-2222-4222-8222-222222222222";
  const postId = "33333333-3333-4333-8333-333333333333";
  const attachmentId = "44444444-4444-4444-8444-444444444444";
  const original = {
    getUserRoles: editorial.getUserRoles,
    getPostById: editorial.getPostById,
    getAttachment: editorial.getAttachment,
  };
  editorial.getUserRoles = async () => ({
    id: viewerId, name: "다른 사용자", isAdmin: false, isDeveloper: true, isStaff: false,
  });
  editorial.getPostById = async () => ({
    id: postId, kind: "developer", status: "draft", author_id: authorId, published_at: null,
  });
  editorial.getAttachment = async () => ({
    id: attachmentId,
    post_id: postId,
    filename: "secret.pdf",
    mime_type: "application/pdf",
    size_bytes: 10,
    data_base64: Buffer.from("top secret").toString("base64"),
    post: { id: postId, status: "draft", author_id: authorId, published_at: null },
  });
  t.after(() => Object.assign(editorial, original));

  const app = express();
  app.use(express.json());
  const viewer = { id: viewerId, name: "다른 사용자" };
  app.use("/api/editorial", createEditorialRouter({
    requireAuth: (_req, _res, next) => next(),
    requireAdmin: (_req, res) => res.status(403).json({ error: "관리자 전용" }),
    getSessionUser: () => viewer,
    refreshSessionUser: async () => viewer,
    upload: { single: () => (_req, _res, next) => next() },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/editorial`;

  const draftDownload = await fetch(`${base}/attachments/${attachmentId}/download`);
  assert.equal(draftDownload.status, 403);
  assert.equal((await draftDownload.json()).code, "EDITORIAL_FORBIDDEN");

  const edit = await fetch(`${base}/posts/${postId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "가로채기" }),
  });
  assert.equal(edit.status, 403);
  assert.equal((await edit.json()).code, "EDITORIAL_FORBIDDEN");
});

test("router factory validates dependencies and returns structured storage-unavailable errors", async (t) => {
  assert.throws(() => createEditorialRouter({}), /requireAuth/);

  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  t.after(() => {
    if (oldUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey == null) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = oldKey;
  });

  const requireAuth = (_req, res, next) => next ? next() : res.status(401).json({ error: "로그인이 필요합니다." });
  const requireAdmin = (_req, _res, next) => next();
  const upload = { single: () => (_req, _res, next) => next() };
  const app = express();
  app.use(express.json());
  app.use("/api/editorial", createEditorialRouter({
    requireAuth,
    requireAdmin,
    getSessionUser: () => null,
    refreshSessionUser: async () => null,
    upload,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}`;
  const unavailable = await fetch(`${base}/api/editorial/posts`);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: "편집 콘텐츠 저장소가 설정되지 않았습니다.",
    code: "EDITORIAL_STORAGE_UNAVAILABLE",
  });

  const invalidId = await fetch(`${base}/api/editorial/profiles/not-a-uuid`);
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).code, "EDITORIAL_INVALID_ID");
});
