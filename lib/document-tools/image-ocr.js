"use strict";

const { prepareImageForAnthropic } = require("../anthropic-media");

const OCR_URL = `${String(process.env.MISTRAL_API_BASE || "https://api.mistral.ai/v1").replace(/\/+$/, "")}/ocr`;
const OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-4-0";

async function extractImageText(file, { includeBlocks = false, signal } = {}) {
  if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY가 설정되지 않았습니다.");
  const prepared = await prepareImageForAnthropic(file, { forceCompress: false, maxEdge: 4096 });
  if (!prepared.ok) throw new Error(prepared.reason || "이미지를 처리할 수 없습니다.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const abort = () => controller.abort();
  if (signal) signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(OCR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        document: {
          type: "image_url",
          image_url: `data:${prepared.mediaType};base64,${prepared.buffer.toString("base64")}`,
        },
        include_blocks: !!includeBlocks,
        include_image_base64: false,
        confidence_scores_granularity: "page",
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || payload?.detail || payload?.error || `OCR 제공자 오류(${response.status})`;
      throw new Error(String(message).slice(0, 500));
    }
    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    if (!pages.length) throw new Error("OCR 결과에 페이지가 없습니다.");
    return {
      model: payload.model || OCR_MODEL,
      pages: pages.map((page, index) => ({
        page: index + 1,
        markdown: String(page.markdown || ""),
        ...(includeBlocks && Array.isArray(page.blocks) ? { blocks: page.blocks } : {}),
        ...(page.confidence != null ? { confidence: page.confidence } : {}),
      })),
      text: pages.map((page) => String(page.markdown || "")).join("\n\n").trim(),
      usage: payload.usage_info || null,
      source: {
        filename: prepared.name,
        originalBytes: prepared.originalBytes,
        processedBytes: prepared.finalBytes,
        compressed: prepared.compressed,
      },
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}

module.exports = { extractImageText };
