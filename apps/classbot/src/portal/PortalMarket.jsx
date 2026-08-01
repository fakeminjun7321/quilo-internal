import { AlertTriangle, ArrowDownRight, ArrowUpRight, Coins, HelpCircle, RotateCw, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, createIdempotencyKey } from "../api/client.js";

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function signed(value, suffix = "") {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${number(numeric)}${suffix}`;
}

function Sparkline({ history, positive = true, large = false }) {
  const values = (history || []).map((item) => Number(item.price));
  const width = large ? 560 : 116;
  const height = large ? 170 : 38;
  if (values.length < 2) return <span className="market-spark-empty" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 6 - ((value - min) / spread) * (height - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <svg className={`market-sparkline ${large ? "large" : ""} ${positive ? "positive" : "negative"}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="가상 가격 추세"><polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg>;
}

function Metric({ label, value, suffix = "TKN", tone = "" }) {
  return <div className={`market-metric ${tone}`}><span>{label}</span><strong>{value} <small>{suffix}</small></strong></div>;
}

export default function PortalMarket() {
  const [data, setData] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState("QLR");
  const [side, setSide] = useState("buy");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { setData(await api.portalMarket()); }
    catch (err) { setError(err.message || "가상 시장을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const selected = useMemo(() => data?.instruments?.find((item) => item.symbol === selectedSymbol) || data?.instruments?.[0], [data, selectedSymbol]);
  const total = Number(selected?.price || 0) * Number(quantity || 0);
  const canOrder = selected && quantity >= 1 && quantity <= 1000
    && (side === "buy" ? data.account.balance >= total : selected.owned_quantity >= quantity);

  const claim = async () => {
    if (busy || data?.reward?.claimed_today) return;
    setBusy("reward"); setError(""); setMessage("");
    try { setData(await api.portalClaimMarketReward()); setMessage("오늘 접속 보상 100 TKN을 받았습니다."); }
    catch (err) { setError(err.message || "접속 보상을 받지 못했습니다."); }
    finally { setBusy(""); }
  };

  const order = async () => {
    if (busy || !canOrder) return;
    setBusy("order"); setError(""); setMessage("");
    try {
      const next = await api.portalMarketOrder({ symbol: selected.symbol, side, quantity }, { idempotencyKey: createIdempotencyKey("market-order") });
      setData(next);
      setMessage(`${selected.name} ${quantity}주를 ${side === "buy" ? "매수" : "매도"}했습니다.`);
      setQuantity(1);
    } catch (err) { setError(err.message || "주문을 처리하지 못했습니다."); }
    finally { setBusy(""); }
  };

  if (loading) return <section className="page market-page"><div className="market-state"><RotateCw className="spin" /><span>가상 시장을 불러오는 중</span></div></section>;
  if (!data || error && !data) return <section className="page market-page"><div className="market-state error"><AlertTriangle /><strong>가상 시장을 불러오지 못했습니다.</strong><p>{error}</p><button className="outline-button" onClick={load}>다시 시도</button></div></section>;

  return <section className="page market-page">
    <div className="market-heading">
      <div><h1>가상 주식</h1><p>Quilo 토큰으로 가볍게 즐기는 반 전용 모의 투자입니다.</p><span><ShieldCheck size={16} />놀이용 가상 시장 · 실제 주식·현금과 무관</span></div>
      <button className="market-help" title="실제 금융 상품이 아니며 TKN은 현금 가치가 없습니다." aria-label="가상 주식 안내"><HelpCircle size={21} /></button>
    </div>

    <div className="market-account-strip">
      <Metric label="내 토큰" value={number(data.account.balance)} />
      <Metric label="총 자산" value={number(data.account.total_assets)} />
      <Metric label="평가 수익률" value={signed(data.account.return_percent, "%")} suffix="" tone={data.account.return_percent >= 0 ? "gain" : "loss"} />
      <button className="primary-button market-reward" onClick={claim} disabled={busy === "reward" || data.reward.claimed_today}><Coins size={18} />{data.reward.claimed_today ? "오늘 보상 받음" : busy === "reward" ? "지급 중" : "오늘 접속 보상 받기"}</button>
    </div>

    {(error || message) && <div className={`market-feedback ${error ? "error" : "success"}`} role="status">{error ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}{error || message}</div>}

    <div className="market-main-grid">
      <section className="content-panel market-list-panel">
        <div className="section-line"><h2>시장 현황</h2><span>{data.as_of} 기준</span></div>
        <div className="market-table-head"><span>종목</span><span>현재가</span><span>등락</span><span>보유</span><span>추세</span></div>
        <div className="market-instruments">{data.instruments.map((instrument) => <button key={instrument.symbol} className={`market-instrument ${selected?.symbol === instrument.symbol ? "active" : ""}`} onClick={() => { setSelectedSymbol(instrument.symbol); setQuantity(1); }}>
          <span className={`market-symbol ${instrument.tone}`}>{instrument.symbol}</span>
          <span className="market-name"><strong>{instrument.name}</strong><small>{instrument.symbol}</small></span>
          <span className="market-price"><strong>{number(instrument.price)}</strong><small>TKN</small></span>
          <span className={instrument.change >= 0 ? "market-change gain" : "market-change loss"}>{instrument.change >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{signed(instrument.change)} ({signed(instrument.change_percent, "%")})</span>
          <span className="market-owned">{number(instrument.owned_quantity)}주</span>
          <Sparkline history={instrument.history} positive={instrument.change >= 0} />
        </button>)}</div>
      </section>

      <section className="content-panel market-order-panel">
        <div className="market-selected-head"><span><strong>{selected.name}</strong><small>{selected.symbol}</small></span><span><strong>{number(selected.price)} <small>TKN</small></strong><em className={selected.change >= 0 ? "gain" : "loss"}>{signed(selected.change)} ({signed(selected.change_percent, "%")})</em></span></div>
        <div className="market-chart"><Sparkline history={selected.history} positive={selected.change >= 0} large /><span>최근 21일 · 일별 가상 가격</span></div>
        <div className="market-side-tabs"><button className={side === "buy" ? "active" : ""} onClick={() => setSide("buy")}>매수</button><button className={side === "sell" ? "active" : ""} onClick={() => setSide("sell")}>매도</button></div>
        <div className="market-order-form">
          <label>주문 수량</label>
          <div className="market-quantity"><button onClick={() => setQuantity((value) => Math.max(1, Number(value) - 1))} aria-label="수량 줄이기">−</button><input aria-label="주문 수량" type="number" min="1" max="1000" value={quantity} onChange={(event) => setQuantity(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} /><button onClick={() => setQuantity((value) => Math.min(1000, Number(value) + 1))} aria-label="수량 늘리기">＋</button></div>
          <div className="market-quick-quantity"><button onClick={() => setQuantity(1)}>+1</button><button onClick={() => setQuantity(Math.min(1000, quantity + 10))}>+10</button><button onClick={() => setQuantity(side === "buy" ? Math.max(1, Math.min(1000, Math.floor(data.account.balance / selected.price))) : Math.max(1, selected.owned_quantity))}>최대</button></div>
          <dl><div><dt>현재가</dt><dd>{number(selected.price)} TKN</dd></div><div><dt>총 주문 금액</dt><dd>{number(total)} TKN</dd></div><div><dt>{side === "buy" ? "보유 토큰" : "보유 수량"}</dt><dd>{side === "buy" ? `${number(data.account.balance)} TKN` : `${number(selected.owned_quantity)}주`}</dd></div></dl>
          <button className="primary-button market-order-button" disabled={busy === "order" || !canOrder} onClick={order}>{busy === "order" ? "처리 중" : `${side === "buy" ? "매수" : "매도"}하기`}</button>
          {!canOrder && <small className="market-order-warning">{side === "buy" ? "주문 금액보다 보유 토큰이 부족합니다." : "주문 수량보다 보유 주식이 부족합니다."}</small>}
        </div>
      </section>
    </div>

    <div className="market-lower-grid">
      <section className="content-panel market-portfolio"><div className="section-line"><h2>내 보유 종목</h2><span>평가 금액 {number(data.account.market_value)} TKN</span></div>{data.positions.length ? <div className="market-portfolio-list">{data.positions.map((item) => <article key={item.symbol}><span className={`market-symbol ${item.tone}`}>{item.symbol}</span><span><strong>{item.name}</strong><small>{number(item.owned_quantity)}주 · 평균 {number(item.average_cost)} TKN</small></span><span><strong>{number(item.market_value)} TKN</strong><small className={item.profit_loss >= 0 ? "gain" : "loss"}>{signed(item.profit_loss)} TKN</small></span></article>)}</div> : <div className="market-small-empty"><WalletCards size={25} /><span>아직 보유한 가상 종목이 없습니다.</span></div>}</section>
      <section className="content-panel market-history"><div className="section-line"><h2>최근 토큰 내역</h2><span>최대 20개</span></div>{data.activity.length ? <div className="market-history-list">{data.activity.map((item) => <article key={item.id}><span className={item.amount >= 0 ? "gain" : "loss"}>{item.kind === "daily_reward" ? "보상" : item.kind === "buy" ? "매수" : "매도"}</span><span><strong>{item.metadata?.symbol || "접속 보상"}</strong><small>{new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.created_at))}</small></span><strong className={item.amount >= 0 ? "gain" : "loss"}>{signed(item.amount)} TKN</strong></article>)}</div> : <div className="market-small-empty"><Coins size={25} /><span>아직 토큰 내역이 없습니다.</span></div>}</section>
    </div>
    <p className="market-disclaimer">가상 주식은 반 전용 놀이 기능입니다. 실제 주식·현금과 무관하며, 투자 결과에 대한 보상이나 현금 교환을 제공하지 않습니다.</p>
  </section>;
}
