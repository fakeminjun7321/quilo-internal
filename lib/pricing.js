// Anthropic API pricing (USD per 1M tokens).
// 공식 가격: https://www.anthropic.com/pricing
// 가격 바뀌면 여기만 수정하면 됨.
const PRICING = {
  "claude-opus-4-5": {
    input: 15,
    output: 75,
    cache_write: 18.75,
    cache_read: 1.5,
  },
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cache_write: 18.75,
    cache_read: 1.5,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cache_write: 1.25,
    cache_read: 0.1,
  },
};

// Web search 도구 비용 (검색 1회당 USD)
const WEB_SEARCH_PRICE = 0.01;

function getPrices(model) {
  // 모델명 정규화 (버전 suffix 등 제거)
  const normalized = (model || "").toLowerCase().replace(/\[.*?\]/g, "");
  for (const key of Object.keys(PRICING)) {
    if (normalized.startsWith(key)) return PRICING[key];
  }
  // Default = Opus pricing (보수적으로)
  return PRICING["claude-opus-4-5"];
}

function calcCost({ usage, webSearchCount = 0, model }) {
  const p = getPrices(model);
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage?.cache_read_input_tokens || 0;

  const inputCost = (inputTokens / 1_000_000) * p.input;
  const outputCost = (outputTokens / 1_000_000) * p.output;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * p.cache_write;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * p.cache_read;
  const webSearchCost = webSearchCount * WEB_SEARCH_PRICE;

  const total =
    inputCost + outputCost + cacheWriteCost + cacheReadCost + webSearchCost;

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    webSearchCount,
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    webSearchCost,
    total,
    model,
  };
}

function fmtUSD(amount) {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}

function fmtKRW(usd, rate = 1400) {
  return `≈ ${Math.round(usd * rate).toLocaleString()}원`;
}

function fmtTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatCostLine(cost) {
  const parts = [
    `입력 ${fmtTokens(cost.inputTokens)}토큰`,
    `출력 ${fmtTokens(cost.outputTokens)}토큰`,
  ];
  if (cost.cacheReadTokens > 0)
    parts.push(`캐시읽기 ${fmtTokens(cost.cacheReadTokens)}토큰`);
  if (cost.cacheWriteTokens > 0)
    parts.push(`캐시쓰기 ${fmtTokens(cost.cacheWriteTokens)}토큰`);
  if (cost.webSearchCount > 0) parts.push(`웹검색 ${cost.webSearchCount}회`);
  return `💰 비용: ${fmtUSD(cost.total)} ${fmtKRW(cost.total)} (${parts.join(", ")})`;
}

module.exports = {
  calcCost,
  formatCostLine,
  fmtUSD,
  fmtKRW,
  fmtTokens,
};
