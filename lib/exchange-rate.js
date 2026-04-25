// KRW ↔ USD 환율 변환. frankfurter.app 무료 API 사용 (가입 불필요).
// 메모리 캐시 1시간.

const CACHE_TTL_MS = 60 * 60 * 1000;
const FALLBACK_KRW_PER_USD = 1400; // API 실패 시 폴백 환율

let cache = { rate: null, fetchedAt: 0 };

/**
 * 1 USD = X KRW 비율을 반환. 실패 시 FALLBACK_KRW_PER_USD.
 */
async function getKrwPerUsd() {
  const now = Date.now();
  if (cache.rate && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rate;
  }
  try {
    const resp = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=KRW",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rate = data?.rates?.KRW;
    if (typeof rate !== "number" || rate <= 0) throw new Error("invalid rate");
    cache = { rate, fetchedAt: now };
    return rate;
  } catch (e) {
    console.warn("[exchange-rate] frankfurter 실패, 폴백 환율 사용:", e.message);
    return FALLBACK_KRW_PER_USD;
  }
}

async function krwToUsd(krw) {
  const rate = await getKrwPerUsd();
  return Number(krw) / rate;
}

async function usdToKrw(usd) {
  const rate = await getKrwPerUsd();
  return Number(usd) * rate;
}

module.exports = { getKrwPerUsd, krwToUsd, usdToKrw };
