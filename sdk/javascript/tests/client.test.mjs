import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Quilo, QuiloError } from "../src/index.js";

async function startServer() {
  let jobReads = 0;
  const server = http.createServer((req, res) => {
    const json = (status, body) => {
      const data = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
      res.end(data);
    };
    if (req.url.startsWith("/api/catalog")) return json(200, { features: [{ id: "pdf-translate", execution: "remote" }] });
    if (req.headers.authorization !== "Bearer quilo_test") return json(401, { error: "bad token", code: "INVALID_ACCESS_TOKEN", requestId: "req_js" });
    if (req.method === "GET" && req.url === "/api/v1/account") return json(200, { credits: 12 });
    if (req.method === "GET" && req.url === "/api/v1/studios/vibe/config") return json(200, { defaultModel: "claude-sonnet-5" });
    if (req.method === "GET" && req.url === "/api/v1/file-chat/access") return json(200, { allowed: true });
    if (req.method === "GET" && req.url === "/api/v1/knowledge/lab") return json(200, { entries: [{ id: "entry-js" }] });
    if (req.method === "GET" && req.url === "/api/v1/community/posts") return json(200, { posts: [{ id: "post-js" }] });
    if (req.method === "GET" && req.url === "/api/v1/jobs/job-js") {
      jobReads += 1;
      return json(200, { job: { id: "job-js", status: jobReads > 1 ? "completed" : "running" } });
    }
    if (req.method === "GET" && req.url === "/api/v1/jobs/job-js/download") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end("%PDF-js");
    }
    req.resume();
    req.on("end", () => {
      if (req.url === "/api/v1/pdf-translations/estimate") return json(200, { pages: 4, mode: "inplace" });
      if (req.url === "/api/v1/pdf-translations") return json(200, { jobId: "job-js" });
      if (req.url === "/api/v1/conversions/docx-to-hwpx") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end("PK-js");
      }
      if (req.url === "/api/v1/studios/vibe/generate") return json(200, { result: { title: "JS 프로젝트" } });
      if (req.url === "/api/v1/studios/physics/generate") return json(200, { result: { title: "JS 물리" } });
      if (req.url === "/api/v1/file-chat/messages") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return res.end("JS 파일 답변");
      }
      if (req.url === "/api/v1/community/posts") return json(200, { ok: true, post: { id: "post-new" } });
      return json(404, { error: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("JavaScript SDK calls catalog, PDF, jobs, download, and conversion APIs", async (t) => {
  const server = await startServer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quilo-js-test-"));
  t.after(async () => {
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const pdf = path.join(root, "input.pdf");
  const docx = path.join(root, "input.docx");
  await fs.writeFile(pdf, "%PDF-input");
  await fs.writeFile(docx, "PK-docx");
  const client = new Quilo({ apiKey: "quilo_test", baseUrl: `http://127.0.0.1:${server.address().port}` });

  assert.equal((await client.features("pdf"))[0].id, "pdf-translate");
  assert.equal((await client.account()).credits, 12);
  assert.equal((await client.pdf.estimate(pdf)).pages, 4);
  const job = await client.pdf.translate(pdf);
  assert.equal(job.id, "job-js");
  assert.equal((await client.jobs.wait(job.id, { timeoutMs: 1000, pollIntervalMs: 10 })).status, "completed");
  const downloaded = await client.jobs.download(job.id, path.join(root, "out.pdf"));
  assert.equal(await fs.readFile(downloaded, "utf8"), "%PDF-js");
  const converted = await client.conversions.docxToHwpx(docx, path.join(root, "out.hwpx"));
  assert.equal(await fs.readFile(converted, "utf8"), "PK-js");
});

test("JavaScript SDK exposes studio, chat, knowledge, and community resources", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = new Quilo({ apiKey: "quilo_test", baseUrl: `http://127.0.0.1:${server.address().port}` });
  assert.equal((await client.studios.vibeConfig()).defaultModel, "claude-sonnet-5");
  assert.equal((await client.studios.generateVibe("앱")).result.title, "JS 프로젝트");
  assert.equal((await client.studios.generatePhysics("역학")).result.title, "JS 물리");
  assert.equal((await client.fileChat.access()).allowed, true);
  assert.equal(await client.fileChat.message("질문"), "JS 파일 답변");
  assert.equal((await client.knowledge.lab())[0].id, "entry-js");
  assert.equal((await client.community.posts())[0].id, "post-js");
  assert.equal((await client.community.createPost({ title: "제목", body: "본문" })).post.id, "post-new");
});

test("JavaScript SDK preserves API error metadata", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = new Quilo({ apiKey: "wrong", baseUrl: `http://127.0.0.1:${server.address().port}` });
  await assert.rejects(client.account(), (error) => {
    assert.ok(error instanceof QuiloError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "INVALID_ACCESS_TOKEN");
    assert.equal(error.requestId, "req_js");
    return true;
  });
});
