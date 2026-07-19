const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertGeneratedOutputMagic,
  assertCompletePdf,
  normalizeGeneratedArtifact,
  validateReportArtifact,
} = require("../lib/output-validate");

const ROOT = path.resolve(__dirname, "..");

function minimalPdf(extra = "") {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\ntrailer\n<<>>\n%%EOF\n`,
    "latin1",
  );
}

test("legacy PDF magic stays compatible while restored artifacts require EOF", () => {
  const valid = minimalPdf();
  assert.equal(assertGeneratedOutputMagic(valid, "pdf"), valid);
  assert.throws(
    () => assertGeneratedOutputMagic(Buffer.from("not-a-pdf"), "pdf"),
    /expected PDF output to start with %PDF-/,
  );
  assert.doesNotThrow(() =>
    assertGeneratedOutputMagic(Buffer.from("%PDF-1.4\nlegacy-fixture"), "pdf"),
  );
  assert.throws(
    () => assertCompletePdf(Buffer.from("%PDF-1.4\ntruncated")),
    /missing a trailing %%EOF marker/,
  );
});

test("PDF artifact normalization forces safe filename and MIME type", () => {
  const result = normalizeGeneratedArtifact(
    {
      buffer: minimalPdf(),
      filename: "../../복원본\r\nContent-Type: text/html.docx",
      mimeType: "text/html",
      qa: { ok: true, ocrPages: 2 },
    },
    { kind: "pdf", fallbackFilename: "fallback.pdf" },
  );
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.filename, "html.pdf");
  assert.doesNotMatch(result.filename, /[\\/\r\n:]/);
  assert.deepEqual(result.qa, { ok: true, ocrPages: 2 });
  assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("raw PDF buffers use the server fallback filename", () => {
  const result = normalizeGeneratedArtifact(minimalPdf(), {
    kind: "pdf",
    fallbackFilename: "프린트복원_현대물리학.pdf",
  });
  assert.equal(result.filename, "프린트복원_현대물리학.pdf");
  assert.equal(result.qa, null);
});

test("deep artifact validation reports malformed PDF without throwing", async () => {
  const check = await validateReportArtifact(Buffer.from("%PDF-1.4\ntruncated"), {
    format: "pdf",
    type: "print-pdf-restore",
  });
  assert.equal(check.ok, false);
  assert.equal(check.problems[0].rule, "pdf-structure");
});

test("server contract keeps print restoration admin-only with fixed PDF output", () => {
  const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(source, /"print-pdf-restore"\s*:\s*\{/);
  assert.match(source, /const ADMIN_ONLY_REPORT_TYPES = new Set\(\["print-pdf-restore"\]\)/);
  assert.match(source, /outputKind:\s*"pdf"/);
  assert.match(source, /requireArtifactQa:\s*true/);
  assert.match(source, /pipeline\.outputKind === "pdf"[\s\S]{0,120}\? "pdf"/);
  assert.match(source, /typeof pipeline\.generatePdf !== "function"/);
  assert.match(source, /restoreQa\.visualPassed === true/);
  assert.match(source, /restoreQa\.renderedDpi === 300/);
  assert.match(source, /restoreQa\.pageCount === expectedRestorePages/);
  assert.match(source, /Number\.isFinite\(restoreQa\.ocrCoverage\)/);
  assert.match(source, /isAdmin = !!freshUser\.is_admin/);
  assert.match(source, /req\.session\.userInfo\.isAdmin = isAdmin/);
  assert.match(source, /const reportEligible = isAdmin \|\| \(emailVerified && approved\)/);
});
