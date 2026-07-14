"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const sharp = require("sharp");
const { createOcrExport, markdownToBlocks, markdownToPlain } = require("../lib/document-tools/ocr-export");

async function scanImage() {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: "white" } })
    .composite([{
      input: Buffer.from('<svg width="900" height="1200"><text x="65" y="150" font-size="58">Quilo 스캔 123</text><rect x="100" y="700" width="320" height="220" fill="#d7e7ff" stroke="#2563eb" stroke-width="8"/><text x="145" y="820" font-size="42">원본 그림</text></svg>'),
    }])
    .png()
    .toBuffer();
}

function ocrResult() {
  return {
    text: "# 스캔 제목\n\n본문 **강조**와 수식 $x^2$입니다.\n\n| 항목 | 값 |\n| --- | --- |\n| 질량 | 12 g |\n\n- 첫째\n- 둘째\n\n<script>alert('unsafe')</script>",
    confidence: { average: 0.98, minimum: 0.91 },
    quality: { agreement: 0.96 },
    pages: [{
      page: 1,
      dimensions: { width: 900, height: 1200 },
      images: [{ id: "figure-1", topLeftX: 100, topLeftY: 700, bottomRightX: 420, bottomRightY: 920, annotation: "파란 원본 그림" }],
    }],
  };
}

test("OCR markdown is converted into editable paragraphs, lists, tables, and clean text", () => {
  const blocks = markdownToBlocks(ocrResult().text);
  assert.ok(blocks.some((block) => block?.subheading === "스캔 제목"));
  assert.ok(blocks.some((block) => block?.table?.headers?.[0] === "항목"));
  assert.ok(blocks.some((block) => block?.list?.length === 2));
  const plain = markdownToPlain(ocrResult().text);
  assert.match(plain, /스캔 제목/);
  assert.doesNotMatch(plain, /^#/m);
  assert.doesNotMatch(plain, /<script>/);
  const htmlTable = markdownToBlocks("<table><tr><th>이름</th><th>값</th></tr><tr><td>길이</td><td>12 cm</td></tr></table>");
  assert.equal(htmlTable[0].table.headers[0], "이름");
  assert.equal(htmlTable[0].table.rows[0][1], "12 cm");
});

test("TXT and self-contained HTML exports preserve text safely and embed the scan", async () => {
  const image = await scanImage();
  const file = { buffer: image, originalname: "수학 스캔.png", mimetype: "image/png" };
  const txt = await createOcrExport(file, ocrResult(), "txt");
  assert.equal(txt.sourceImageEmbedded, false);
  assert.match(txt.buffer.toString("utf8"), /스캔 제목/);
  assert.doesNotMatch(txt.buffer.toString("utf8"), /<script>/);

  const html = await createOcrExport(file, ocrResult(), "html");
  const source = html.buffer.toString("utf8");
  assert.equal(html.sourceImageEmbedded, true);
  assert.equal(html.detectedImagesEmbedded, 1);
  assert.match(source, /data:image\/png;base64,/);
  assert.match(source, /감지된 원본 그림/);
  assert.match(source, /alert\(&#39;unsafe&#39;\)/);
  assert.doesNotMatch(source, /<script>alert/);
});

test("DOCX export contains editable OCR text and actual image media", async () => {
  const image = await scanImage();
  const exported = await createOcrExport({ buffer: image, originalname: "scan.png", mimetype: "image/png" }, ocrResult(), "docx");
  const zip = await JSZip.loadAsync(exported.buffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  const media = Object.keys(zip.files).filter((name) => /^word\/media\//.test(name));
  assert.match(documentXml, /스캔 제목/);
  assert.match(documentXml, /질량/);
  assert.ok(media.length >= 2, `expected source scan and detected crop, got ${media.length}`);
  assert.equal(exported.sourceImageEmbedded, true);
  assert.equal(exported.detectedImagesEmbedded, 1);
});

test("HWPX export contains preview text and embedded image binaries", { timeout: 30_000 }, async () => {
  const image = await scanImage();
  const exported = await createOcrExport({ buffer: image, originalname: "scan.png", mimetype: "image/png" }, ocrResult(), "hwpx");
  const zip = await JSZip.loadAsync(exported.buffer);
  const preview = await zip.file("Preview/PrvText.txt").async("string");
  const binaries = Object.keys(zip.files).filter((name) => /^BinData\//.test(name) && !zip.files[name].dir);
  assert.match(preview, /스캔 제목/);
  assert.ok(binaries.length >= 2, `expected source scan and detected crop, got ${binaries.length}`);
  assert.equal(exported.sourceImageEmbedded, true);
});
