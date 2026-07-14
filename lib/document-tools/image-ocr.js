"use strict";

const path = require("node:path");
const sharp = require("sharp");

const OCR_BASE_URL = String(process.env.MISTRAL_API_BASE || "https://api.mistral.ai/v1").replace(/\/+$/, "");
const OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-4-0";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 19 * 1024 * 1024;
const MAX_IMAGE_PIXELS = Math.max(1, parseInt(process.env.IMAGE_OCR_MAX_PIXELS || "80000000", 10));
const MAX_IMAGE_EDGE = Math.max(1800, Math.min(8000, parseInt(process.env.IMAGE_OCR_MAX_EDGE || "6000", 10)));
const RETRY_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.IMAGE_OCR_RETRY_CONFIDENCE || 0.9)));
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".avif"]);

class OcrInputError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "OcrInputError";
    this.status = status;
  }
}

function originalBuffer(file) {
  const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || []);
  if (!buffer.length) throw new OcrInputError("비어 있는 이미지입니다.");
  if (buffer.length > MAX_IMAGE_BYTES) throw new OcrInputError("이미지는 20MB 이하만 지원합니다.", 413);
  const name = String(file?.originalname || file?.name || "image");
  const ext = path.extname(name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext) && !String(file?.mimetype || "").startsWith("image/")) {
    throw new OcrInputError("PNG, JPG, WEBP, GIF, TIFF, BMP, AVIF 이미지만 지원합니다.");
  }
  return { buffer, name };
}

function pipelineFor(buffer, { enhanced = false, edge = MAX_IMAGE_EDGE } = {}) {
  let pipeline = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: edge,
      height: edge,
      fit: "inside",
      withoutEnlargement: true,
    });
  if (enhanced) {
    pipeline = pipeline
      .greyscale()
      .normalize({ lower: 1, upper: 99 })
      .sharpen({ sigma: 1, m1: 0.7, m2: 1.5 });
  }
  return pipeline;
}

async function prepareImageForOcr(file, { enhanced = false } = {}) {
  const { buffer, name } = originalBuffer(file);
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false }).metadata();
  } catch (error) {
    throw new OcrInputError(`이미지를 읽을 수 없습니다: ${error.message}`);
  }
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  if (!width || !height) throw new OcrInputError("이미지 크기를 확인할 수 없습니다.");

  const screenshotLike = ["png", "gif", "tiff", "svg"].includes(String(metadata.format || "")) && !enhanced;
  let output;
  let mediaType;
  try {
    if (screenshotLike) {
      output = await pipelineFor(buffer, { enhanced, edge: MAX_IMAGE_EDGE })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
      mediaType = "image/png";
    } else {
      output = await pipelineFor(buffer, { enhanced, edge: MAX_IMAGE_EDGE })
        .jpeg({ quality: enhanced ? 94 : 96, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      mediaType = "image/jpeg";
    }

    if (output.length > TARGET_IMAGE_BYTES) {
      let reduced = null;
      for (const edge of [5200, 4400, 3600, 3000, 2400]) {
        for (const quality of [92, 86, 80, 72]) {
          const candidate = await pipelineFor(buffer, { enhanced, edge })
            .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
            .toBuffer();
          if (candidate.length <= TARGET_IMAGE_BYTES) {
            reduced = candidate;
            break;
          }
        }
        if (reduced) break;
      }
      if (!reduced) throw new OcrInputError("OCR 제공자 제한(20MB)에 맞게 이미지를 최적화하지 못했습니다.", 413);
      output = reduced;
      mediaType = "image/jpeg";
    }
  } catch (error) {
    if (error instanceof OcrInputError) throw error;
    throw new OcrInputError(`OCR 이미지 전처리에 실패했습니다: ${error.message}`);
  }

  return {
    buffer: output,
    mediaType,
    name,
    originalBytes: buffer.length,
    finalBytes: output.length,
    originalWidth: width,
    originalHeight: height,
    enhanced,
  };
}

function providerError(payload, status) {
  const detail = payload?.message || payload?.detail || payload?.error?.message || payload?.error;
  return String(detail || `OCR 제공자 오류(${status})`).slice(0, 500);
}

async function requestOcr(prepared, {
  apiKey,
  baseUrl = OCR_BASE_URL,
  model = OCR_MODEL,
  fetchImpl = globalThis.fetch,
  includeBlocks = true,
  tableFormat = "markdown",
  signal,
  timeoutMs = 150_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("OCR 요청 기능을 사용할 수 없습니다.");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("OCR timeout")), timeoutMs);
  try {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/ocr`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        document: {
          type: "image_url",
          image_url: `data:${prepared.mediaType};base64,${prepared.buffer.toString("base64")}`,
        },
        include_blocks: !!includeBlocks,
        include_image_base64: false,
        confidence_scores_granularity: "word",
        table_format: tableFormat === "html" ? "html" : "markdown",
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(providerError(payload, response.status));
    if (!Array.isArray(payload.pages) || !payload.pages.length) {
      throw new Error("OCR 결과에 페이지가 없습니다.");
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      const timeout = new Error("이미지 OCR 처리 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function confidenceFromPayload(payload) {
  const pageScores = [];
  const minimumScores = [];
  const wordScores = [];
  for (const page of payload?.pages || []) {
    const scores = page?.confidence_scores || {};
    const average = Number(scores.average_page_confidence_score);
    const minimum = Number(scores.minimum_page_confidence_score);
    if (Number.isFinite(average)) pageScores.push(average);
    if (Number.isFinite(minimum)) minimumScores.push(minimum);
    for (const word of scores.word_confidence_scores || []) {
      const value = Number(word?.confidence != null ? word.confidence : word?.score);
      if (Number.isFinite(value)) wordScores.push(value);
    }
  }
  const average = wordScores.length
    ? wordScores.reduce((sum, value) => sum + value, 0) / wordScores.length
    : pageScores.length
      ? pageScores.reduce((sum, value) => sum + value, 0) / pageScores.length
      : null;
  const minima = minimumScores.length ? minimumScores : wordScores;
  return {
    average: average == null ? null : Math.max(0, Math.min(1, average)),
    minimum: minima.length ? Math.max(0, Math.min(1, Math.min(...minima))) : null,
    words: wordScores.length,
  };
}

function textFromPayload(payload) {
  return (payload?.pages || []).map((page) => String(page?.markdown || "")).join("\n\n").trim();
}

function payloadScore(payload) {
  const confidence = confidenceFromPayload(payload).average;
  const visibleChars = textFromPayload(payload).replace(/\s|[#*|`_~-]/g, "").length;
  return (confidence == null ? 0.5 : confidence) * 1000 + Math.min(visibleChars, 5000) / 5000;
}

function shouldRetryEnhanced(payload) {
  const confidence = confidenceFromPayload(payload).average;
  const visibleChars = textFromPayload(payload).replace(/\s|[#*|`_~-]/g, "").length;
  return (confidence != null && confidence < RETRY_CONFIDENCE) || visibleChars < 12;
}

function normalizePage(page, index, includeBlocks) {
  const scores = page?.confidence_scores || null;
  return {
    page: Number.isInteger(page?.index) ? page.index + 1 : index + 1,
    markdown: String(page?.markdown || ""),
    ...(Array.isArray(page?.tables) ? { tables: page.tables } : {}),
    ...(includeBlocks && Array.isArray(page?.blocks) ? { blocks: page.blocks } : {}),
    ...(page?.dimensions ? { dimensions: page.dimensions } : {}),
    ...(scores ? {
      confidence: {
        average: Number.isFinite(Number(scores.average_page_confidence_score))
          ? Number(scores.average_page_confidence_score)
          : null,
        minimum: Number.isFinite(Number(scores.minimum_page_confidence_score))
          ? Number(scores.minimum_page_confidence_score)
          : null,
      },
    } : {}),
  };
}

async function extractImageText(file, {
  includeBlocks = true,
  tableFormat = "markdown",
  mode = "accurate",
  signal,
  apiKey = process.env.MISTRAL_API_KEY,
  fetchImpl = globalThis.fetch,
  baseUrl = OCR_BASE_URL,
  model = OCR_MODEL,
} = {}) {
  if (!apiKey) throw new Error("MISTRAL_API_KEY가 설정되지 않았습니다.");
  const prepared = await prepareImageForOcr(file);
  const requestOptions = { apiKey, baseUrl, model, fetchImpl, includeBlocks, tableFormat, signal };
  const first = await requestOcr(prepared, requestOptions);
  let selected = first;
  let selectedPrepared = prepared;
  let passes = 1;
  let enhancedRetry = false;
  let enhancedRetryWarning = "";

  if (mode !== "fast" && shouldRetryEnhanced(first)) {
    try {
      const enhanced = await prepareImageForOcr(file, { enhanced: true });
      const second = await requestOcr(enhanced, requestOptions);
      passes = 2;
      enhancedRetry = true;
      if (payloadScore(second) > payloadScore(first)) {
        selected = second;
        selectedPrepared = enhanced;
      }
    } catch (error) {
      // The first provider response is still useful.  A rate limit or a
      // preprocessing failure in the optional accuracy pass must not discard it.
      enhancedRetryWarning = String(error?.message || "정밀 재판독을 완료하지 못했습니다.").slice(0, 180);
    }
  }

  const pages = selected.pages.map((page, index) => normalizePage(page, index, includeBlocks));
  const confidence = confidenceFromPayload(selected);
  return {
    model: selected.model || model,
    pages,
    text: pages.map((page) => page.markdown).join("\n\n").trim(),
    confidence,
    usage: selected.usage_info || null,
    source: {
      filename: selectedPrepared.name,
      originalBytes: selectedPrepared.originalBytes,
      processedBytes: selectedPrepared.finalBytes,
      width: selectedPrepared.originalWidth,
      height: selectedPrepared.originalHeight,
      enhanced: selectedPrepared.enhanced,
      enhancedRetry,
      ...(enhancedRetryWarning ? { enhancedRetryWarning } : {}),
      passes,
    },
  };
}

module.exports = {
  MAX_IMAGE_BYTES,
  OcrInputError,
  confidenceFromPayload,
  extractImageText,
  prepareImageForOcr,
};
