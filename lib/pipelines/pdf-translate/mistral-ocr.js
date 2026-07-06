// Mistral OCR — 스캔/깨진 PDF의 텍스트를 정확히 추출하는 OCR 엔진(선택).
//
// 목적: PDF 통번역의 비전 OCR 경로에서, 지금까지는 모델(Claude 비전)이 페이지 이미지를
// 직접 읽어 OCR+번역을 한 번에 했다. Mistral OCR($2/1000쪽)로 원문 텍스트를 먼저 정확히
// 뽑아 "번역 힌트(pageTexts)"로 넣으면 고유명사·숫자·코드 철자 정확도가 오르고 모델 부담이
// 준다. 결과는 기존 buildOcrHint 가 그대로 소비하는 `[{page, text}]` 형식.
//
// ⚠ 안전장치(사용자 요구): 이 API 가 안 되면(키 미설정·오류·용량초과) **반드시 기존 방식으로
// 폴백**한다. 그래서 이 모듈은 실패 시 throw 하고(호출부가 catch → pageTexts=null → 기존
// 비전 OCR), 애초에 미설정/과대용량이면 조용히 null 을 돌려 폴백하게 한다.

const MISTRAL_BASE = process.env.MISTRAL_API_BASE || "https://api.mistral.ai/v1";
const MISTRAL_OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest";
// 인라인(data URI) 전송 상한. 초과 문서는 Mistral 을 건너뛰고 기존 비전으로 폴백한다.
const MAX_MB = Math.max(1, parseInt(process.env.MISTRAL_OCR_MAX_MB || "45", 10));

function mistralKey() {
  return process.env.MISTRAL_API_KEY || "";
}
function mistralOcrConfigured() {
  return !!mistralKey();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function backoffMs(attempt) {
  return Math.min(15000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
}

// PDF 버퍼 → `[{page, text}]` (page 는 1-based). 힌트로 쓸 수 없으면 null.
// 실패(네트워크·API 오류)는 throw — 호출부가 catch 해 기존 비전 방식으로 폴백한다.
async function ocrPdfToPageTexts(pdfBuffer, { signal } = {}) {
  if (!mistralOcrConfigured()) return null; // 미설정 → 폴백
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) return null;
  const sizeMB = pdfBuffer.length / (1024 * 1024);
  if (sizeMB > MAX_MB) return null; // 과대용량 → 인라인 부적합, 폴백

  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
  const body = {
    model: MISTRAL_OCR_MODEL,
    document: { type: "document_url", document_url: dataUrl },
    include_image_base64: false,
  };

  const RETRYABLE = new Set([429, 500, 502, 503, 529]);
  const MAX_ATTEMPTS = 3;
  let raw = "";
  let status = 0;
  for (let attempt = 1; ; attempt++) {
    let resp;
    try {
      resp = await fetch(`${MISTRAL_BASE}/ocr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mistralKey()}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted || attempt >= MAX_ATTEMPTS) throw e;
      await sleep(backoffMs(attempt));
      continue;
    }
    status = resp.status;
    if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS && !signal?.aborted) {
      await sleep(backoffMs(attempt));
      continue;
    }
    raw = await resp.text();
    break;
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Mistral OCR ${status}: ${String(raw).slice(0, 200)}`);
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("Mistral OCR 응답을 해석할 수 없습니다.");
  }
  const pages = Array.isArray(j.pages) ? j.pages : [];
  const out = [];
  for (const p of pages) {
    // OCR 4는 index, 일부 버전은 page_number. markdown 이 본문.
    const idx = Number(
      p && (p.index != null ? p.index : p.page_number != null ? p.page_number : NaN),
    );
    const text = String((p && (p.markdown != null ? p.markdown : p.text)) || "").trim();
    if (!text) continue;
    // index 는 0-based 가 일반적 → 1-based page 로. 이미 1-based(page_number)면 그대로.
    const page = Number.isFinite(idx) ? (p.index != null ? idx + 1 : idx) : out.length + 1;
    out.push({ page, text });
  }
  return out.length ? out : null;
}

module.exports = { mistralOcrConfigured, ocrPdfToPageTexts, MAX_MB };
