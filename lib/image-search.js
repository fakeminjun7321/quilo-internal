// Google Custom Search API — image search.
// 환경변수 GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX 둘 다 있어야 동작.
// 없으면 null 반환 (호출자가 fallback 처리).

const MAX_BYTES = 5 * 1024 * 1024; // 5MB 이미지까지만
const FETCH_TIMEOUT_MS = 8000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function searchImage(query, { onProgress = () => {} } = {}) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null;

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    searchType: "image",
    num: "5",
    safe: "active",
  });
  const url = `https://www.googleapis.com/customsearch/v1?${params}`;

  let data;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = await resp.text();
      // Google API 에러는 JSON에 error.message + error.errors[0].reason 형태
      let reason = "";
      try {
        const errJson = JSON.parse(body);
        const e = errJson?.error;
        const r = e?.errors?.[0]?.reason || "";
        reason = `${e?.message || ""}${r ? ` [reason=${r}]` : ""}`;
      } catch {
        reason = body.slice(0, 200);
      }
      onProgress(`⚠ 이미지 검색 API ${resp.status}: ${reason}`);
      return null;
    }
    data = await resp.json();
    if ((data.items || []).length === 0) {
      onProgress(`⚠ 이미지 검색 결과 0건 (CSE가 이미지 모드 OFF이거나 쿼리에 결과 없음)`);
      return null;
    }
  } catch (e) {
    onProgress(`⚠ 이미지 검색 실패: ${e.message}`);
    return null;
  }

  const items = data.items || [];

  // Try each result, return first downloadable one
  let downloadFailures = 0;
  for (const item of items) {
    const dl = await tryDownload(item.link);
    if (dl) {
      return {
        buffer: dl.data,
        contentType: dl.contentType,
        sourceUrl: item.link,
        displayLink: item.displayLink || hostname(item.link),
        title: item.title || "",
      };
    }
    downloadFailures++;
  }
  onProgress(
    `⚠ 검색 결과 ${items.length}건 모두 다운로드 실패 (hotlink 차단·차단된 도메인·이미지 형식 불일치)`,
  );
  return null;
}

async function tryDownload(url) {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "image/*",
      },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ALLOWED_TYPES.some((t) => ct.startsWith(t))) return null;
    const cl = parseInt(resp.headers.get("content-length") || "0", 10);
    if (cl > MAX_BYTES) return null;

    const ab = await resp.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return null;
    return { data: Buffer.from(ab), contentType: ct };
  } catch {
    return null;
  }
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

module.exports = { searchImage };
