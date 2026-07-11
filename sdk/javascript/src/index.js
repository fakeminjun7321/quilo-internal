import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class QuiloError extends Error {
  constructor(message, { status, code, requestId, body } = {}) {
    super(message);
    this.name = "QuiloError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.body = body;
  }
}

export class Quilo {
  constructor({ apiKey = process.env.QUILO_ACCESS_TOKEN, baseUrl = process.env.QUILO_BASE_URL || "https://quilolab.com", fetch: fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetch = fetchImpl;
    const parsed = new URL(this.baseUrl);
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
      throw new Error("Quilo baseUrl must use HTTPS except for localhost development.");
    }
    this.jobs = new Jobs(this);
    this.pdf = new Pdf(this);
    this.reports = new Reports(this);
    this.conversions = new Conversions(this);
    this.studios = new Studios(this);
    this.fileChat = new FileChat(this);
    this.knowledge = new Knowledge(this);
    this.community = new Community(this);
  }

  headers({ auth = true, idempotencyKey } = {}) {
    const headers = { accept: "application/json", "user-agent": "quilo-js/0.1.0" };
    if (auth) {
      if (!this.apiKey) throw new QuiloError("Quilo API key is required.");
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    return headers;
  }

  async request(endpoint, { method = "GET", body, auth = true, idempotencyKey, headers = {} } = {}) {
    const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: { ...this.headers({ auth, idempotencyKey }), ...headers },
      body,
    });
    if (!response.ok) await throwResponseError(response);
    return response;
  }

  async json(endpoint, options) {
    return (await this.request(endpoint, options)).json();
  }

  jsonBody(endpoint, body = {}, { method = "POST" } = {}) {
    return this.json(endpoint, {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  account() {
    return this.json("/api/v1/account");
  }

  async features(query) {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
    return (await this.json(`/api/catalog${suffix}`, { auth: false })).features || [];
  }
}

class Jobs {
  constructor(client) { this.client = client; }

  async list() {
    return (await this.client.json("/api/v1/jobs")).jobs || [];
  }

  async retrieve(id) {
    return (await this.client.json(`/api/v1/jobs/${encodeURIComponent(id)}`)).job;
  }

  abort(id) {
    return this.client.json(`/api/v1/jobs/${encodeURIComponent(id)}/abort`, { method: "POST" });
  }

  async wait(id, { timeoutMs = 600_000, pollIntervalMs = 2_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const job = await this.retrieve(id);
      if (["completed", "failed", "cancelled", "interrupted"].includes(job.status)) {
        if (job.status === "failed") throw new QuiloError(job.error || `Quilo job ${id} failed.`);
        return job;
      }
      if (Date.now() >= deadline) throw new QuiloError(`Timed out waiting for Quilo job ${id}.`, { code: "JOB_WAIT_TIMEOUT" });
      await new Promise((resolve) => setTimeout(resolve, Math.max(100, pollIntervalMs)));
    }
  }

  async download(id, destination, { fileIndex } = {}) {
    const suffix = Number.isInteger(fileIndex) ? `?file=${fileIndex}` : "";
    const response = await this.client.request(`/api/v1/jobs/${encodeURIComponent(id)}/download${suffix}`);
    const output = path.resolve(String(destination));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
    return output;
  }
}

class Pdf {
  constructor(client) { this.client = client; }

  async estimate(file, { mode = "auto", model = "claude-sonnet-5" } = {}) {
    const form = new FormData();
    form.append("mode", mode);
    form.append("model", model);
    await appendFile(form, "pdf", file, ".pdf");
    return this.client.json("/api/v1/pdf-translations/estimate", { method: "POST", body: form });
  }

  async translate(files, {
    mode = "auto",
    model = "claude-sonnet-5",
    restoreOnly = false,
    chartRedraw = false,
    background = false,
    notifyEmail = false,
    idempotencyKey = randomUUID(),
  } = {}) {
    const paths = Array.isArray(files) ? files : [files];
    if (!paths.length || paths.length > 10) throw new QuiloError("Choose between 1 and 10 PDF files.");
    const form = new FormData();
    for (const file of paths) await appendFile(form, "pdf", file, ".pdf");
    form.append("mode", mode);
    form.append("model", model);
    form.append("restoreOnly", String(restoreOnly));
    form.append("chartRedraw", String(chartRedraw));
    form.append("backgroundMode", String(background));
    form.append("notifyEmail", String(notifyEmail));
    const body = await this.client.json("/api/v1/pdf-translations", { method: "POST", body: form, idempotencyKey });
    return { id: body.jobId, status: "running", type: "pdf-translate", ...body };
  }
}

class Reports {
  constructor(client) { this.client = client; }

  async create({ type, format = "docx", model, fields = {}, files = {}, idempotencyKey = randomUUID() }) {
    const form = new FormData();
    form.append("type", type);
    form.append("format", format);
    if (model) form.append("model", model);
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    for (const [field, values] of Object.entries(files)) {
      for (const file of Array.isArray(values) ? values : [values]) await appendFile(form, field, file);
    }
    const body = await this.client.json("/api/v1/reports", { method: "POST", body: form, idempotencyKey });
    return { id: body.jobId, status: "running", type, ...body };
  }
}

class Conversions {
  constructor(client) { this.client = client; }

  async docxToHwpx(file, destination) {
    const form = new FormData();
    await appendFile(form, "docx", file, ".docx");
    const response = await this.client.request("/api/v1/conversions/docx-to-hwpx", { method: "POST", body: form });
    const output = path.resolve(String(destination));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
    return output;
  }
}

class Studios {
  constructor(client) { this.client = client; }

  vibeConfig() {
    return this.client.json("/api/v1/studios/vibe/config");
  }

  generateVibe(idea, options = {}) {
    return this.client.jsonBody("/api/v1/studios/vibe/generate", { idea, ...options });
  }

  refineVibe(message, result, { history = [], model } = {}) {
    return this.client.jsonBody("/api/v1/studios/vibe/refine", { message, result, history, ...(model ? { model } : {}) });
  }

  generatePhysics(topic, options = {}) {
    return this.client.jsonBody("/api/v1/studios/physics/generate", { topic, ...options });
  }
}

class FileChat {
  constructor(client) { this.client = client; }

  access() {
    return this.client.json("/api/v1/file-chat/access");
  }

  async message(message, { files = [], history = [], model } = {}) {
    const form = new FormData();
    form.append("message", message);
    form.append("messages", JSON.stringify(history));
    if (model) form.append("model", model);
    for (const file of files) await appendFile(form, "files", file);
    const response = await this.client.request("/api/v1/file-chat/messages", {
      method: "POST",
      body: form,
      headers: { accept: "text/plain" },
    });
    return response.text();
  }
}

class Knowledge {
  constructor(client) { this.client = client; }

  async lab() {
    return (await this.client.json("/api/v1/knowledge/lab")).entries || [];
  }

  labEntry(id) {
    return this.client.json(`/api/v1/knowledge/lab/${encodeURIComponent(id)}`);
  }
}

class Community {
  constructor(client) { this.client = client; }

  async posts({ category } = {}) {
    const suffix = category ? `?category=${encodeURIComponent(category)}` : "";
    return (await this.client.json(`/api/v1/community/posts${suffix}`)).posts || [];
  }

  createPost({ title, body, category = "suggestion" }) {
    return this.client.jsonBody("/api/v1/community/posts", { title, body, category });
  }

  async comments(postId) {
    return (await this.client.json(`/api/v1/community/posts/${encodeURIComponent(postId)}/comments`)).comments || [];
  }

  createComment(postId, body) {
    return this.client.jsonBody(`/api/v1/community/posts/${encodeURIComponent(postId)}/comments`, { body });
  }

  vote(postId) {
    return this.client.jsonBody(`/api/v1/community/posts/${encodeURIComponent(postId)}/vote`);
  }
}

async function appendFile(form, field, input, extension) {
  const resolved = path.resolve(String(input));
  if (extension && path.extname(resolved).toLowerCase() !== extension) {
    throw new QuiloError(`Expected a ${extension} file: ${resolved}`);
  }
  const bytes = await fs.readFile(resolved);
  form.append(field, new Blob([bytes]), path.basename(resolved));
}

async function throwResponseError(response) {
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { error: raw.slice(0, 1000) }; }
  const message = typeof body.error === "string" ? body.error : body.error?.message || `Quilo returned HTTP ${response.status}`;
  throw new QuiloError(message, {
    status: response.status,
    code: body.code,
    requestId: body.requestId || response.headers.get("x-request-id"),
    body,
  });
}
