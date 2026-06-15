import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useExchange } from '../lib/ExchangeContext';
import { useAuth } from '../lib/AuthContext';
import { AsciiChart } from '../components/AsciiChart';
import { RequireLoginBlock } from '../components/RequireLoginBlock';
import {
  getCandles, getOrderbook, getRecentTrades, getMarketTicker,
  normalizeTrades, toPublicTrade, roundToStep,
  RESOLUTION, RES_MS, num,
  type Candle, type OrderbookSide, type PublicTrade, type MarketTicker,
} from '../../api/market';
import { orderApi } from '../../api/endpoints/order';
import { ws, type WsMessage } from '../../api/ws';
import type { Order } from '../../api/types';

export type { Candle } from '../../api/market';

const DEFAULT_PAIRS = ['btc-usdt', 'eth-usdt', 'xrp-usdt', 'sol-usdt', 'ada-usdt', 'doge-usdt'];
const CHART_WIDTH = 74;
const MARKET_FEE_PAD = 1.005; // buffer for market-buy cost vs taker fee/slippage

// Accessible clickable chip (keyboard-operable span).
function chipProps(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } },
  };
}

export function TradePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { constants, tickers } = useExchange();
  const { balance, isAuthenticated, refreshBalance } = useAuth();

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

  const displayPairs = useMemo(() => {
    const active = Object.values(constants?.pairs || {}).filter((p) => p.active);
    let names = active
      .sort((a, b) => num(tickers[b.name]?.volume) - num(tickers[a.name]?.volume))
      .map((p) => p.name);
    if (names.length === 0) names = [...DEFAULT_PAIRS];
    names = names.slice(0, 8);
    if (!names.includes(symbol)) names = [symbol, ...names].slice(0, 8);
    return names;
  }, [constants, tickers, symbol]);

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
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}>
        <span className="text-ter" style={{ marginRight: '4px' }}>pair:</span>
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
        {chartData ? (
          chartData.length > 0 ? (
            <AsciiChart data={chartClosePrices} height={16} width={CHART_WIDTH} xLabels={xLabels} currentPrice={displayLast} />
          ) : (
            <div className="text-ter">no chart data available for this period.</div>
          )
        ) : (
          <div className="text-ter">loading sequence...</div>
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
            <div className="text-ter">loading orderbook...</div>
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
              onPlaced={() => { refreshBalance(); setOrdersRefresh((n) => n + 1); }}
            />
          )}
        </div>
      </div>

      {/* Open Orders */}
      {isAuthenticated && <OpenOrders symbol={symbol} refreshSignal={ordersRefresh} onChange={() => { refreshBalance(); setOrdersRefresh((n) => n + 1); }} />}

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
          <div className="text-ter">loading trades...</div>
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
  onPlaced: () => void;
}

function OrderForm({ symbol, base, quote, pairInfo, lastPrice, bestAsk, balance, onPlaced }: OrderFormProps) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const quoteAvail = num(balance?.[`${quote}_available`]);
  const baseAvail = num(balance?.[`${base}_available`]);

  const rawSize = parseFloat(size);
  const rawPrice = type === 'market' ? lastPrice : parseFloat(price);

  // Quantize to the pair's step sizes (floor size, round price to nearest tick).
  const qSize = roundToStep(rawSize, pairInfo?.increment_size, 'floor');
  const qPrice = type === 'limit' ? roundToStep(rawPrice, pairInfo?.increment_price, 'round') : rawPrice;
  const estPrice = type === 'market' ? (side === 'buy' ? (bestAsk || lastPrice) : lastPrice) : qPrice;
  const total = (Number.isFinite(estPrice) ? estPrice : 0) * (Number.isFinite(qSize) ? qSize : 0);

  const validationError = useMemo(() => {
    if (!Number.isFinite(qSize) || qSize <= 0) return 'enter a valid size';
    if (typeof pairInfo?.min_size === 'number' && qSize < pairInfo.min_size) return `min size is ${pairInfo.min_size} ${base.toUpperCase()}`;
    if (typeof pairInfo?.max_size === 'number' && pairInfo.max_size > 0 && qSize > pairInfo.max_size) return `max size is ${pairInfo.max_size} ${base.toUpperCase()}`;
    if (type === 'market' && !(lastPrice > 0)) return 'no market price yet — wait for data';
    if (type === 'limit') {
      if (!Number.isFinite(qPrice) || qPrice <= 0) return 'enter a valid price';
      if (typeof pairInfo?.min_price === 'number' && qPrice < pairInfo.min_price) return `min price is ${pairInfo.min_price}`;
      if (typeof pairInfo?.max_price === 'number' && pairInfo.max_price > 0 && qPrice > pairInfo.max_price) return `max price is ${pairInfo.max_price}`;
    }
    const pad = type === 'market' ? MARKET_FEE_PAD : 1;
    if (side === 'buy' && total * pad > quoteAvail) return `insufficient ${quote.toUpperCase()} (need ~${(total * pad).toFixed(2)})`;
    if (side === 'sell' && qSize > baseAvail) return `insufficient ${base.toUpperCase()}`;
    return '';
  }, [qSize, qPrice, type, side, total, quoteAvail, baseAvail, pairInfo, base, quote, lastPrice]);

  const reset = () => { setPrice(''); setSize(''); setConfirming(false); };

  const submit = useCallback(async () => {
    if (submittingRef.current) return; // synchronous re-entrancy guard (sub-frame double-click)
    submittingRef.current = true;
    setBusy(true);
    setStatus('placing order...');
    try {
      await orderApi.createOrder({
        symbol,
        side,
        size: qSize,
        type,
        ...(type === 'limit' ? { price: qPrice } : {}),
      });
      setStatus(`✓ ${side} order placed`);
      reset();
      onPlaced();
    } catch (err: any) {
      setStatus(`✗ ${err?.isTimeout ? 'timed out — check Open Orders before retrying' : err?.message || 'order failed'}`);
      setConfirming(false);
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }, [symbol, side, qSize, type, qPrice, onPlaced]);

  const inputStyle = { width: '140px' } as const;
  const selectStyle = { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-light)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size)', padding: '2px 4px' } as const;

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
        <select value={type} onChange={(e) => { setType(e.target.value as 'limit' | 'market'); setConfirming(false); }} style={selectStyle}>
          <option value="limit">limit</option>
          <option value="market">market</option>
        </select>
      </div>

      {type === 'limit' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>price</span>
          <input type="number" step="any" value={price} onChange={(e) => { setPrice(e.target.value); setConfirming(false); }} placeholder={lastPrice ? lastPrice.toString() : '0.00'} style={inputStyle} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>amount</span>
        <input type="number" step="any" value={size} onChange={(e) => { setSize(e.target.value); setConfirming(false); }} placeholder={`0.00 ${base.toUpperCase()}`} style={inputStyle} />
      </div>

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
          [{side}_{type} {symbol.toUpperCase()}]
        </button>
      ) : (
        <div style={{ marginTop: '6px', padding: '10px', border: `1px dashed ${side === 'buy' ? 'var(--brand-up)' : 'var(--brand-down)'}` }}>
          <div style={{ marginBottom: '8px' }}>
            confirm: <span className={side === 'buy' ? 'text-up' : 'text-down'}>{side} {qSize} {base.toUpperCase()}</span>
            {type === 'limit' ? ` @ ${qPrice} ${quote.toUpperCase()}` : ' @ market'}
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
function OpenOrders({ symbol, refreshSignal, onChange }: { symbol: string; refreshSignal: number; onChange: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    orderApi.getAllOrders({ symbol, open: true, limit: 50 })
      .then((res) => setOrders(res.data || []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  // Poll so fills/cancels from elsewhere surface without a manual refresh.
  useEffect(() => {
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const cancel = async (id: string) => {
    try { await orderApi.cancelOrder(id); load(); onChange(); } catch (err: any) { alert(err?.message || 'cancel failed'); }
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
            <tr><th>side</th><th>type</th><th>price</th><th>size</th><th>filled</th><th>status</th><th>action</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className={o.side === 'sell' ? 'text-down' : 'text-up'}>
                <td>{o.side}</td>
                <td className="text-sec">{o.type}</td>
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
