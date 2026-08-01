import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../store/memory-store.js";
import { claimMarketReward, executeMarketOrder, marketSnapshot, virtualPrice } from "./virtual-market.js";

const config = { classCode: "2-4", className: "2학년 4반", timezone: "Asia/Seoul" };
const at = new Date("2026-08-01T12:00:00+09:00");

test("가상 시세는 허구 종목과 날짜에 대해 결정적이며 양수이다", () => {
  assert.equal(virtualPrice("QLR", at), virtualPrice("QLR", at));
  assert.ok(virtualPrice("QLR", at) > 0);
  assert.throws(() => virtualPrice("AAPL", at), /존재하지 않는 가상 종목/);
});

test("접속 보상은 하루 한 번만 지급되고 매수·매도는 잔액과 보유량을 원자적으로 바꾼다", async () => {
  const store = new MemoryStore(config);
  const memberId = store.members[0].id;
  let snapshot = await marketSnapshot(store, memberId, at);
  assert.equal(snapshot.account.balance, 1000);
  assert.equal(snapshot.reward.claimed_today, false);

  snapshot = await claimMarketReward(store, memberId, at);
  assert.equal(snapshot.account.balance, 1100);
  assert.equal(snapshot.reward.claimed_today, true);
  snapshot = await claimMarketReward(store, memberId, at);
  assert.equal(snapshot.account.balance, 1100);

  const price = virtualPrice("QLR", at);
  snapshot = await executeMarketOrder(store, memberId, { symbol: "QLR", side: "buy", quantity: 2, requestKey: "order-1" }, at);
  assert.equal(snapshot.account.balance, 1100 - price * 2);
  assert.equal(snapshot.positions.find((item) => item.symbol === "QLR").owned_quantity, 2);

  snapshot = await executeMarketOrder(store, memberId, { symbol: "QLR", side: "buy", quantity: 2, requestKey: "order-1" }, at);
  assert.equal(snapshot.positions.find((item) => item.symbol === "QLR").owned_quantity, 2);

  snapshot = await executeMarketOrder(store, memberId, { symbol: "QLR", side: "sell", quantity: 1, requestKey: "order-2" }, at);
  assert.equal(snapshot.positions.find((item) => item.symbol === "QLR").owned_quantity, 1);
  assert.equal(snapshot.account.balance, 1100 - price);
});

test("잔액보다 큰 매수와 보유량보다 큰 매도는 거부한다", async () => {
  const store = new MemoryStore(config);
  const memberId = store.members[0].id;
  await assert.rejects(
    executeMarketOrder(store, memberId, { symbol: "QLR", side: "buy", quantity: 1000, requestKey: "too-big" }, at),
    /토큰이 부족/,
  );
  await assert.rejects(
    executeMarketOrder(store, memberId, { symbol: "QLR", side: "sell", quantity: 1, requestKey: "no-stock" }, at),
    /보유 수량이 부족/,
  );
});
