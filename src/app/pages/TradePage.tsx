import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useExchange } from '../lib/ExchangeContext';
import { useAuth, type PaperApi } from '../lib/AuthContext';
import { useDisplayPairs, useAllPairOptions } from '../lib/useDisplayPairs';
import { chipProps, selectStyle } from '../lib/ui';
import { SearchSelect } from '../components/SearchSelect';
import { AsciiChart } from '../components/AsciiChart';
import { ChartSkeleton } from '../components/ChartSkeleton';
import { RequireLoginBlock } from '../components/RequireLoginBlock';
import {
  getCandles, getOrderbook, getRecentTrades, getMarketTicker,
  normalizeTrades, toPublicTrade, roundToStep,
  RESOLUTION, RES_MS, num,
  type Candle, type OrderbookSide, type PublicTrade, type MarketTicker,
} from '../../api/market';
import { orderApi } from '../../api/endpoints/order';
import { userApi } from '../../api/endpoints/user';
import { ws, type WsMessage } from '../../api/ws';
import type { Order } from '../../api/types';

export type { Candle } from '../../api/market';

const CHART_WIDTH = 74;
const MARKET_FEE_PAD = 1.005; // buffer for market-buy cost vs taker fee/slippage

export function TradePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { constants } = useExchange();
  const { balance, isAuthenticated, isPaper, paper, refreshBalance } = useAuth();

  // Latest paper engine, accessed from effects without re-triggering them.
  const paperRef = useRef(paper);
  useEffect(() => { paperRef.current = paper; }, [paper]);

  const [symbol, setSymbol] = useState(searchParams.get('pair') || 'btc-usdt');
  const [timeframe, setTimeframe] = useState<string>('1d');
  const [chartData, setChartData] = useState<Candle[] | null>(null);
  const [orderbook, setOrderbook] = useState<OrderbookSide | null>(null);
  const [recentTrades, setRecentTrades] = useState<PublicTrade[]>([]);
  const [ticker, setTicker] = useState<MarketTicker | null>(null);
  const [ordersRefresh, setOrdersRefresh] = useState(0);

  const pairInfo = constants?.pairs?.[symbol];
  const [base, quote] = useMemo(() => {
    if (pairInfo) return [pairInfo.pair_base, pairInfo.pair_2];
    const parts = symbol.split('-');
    return [parts[0] || 'btc', parts[1] || 'usdt'];
  }, [pairInfo, symbol]);

  const displayPairs = useDisplayPairs(symbol);
  const allPairs = useAllPairOptions();

  // ── Candles (HollaEx /chart) ──
  useEffect(() => {
    let cancelled = false;
    const resolution = RESOLUTION[timeframe] || '1D';
    const durSec = (RES_MS[resolution] || 86_400_000) / 1000;
    const to = Math.floor(Date.now() / 1000);
    const from = to - Math.floor(durSec * (CHART_WIDTH + 2));
    getCandles(symbol, resolution, from, to)
      .then((c) => { if (!cancelled) setChartData(c.slice(-CHART_WIDTH)); })
      .catch(() => { if (!cancelled) setChartData([]); });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  // ── Orderbook / trades / ticker: live via WS, REST for seed + slow reconcile ──
  useEffect(() => {
    let cancelled = false;
    setOrderbook(null);
    setRecentTrades([]);

    const loadBook = () => getOrderbook(symbol).then((ob) => { if (!cancelled) setOrderbook(ob); }).catch(() => {});
    const loadTrades = () => getRecentTrades(symbol).then((t) => { if (!cancelled) setRecentTrades(t); }).catch(() => {});
    const loadTicker = () => getMarketTicker(symbol).then((t) => { if (!cancelled) setTicker(t); }).catch(() => {});
    loadBook();
    loadTrades();
    loadTicker();
    const tickerInt = setInterval(loadTicker, 5000);
    const reconcileInt = setInterval(() => { loadBook(); loadTrades(); }, 20000); // WS is primary

    // Live WebSocket overlay (public channels, no auth).
    ws.connect();
    const onOrderbook = (msg: WsMessage) => {
      const d = msg.data as { bids?: any[]; asks?: any[] } | undefined;
      if (!d) return;
      setOrderbook({
        bids: (d.bids || []).map((b: any[]) => [num(b[0]), num(b[1])]),
        asks: (d.asks || []).map((a: any[]) => [num(a[0]), num(a[1])]),
      });
    };
    const onTrade = (msg: WsMessage) => {
      const arr = msg.data as any[] | undefined;
      if (!Array.isArray(arr) || arr.length === 0) return;
      const mapped = arr.map(toPublicTrade);
      // 'partial' is a full snapshot → replace; deltas → merge. normalizeTrades dedups+sorts.
      if (msg.action === 'partial') setRecentTrades(normalizeTrades(mapped));
      else setRecentTrades((prev) => normalizeTrades([...mapped, ...prev]));
    };
    const unsubOb = ws.subscribe(`orderbook:${symbol}`, onOrderbook);
    const unsubTr = ws.subscribe(`trade:${symbol}`, onTrade);

    return () => { cancelled = true; clearInterval(tickerInt); clearInterval(reconcileInt); unsubOb(); unsubTr(); };
  }, [symbol]);

  // Periodically refresh balance while authenticated (private state is REST-polled).
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => { refreshBalance(); }, 12000);
    return () => clearInterval(id);
  }, [isAuthenticated, refreshBalance]);

  const asks = useMemo(() => (orderbook?.asks || []).slice(0, 10).reverse(), [orderbook]);
  const bids = useMemo(() => (orderbook?.bids || []).slice(0, 10), [orderbook]);

  const lastCandleClose = chartData?.[chartData.length - 1]?.c || 0;
  const displayLast = ticker?.last || lastCandleClose;
  const open24h = ticker?.open ?? 0;
  const displayChange = open24h > 0 ? ((displayLast - open24h) / open24h) * 100 : 0;

  // Order placement routes through the paper engine in paper mode (no real API call).
  const placeOrder = useCallback(async (req: { symbol: string; side: 'buy' | 'sell'; size: number; type: 'limit' | 'market'; price?: number; stop?: number; meta?: { post_only?: boolean } }) => {
    if (isPaper && paperRef.current) { paperRef.current.placeOrder(req, displayLast); return; }
    await orderApi.createOrder(req);
  }, [isPaper, displayLast]);

  // Paper limit orders fill when the live price crosses them.
  useEffect(() => {
    if (isPaper && ticker?.last && ticker.last > 0) paperRef.current?.fillCheck(symbol, ticker.last);
  }, [isPaper, ticker?.last, symbol]);

  const xLabels = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    const fmt = (ms: number) => {
      const d = new Date(ms);
      const short = timeframe === '1h' || timeframe === '4h' || timeframe.includes('m');
      return short
        ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const len = chartData.length;
    const idx = Array.from(new Set([0, Math.floor(len * 0.25), Math.floor(len * 0.5), Math.floor(len * 0.75), len - 1])).sort((a, b) => a - b);
    return idx.map((i) => fmt(chartData[i].t));
  }, [chartData, timeframe]);

  const chartClosePrices = useMemo(() => (chartData ? chartData.map((c) => c.c) : []), [chartData]);

  const selectPair = (p: string) => { setSymbol(p); setSearchParams({ pair: p }); };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="text-sec">:: terminal_{symbol}</span>
        {displayLast > 0 && (
          <span>
            {displayLast.toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
            <span className={displayChange >= 0 ? 'text-up' : 'text-down'} title="24h change">
              {displayChange >= 0 ? '▲' : '▼'} {Math.abs(displayChange).toFixed(2)}% <span className="text-ter">24h</span>
            </span>
          </span>
        )}
      </div>
      <div className="divider" />

      {/* Pair Selector */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="text-ter" style={{ marginRight: '4px' }}>pair:</span>
        <SearchSelect value={symbol} options={allPairs} onChange={selectPair} placeholder="search market" style={{ flex: '0 0 150px' }} />
        <span className="text-ter" style={{ fontSize: '11px' }}>quick:</span>
        {displayPairs.map((p) => {
          const isActive = symbol === p;
          return (
            <span
              key={p}
              className="interact"
              {...chipProps(() => selectPair(p))}
              style={{
                cursor: 'pointer', padding: '0 2px',
                color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--text-primary)' : 'transparent',
                fontWeight: isActive ? 'bold' : 'normal',
              }}
            >
              {isActive ? ` ${p.toUpperCase()} ` : `[${p.toUpperCase()}]`}
            </span>
          );
        })}
      </div>

      {/* CHART */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div className="text-sec">[ price_history_{timeframe.toUpperCase()} ]</div>
          <div style={{ display: 'flex', gap: '15px' }}>
            {['1h', '4h', '1d', '1w'].map((tf) => {
              const isActive = timeframe === tf;
              return (
                <span
                  key={tf}
                  {...chipProps(() => setTimeframe(tf))}
                  className="interact"
                  style={{
                    cursor: 'pointer', padding: '0 2px',
                    color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    backgroundColor: isActive ? 'var(--text-primary)' : 'transparent',
                    fontWeight: isActive ? 'bold' : 'normal',
                  }}
                >
                  {isActive ? ` ${tf.toUpperCase()} ` : `[${tf.toUpperCase()}]`}
                </span>
              );
            })}
            <a href={`/chart?pair=${symbol}&tf=${timeframe}`} target="_blank" rel="noopener noreferrer" className="interact text-ter" style={{ marginLeft: '10px' }}>
              [open_new_window]
            </a>
          </div>
        </div>
        {chartData === null ? (
          <ChartSkeleton height={16} width={CHART_WIDTH} message="loading sequence..." pulseMessage />
        ) : chartData.length > 0 ? (
          <AsciiChart data={chartClosePrices} height={16} width={CHART_WIDTH} xLabels={xLabels} currentPrice={displayLast} />
        ) : (
          <ChartSkeleton height={16} width={CHART_WIDTH} message="no chart data available for this period." />
        )}
      </div>

      <div className="divider" />

      <div className="trade-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
        {/* ORDERBOOK */}
        <div>
          <div className="text-sec" style={{ marginBottom: '10px' }}>[ orderbook ]</div>
          {orderbook ? (
            <table style={{ fontSize: '12px' }}>
              <thead>
                <tr><th>price</th><th>size</th><th>total</th></tr>
              </thead>
              <tbody>
                {asks.map((ask, i) => (
                  <tr key={`ask-${i}`} className="text-down">
                    <td>{ask[0].toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                    <td>{ask[1]}</td>
                    <td>{(ask[0] * ask[1]).toFixed(2)}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '10px 0' }}>--- spread ---</td></tr>
                {bids.map((bid, i) => (
                  <tr key={`bid-${i}`} className="text-up">
                    <td>{bid[0].toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                    <td>{bid[1]}</td>
                    <td>{(bid[0] * bid[1]).toFixed(2)}</td>
                  </tr>
                ))}
                {asks.length === 0 && bids.length === 0 && (
                  <tr><td colSpan={3} className="text-ter">no open orders on book</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table style={{ fontSize: '12px' }}>
              <thead><tr><th>price</th><th>size</th><th>total</th></tr></thead>
              <tbody className="pulse">
                {Array.from({ length: 21 }).map((_, i) => (
                  <tr key={i} className="text-ter" style={{ opacity: 0.2 }}><td>······</td><td>·····</td><td>·····</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ORDER FORM */}
        <div>
          <div className="text-sec" style={{ marginBottom: '10px' }}>[ order_entry ]</div>
          {!isAuthenticated ? (
            <RequireLoginBlock actionText="TO PLACE ORDERS" />
          ) : (
            <OrderForm
              symbol={symbol}
              base={base}
              quote={quote}
              pairInfo={pairInfo}
              lastPrice={displayLast}
              bestAsk={orderbook?.asks?.[0]?.[0]}
              balance={balance}
              placeOrder={placeOrder}
              onPlaced={() => { refreshBalance(); setOrdersRefresh((n) => n + 1); }}
            />
          )}
        </div>
      </div>

      {/* Open Orders */}
      {isAuthenticated && <OpenOrders symbol={symbol} isPaper={isPaper} paper={paper} refreshSignal={ordersRefresh} onChange={() => { refreshBalance(); setOrdersRefresh((n) => n + 1); }} />}

      {/* My Trades — the user's own recent fills for this pair */}
      {isAuthenticated && <MyTrades symbol={symbol} isPaper={isPaper} paper={paper} refreshSignal={ordersRefresh} />}

      {/* Recent Trades */}
      <div style={{ marginTop: '20px' }}>
        <div className="text-sec" style={{ marginBottom: '10px' }}>[ recent_trades ]</div>
        {recentTrades.length > 0 ? (
          <table style={{ fontSize: '12px' }}>
            <thead>
              <tr><th>time</th><th>price</th><th>qty</th><th>total</th></tr>
            </thead>
            <tbody>
              {recentTrades.slice(0, 15).map((t, i) => {
                const d = new Date(t.timestamp);
                const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                return (
                  <tr key={`${t.timestamp}-${i}`} className={t.side === 'sell' ? 'text-down' : 'text-up'}>
                    <td>{timeStr}</td>
                    <td>{t.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                    <td>{t.size}</td>
                    <td className="text-sec">{(t.price * t.size).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>time</th><th>price</th><th>qty</th><th>total</th></tr></thead>
            <tbody className="pulse">
              {Array.from({ length: 15 }).map((_, i) => (
                <tr key={i} className="text-ter" style={{ opacity: 0.2 }}><td>········</td><td>·····</td><td>·····</td><td>·····</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Order entry form — real HollaEx order placement with step
// quantization, validation, and a confirm step.
// ─────────────────────────────────────────────────────────────
interface OrderFormProps {
  symbol: string;
  base: string;
  quote: string;
  pairInfo: any;
  lastPrice: number;
  bestAsk?: number;
  balance: Record<string, number> | null;
  placeOrder: (req: { symbol: string; side: 'buy' | 'sell'; size: number; type: 'limit' | 'market'; price?: number; stop?: number; meta?: { post_only?: boolean } }) => Promise<void>;
  onPlaced: () => void;
}

type OrderKind = 'limit' | 'market' | 'stop_limit' | 'stop_market';
const KIND_LABEL: Record<OrderKind, string> = { limit: 'limit', market: 'market', stop_limit: 'stop-limit', stop_market: 'stop-market' };

function OrderForm({ symbol, base, quote, pairInfo, lastPrice, bestAsk, balance, placeOrder, onPlaced }: OrderFormProps) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [kind, setKind] = useState<OrderKind>('limit');
  const [price, setPrice] = useState('');
  const [stop, setStop] = useState('');
  const [size, setSize] = useState('');
  const [postOnly, setPostOnly] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const baseType: 'limit' | 'market' = kind === 'market' || kind === 'stop_market' ? 'market' : 'limit';
  const isStop = kind === 'stop_limit' || kind === 'stop_market';
  const needsPrice = baseType === 'limit';

  const quoteAvail = num(balance?.[`${quote}_available`]);
  const baseAvail = num(balance?.[`${base}_available`]);

  const qSize = roundToStep(parseFloat(size), pairInfo?.increment_size, 'floor');
  const qPrice = needsPrice ? roundToStep(parseFloat(price), pairInfo?.increment_price, 'round') : (side === 'buy' ? (bestAsk || lastPrice) : lastPrice);
  const qStop = isStop ? roundToStep(parseFloat(stop), pairInfo?.increment_price, 'round') : NaN;
  // Reference price for cost: limit/stop-limit → limit; stop-market → trigger; market → est.
  const costRef = needsPrice ? qPrice : isStop ? qStop : qPrice;
  const total = (Number.isFinite(costRef) ? costRef : 0) * (Number.isFinite(qSize) ? qSize : 0);

  const validationError = useMemo(() => {
    if (!Number.isFinite(qSize) || qSize <= 0) return 'enter a valid size';
    if (typeof pairInfo?.min_size === 'number' && qSize < pairInfo.min_size) return `min size is ${pairInfo.min_size} ${base.toUpperCase()}`;
    if (typeof pairInfo?.max_size === 'number' && pairInfo.max_size > 0 && qSize > pairInfo.max_size) return `max size is ${pairInfo.max_size} ${base.toUpperCase()}`;
    if (baseType === 'market' && !(lastPrice > 0)) return 'no market price yet — wait for data';
    if (needsPrice) {
      if (!Number.isFinite(qPrice) || qPrice <= 0) return 'enter a valid price';
      if (typeof pairInfo?.min_price === 'number' && qPrice < pairInfo.min_price) return `min price is ${pairInfo.min_price}`;
      if (typeof pairInfo?.max_price === 'number' && pairInfo.max_price > 0 && qPrice > pairInfo.max_price) return `max price is ${pairInfo.max_price}`;
    }
    if (isStop && (!Number.isFinite(qStop) || qStop <= 0)) return 'enter a stop (trigger) price';
    const pad = baseType === 'market' ? MARKET_FEE_PAD : 1;
    if (side === 'buy' && total * pad > quoteAvail) return `insufficient ${quote.toUpperCase()} (need ~${(total * pad).toFixed(2)})`;
    if (side === 'sell' && qSize > baseAvail) return `insufficient ${base.toUpperCase()}`;
    return '';
  }, [qSize, qPrice, qStop, baseType, isStop, needsPrice, side, total, quoteAvail, baseAvail, pairInfo, base, quote, lastPrice]);

  const reset = () => { setPrice(''); setStop(''); setSize(''); setConfirming(false); };

  const submit = useCallback(async () => {
    if (submittingRef.current) return; // synchronous re-entrancy guard (sub-frame double-click)
    submittingRef.current = true;
    setBusy(true);
    setStatus('placing order...');
    try {
      await placeOrder({
        symbol,
        side,
        size: qSize,
        type: baseType,
        ...(needsPrice ? { price: qPrice } : {}),
        ...(isStop ? { stop: qStop } : {}),
        ...(needsPrice && postOnly ? { meta: { post_only: true } } : {}),
      });
      setStatus(`✓ ${side} ${KIND_LABEL[kind]} order placed`);
      reset();
      onPlaced();
    } catch (err: any) {
      setStatus(`✗ ${err?.isTimeout ? 'timed out — check Open Orders before retrying' : err?.message || 'order failed'}`);
      setConfirming(false);
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }, [symbol, side, qSize, baseType, needsPrice, isStop, qPrice, qStop, postOnly, kind, placeOrder, onPlaced]);

  const inputStyle = { width: '140px' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="text-ter">avail {quote.toUpperCase()}:</span>
        <span>{quoteAvail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="text-ter">avail {base.toUpperCase()}:</span>
        <span>{baseAvail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
      </div>

      <div className="divider" />

      <div style={{ display: 'flex', gap: '8px' }}>
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); setConfirming(false); }}
            style={{
              flex: 1,
              borderColor: side === s ? (s === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)') : 'var(--border-light)',
              color: side === s ? (s === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)') : 'var(--text-secondary)',
            }}
          >
            [{s}]
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>type</span>
        <select value={kind} onChange={(e) => { setKind(e.target.value as OrderKind); setConfirming(false); }} style={selectStyle}>
          <option value="limit">limit</option>
          <option value="market">market</option>
          <option value="stop_limit">stop-limit</option>
          <option value="stop_market">stop-market</option>
        </select>
      </div>

      {isStop && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>trigger</span>
          <input type="number" step="any" value={stop} onChange={(e) => { setStop(e.target.value); setConfirming(false); }} placeholder={`stop @ ${lastPrice || '0.00'}`} style={inputStyle} />
        </div>
      )}

      {needsPrice && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>price</span>
          <input type="number" step="any" value={price} onChange={(e) => { setPrice(e.target.value); setConfirming(false); }} placeholder={lastPrice ? lastPrice.toString() : '0.00'} style={inputStyle} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>amount</span>
        <input type="number" step="any" value={size} onChange={(e) => { setSize(e.target.value); setConfirming(false); }} placeholder={`0.00 ${base.toUpperCase()}`} style={inputStyle} />
      </div>

      {needsPrice && (
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', cursor: 'pointer' }} className="text-ter">
          <input type="checkbox" checked={postOnly} onChange={(e) => { setPostOnly(e.target.checked); setConfirming(false); }} />
          post-only (maker only)
        </label>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="text-ter">≈ total</span>
        <span className="text-sec">{total > 0 ? `${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${quote.toUpperCase()}` : '—'}</span>
      </div>

      {validationError && size !== '' && <div className="text-ter" style={{ fontSize: '11px' }}>! {validationError}</div>}

      {!confirming ? (
        <button
          disabled={!!validationError || busy}
          onClick={() => { setStatus(''); setConfirming(true); }}
          style={{ marginTop: '6px', width: '100%', borderColor: side === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)', color: side === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)' }}
        >
          [{side}_{kind} {symbol.toUpperCase()}]
        </button>
      ) : (
        <div style={{ marginTop: '6px', padding: '10px', border: `1px dashed ${side === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)'}` }}>
          <div style={{ marginBottom: '8px' }}>
            confirm: <span className={side === 'buy' ? 'text-up' : 'text-down'}>{side} {qSize} {base.toUpperCase()}</span>
            {isStop ? ` stop @ ${qStop}` : ''}
            {needsPrice ? ` @ ${qPrice} ${quote.toUpperCase()}` : (isStop ? ' → market' : ' @ market')}
            {needsPrice && postOnly ? ' · post-only' : ''}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button disabled={busy} onClick={submit} style={{ flex: 1, borderColor: side === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)', color: side === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)' }}>
              {busy ? '[...]' : '[confirm →]'}
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)} className="text-ter">[cancel]</button>
          </div>
        </div>
      )}

      {status && <div style={{ fontSize: '11px' }} className={status.startsWith('✓') ? 'text-up' : status.startsWith('✗') ? 'text-down' : 'text-sec'}>{status}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Open orders for the current pair, with cancel. Polls + refreshes on signal.
// ─────────────────────────────────────────────────────────────
function OpenOrders({ symbol, isPaper, paper, refreshSignal, onChange }: { symbol: string; isPaper: boolean; paper: PaperApi | null; refreshSignal: number; onChange: () => void }) {
  const [fetched, setFetched] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (isPaper) return; // paper orders come from state, no fetch
    setLoading(true);
    orderApi.getAllOrders({ symbol, open: true, limit: 50 })
      .then((res) => setFetched(res.data || []))
      .catch(() => setFetched([]))
      .finally(() => setLoading(false));
  }, [symbol, isPaper]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  // Poll so fills/cancels from elsewhere surface without a manual refresh (live only).
  useEffect(() => {
    if (isPaper) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load, isPaper]);

  const orders: Order[] = isPaper
    ? ((paper?.orders || []).filter((o) => o.symbol === symbol) as unknown as Order[])
    : fetched;

  const cancel = async (id: string) => {
    try {
      if (isPaper) { paper?.cancelOrder(id); onChange(); }
      else { await orderApi.cancelOrder(id); load(); onChange(); }
    } catch (err: any) { alert(err?.message || 'cancel failed'); }
  };

  return (
    <div style={{ marginTop: '20px' }}>
      <div className="text-sec" style={{ marginBottom: '10px' }}>[ open_orders ]</div>
      {loading && orders.length === 0 ? (
        <div className="text-ter">loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="text-ter">no open orders for {symbol.toUpperCase()}.</div>
      ) : (
        <table style={{ fontSize: '12px' }}>
          <thead>
            <tr><th>side</th><th>type</th><th>trigger</th><th>price</th><th>size</th><th>filled</th><th>status</th><th>action</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className={o.side === 'sell' ? 'text-down' : 'text-up'}>
                <td>{o.side}</td>
                <td className="text-sec">{o.stop ? `stop-${o.type}` : o.type}</td>
                <td className="text-sec">{o.stop ?? '—'}</td>
                <td>{o.price ?? '—'}</td>
                <td>{o.size}</td>
                <td className="text-sec">{o.filled}</td>
                <td className="text-sec">{o.status}</td>
                <td><span role="button" tabIndex={0} className="interact text-ter" onClick={() => cancel(o.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cancel(o.id); } }}>[cancel]</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// The authenticated user's own recent fills for the current pair.
// ─────────────────────────────────────────────────────────────
function MyTrades({ symbol, isPaper, paper, refreshSignal }: { symbol: string; isPaper: boolean; paper: PaperApi | null; refreshSignal: number }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (isPaper) { setTrades((paper?.trades || []).filter((t) => t.symbol === symbol)); return; }
    setLoading(true);
    userApi.getTrades({ symbol, limit: 20, order_by: 'timestamp', order: 'desc' })
      .then((r) => setTrades(r.data || []))
      .catch(() => setTrades([]))
      .finally(() => setLoading(false));
  }, [symbol, isPaper, paper]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  // Poll so fills land without a manual refresh (live only; paper updates via state).
  useEffect(() => {
    if (isPaper) return;
    const id = setInterval(load, 12000);
    return () => clearInterval(id);
  }, [load, isPaper]);

  return (
    <div style={{ marginTop: '20px' }}>
      <div className="text-sec" style={{ marginBottom: '10px' }}>[ my_trades ]</div>
      {loading && trades.length === 0 ? (
        <div className="text-ter">loading your trades...</div>
      ) : trades.length === 0 ? (
        <div className="text-ter">no recent trades for {symbol.toUpperCase()}.</div>
      ) : (
        <table style={{ fontSize: '12px' }}>
          <thead>
            <tr><th>time</th><th>side</th><th>price</th><th>qty</th><th>total</th></tr>
          </thead>
          <tbody>
            {trades.slice(0, 20).map((t, i) => {
              const d = new Date(t.timestamp || t.created_at);
              const timeStr = Number.isNaN(d.getTime()) ? '—' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
              const price = num(t.price);
              const size = num(t.size);
              return (
                <tr key={i} className={t.side === 'sell' ? 'text-down' : 'text-up'}>
                  <td>{timeStr}</td>
                  <td>{t.side}</td>
                  <td>{price.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                  <td>{size.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                  <td className="text-sec">{(price * size).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
