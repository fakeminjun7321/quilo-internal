"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");
const { extractImageText, prepareImageForOcr } = require("../lib/document-tools/image-ocr");

async function sampleImage() {
  return sharp({
    create: { width: 720, height: 360, channels: 3, background: "white" },
  }).composite([{
    input: Buffer.from('<svg width="720" height="360"><text x="45" y="150" font-size="56">Quilo OCR 123</text><rect x="40" y="190" width="620" height="3"/></svg>'),
  }]).png().toBuffer();
}

function payload(confidence, markdown, model = "mistral-ocr-4-0") {
  return {
    model,
    pages: [{
      index: 0,
      markdown,
      dimensions: { width: 720, height: 360, dpi: 200 },
      confidence_scores: {
        average_page_confidence_score: confidence,
        minimum_page_confidence_score: confidence - 0.05,
        word_confidence_scores: [{ text: "Quilo", start_index: 0, confidence }],
      },
      blocks: [{ type: "title", content: markdown, top_left_x: 0, top_left_y: 0, bottom_right_x: 100, bottom_right_y: 40 }],
      tables: [],
    }],
    usage_info: { pages_processed: 1 },
  };
}

test("OCR preprocessing keeps document images well above the old 2200px cap when possible", async () => {
  const input = await sharp({ create: { width: 3200, height: 1200, channels: 3, background: "white" } }).png().toBuffer();
  const prepared = await prepareImageForOcr({ buffer: input, originalname: "wide.png", mimetype: "image/png" });
  const meta = await sharp(prepared.buffer).metadata();
  assert.equal(meta.width, 3200);
  assert.equal(meta.height, 1200);
  assert.ok(prepared.finalBytes <= 19 * 1024 * 1024);
});

test("accurate OCR retries a low-confidence image and selects the better pass", async () => {
  const image = await sampleImage();
  const calls = [];
  const responses = [payload(0.62, "Quilo OCR 12?"), payload(0.97, "Quilo OCR 123")];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await extractImageText(
    { buffer: image, originalname: "scan.png", mimetype: "image/png" },
    { apiKey: "test-key", fetchImpl, mode: "accurate", includeBlocks: true },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].include_blocks, true);
  assert.equal(calls[0].confidence_scores_granularity, "word");
  assert.equal(calls[0].table_format, "markdown");
  assert.equal(result.text, "Quilo OCR 123");
  assert.equal(result.source.passes, 2);
  assert.equal(result.source.enhanced, true);
  assert.ok(result.confidence.average > 0.9);
  assert.equal(result.pages[0].blocks[0].type, "title");
});

test("fast OCR performs a single provider request", async () => {
  const image = await sampleImage();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify(payload(0.5, "빠른 판독")), { status: 200 });
  };
  const result = await extractImageText(
    { buffer: image, originalname: "fast.png", mimetype: "image/png" },
    { apiKey: "test-key", fetchImpl, mode: "fast" },
  );
  assert.equal(calls, 1);
  assert.equal(result.source.passes, 1);
});

test("an optional enhanced retry failure preserves the first OCR result", async () => {
  const image = await sampleImage();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 2) throw new Error("temporary rate limit");
    return new Response(JSON.stringify(payload(0.6, "첫 판독 보존")), { status: 200 });
  };
  const result = await extractImageText(
    { buffer: image, originalname: "retry.png", mimetype: "image/png" },
    { apiKey: "test-key", fetchImpl, mode: "accurate" },
  );
  assert.equal(calls, 2);
  assert.equal(result.text, "첫 판독 보존");
  assert.equal(result.source.passes, 1);
  assert.match(result.source.enhancedRetryWarning, /temporary rate limit/);
});
