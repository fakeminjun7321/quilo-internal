import { getSeoulParts } from "../time.js";

export const STARTING_TOKENS = 1000;
export const DAILY_REWARD_TOKENS = 100;

export const VIRTUAL_INSTRUMENTS = Object.freeze([
  { symbol: "QLR", name: "퀼로랩", basePrice: 126, tone: "blue" },
  { symbol: "BLW", name: "블루웨이브", basePrice: 98, tone: "slate" },
  { symbol: "NXT", name: "넥스트셀", basePrice: 143, tone: "green" },
  { symbol: "GCR", name: "그린코어", basePrice: 72, tone: "teal" },
  { symbol: "SPW", name: "스파크웍스", basePrice: 57, tone: "violet" },
]);

const INSTRUMENT_BY_SYMBOL = new Map(VIRTUAL_INSTRUMENTS.map((item) => [item.symbol, item]));
const DAY_MS = 86_400_000;
const MARKET_EPOCH = Date.UTC(2026, 0, 1);

function hashNumber(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateKeyFor(value) {
  return getSeoulParts(value instanceof Date ? value : new Date(value)).dateKey;
}

function dayNumber(dateKey) {
  return Math.floor((Date.parse(`${dateKey}T00:00:00Z`) - MARKET_EPOCH) / DAY_MS);
}

function dateKeyWithOffset(dateKey, offset) {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  return getSeoulParts(new Date(date.getTime() + offset * DAY_MS)).dateKey;
}

export function virtualPrice(symbol, at = new Date()) {
  const instrument = INSTRUMENT_BY_SYMBOL.get(String(symbol || "").toUpperCase());
  if (!instrument) throw new Error("존재하지 않는 가상 종목입니다.");
  const dateKey = dateKeyFor(at);
  const day = dayNumber(dateKey);
  const seed = hashNumber(instrument.symbol) % 31;
  const wave = Math.sin((day + seed) * 0.19) * instrument.basePrice * 0.055;
  const longWave = Math.cos((day + seed * 3) * 0.047) * instrument.basePrice * 0.035;
  const noise = ((hashNumber(`${instrument.symbol}:${dateKey}`) % 9) - 4) * 0.65;
  return Math.max(10, Math.round(instrument.basePrice + wave + longWave + noise));
}

export function validateVirtualOrder(input) {
  const symbol = String(input?.symbol || "").trim().toUpperCase();
  const side = String(input?.side || "").trim().toLowerCase();
  const quantity = Number(input?.quantity);
  if (!INSTRUMENT_BY_SYMBOL.has(symbol)) throw new Error("존재하지 않는 가상 종목입니다.");
  if (!new Set(["buy", "sell"]).has(side)) throw new Error("매수 또는 매도를 선택해 주세요.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw new Error("주문 수량은 1~1000주 사이의 정수여야 합니다.");
  }
  return { symbol, side, quantity };
}

function priceHistory(symbol, dateKey, days = 21) {
  return Array.from({ length: days }, (_, index) => {
    const key = dateKeyWithOffset(dateKey, index - days + 1);
    return { date: key, price: virtualPrice(symbol, new Date(`${key}T12:00:00+09:00`)) };
  });
}

export async function marketSnapshot(store, memberId, at = new Date()) {
  const dateKey = dateKeyFor(at);
  const state = await store.getMarketState(memberId);
  const positionsBySymbol = new Map((state.positions || []).map((item) => [item.symbol, item]));
  const instruments = VIRTUAL_INSTRUMENTS.map((instrument) => {
    const price = virtualPrice(instrument.symbol, at);
    const previousKey = dateKeyWithOffset(dateKey, -1);
    const previousPrice = virtualPrice(instrument.symbol, new Date(`${previousKey}T12:00:00+09:00`));
    const position = positionsBySymbol.get(instrument.symbol);
    const quantity = Number(position?.quantity || 0);
    const averageCost = Number(position?.average_cost || 0);
    return {
      ...instrument,
      price,
      change: price - previousPrice,
      change_percent: previousPrice ? Number((((price - previousPrice) / previousPrice) * 100).toFixed(2)) : 0,
      owned_quantity: quantity,
      average_cost: averageCost,
      market_value: quantity * price,
      profit_loss: quantity * (price - averageCost),
      history: priceHistory(instrument.symbol, dateKey),
    };
  });
  const positions = instruments.filter((item) => item.owned_quantity > 0);
  const marketValue = positions.reduce((sum, item) => sum + item.market_value, 0);
  const costBasis = positions.reduce((sum, item) => sum + item.average_cost * item.owned_quantity, 0);
  const profitLoss = marketValue - costBasis;
  const balance = Number(state.account?.balance ?? STARTING_TOKENS);
  const rewardKey = `daily:${dateKey}`;
  return {
    as_of: dateKey,
    currency: "TKN",
    play_money_only: true,
    reward: {
      amount: DAILY_REWARD_TOKENS,
      claimed_today: (state.ledger || []).some((entry) => entry.reference_key === rewardKey),
    },
    account: {
      balance,
      market_value: marketValue,
      total_assets: balance + marketValue,
      profit_loss: profitLoss,
      return_percent: costBasis ? Number(((profitLoss / costBasis) * 100).toFixed(2)) : 0,
    },
    instruments,
    positions,
    activity: (state.ledger || []).slice(0, 20),
    trades: (state.trades || []).slice(0, 20),
  };
}

export async function claimMarketReward(store, memberId, at = new Date()) {
  const dateKey = dateKeyFor(at);
  await store.claimDailyMarketReward({
    memberId,
    dateKey,
    amount: DAILY_REWARD_TOKENS,
  });
  return marketSnapshot(store, memberId, at);
}

export async function executeMarketOrder(store, memberId, input, at = new Date()) {
  const order = validateVirtualOrder(input);
  const requestKey = String(input?.requestKey || "").trim();
  if (!requestKey || requestKey.length > 160) throw new Error("안전한 주문 처리를 위해 Idempotency-Key가 필요합니다.");
  const price = virtualPrice(order.symbol, at);
  await store.executeMarketTrade({ memberId, ...order, price, requestKey });
  return marketSnapshot(store, memberId, at);
}
