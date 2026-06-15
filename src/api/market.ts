// ═══════════════════════════════════════════════════════════
// HollaEx market-data helpers (REST) — normalized & number-safe.
// The HollaEx API returns numeric fields as strings for some pairs,
// so everything here is coerced to numbers via num().
// ═══════════════════════════════════════════════════════════
import { get } from './client';

export interface Candle {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface OrderbookSide {
  bids: [number, number][];
  asks: [number, number][];
}

export interface PublicTrade {
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: string;
}

export interface MarketTicker {
  open: number;
  high: number;
  low: number;
  close: number;
  last: number;
  volume: number;
  timestamp?: string;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// ── Decimal-safe step quantization (for order size/price) ──
export const decimalsOf = (step: number): number => {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return s.split('.')[1]?.length ?? 0;
};

export const roundToStep = (v: number, step: number, mode: 'floor' | 'round' = 'round'): number => {
  if (!Number.isFinite(v)) return NaN;
  if (!step || step <= 0) return v;
  const n = mode === 'floor' ? Math.floor(v / step) : Math.round(v / step);
  return parseFloat((n * step).toFixed(decimalsOf(step)));
};

// Timeframe label (UI) → HollaEx /chart resolution.
// HollaEx /chart only honors these resolutions: 1, 5, 15, 60, 240, 1D, 1W.
export const RESOLUTION: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': '1D', '1w': '1W',
};

// HollaEx resolution → candle duration in ms (used for windowing/zoom math).
export const RES_MS: Record<string, number> = {
  '1': 60_000, '5': 300_000, '15': 900_000, '60': 3_600_000, '240': 14_400_000,
  '1D': 86_400_000, '1W': 604_800_000,
};

// Candidate resolutions (ascending duration) for zoom auto-selection.
export const RES_LADDER: { res: string; ms: number }[] = [
  { res: '1', ms: 60_000 }, { res: '5', ms: 300_000 }, { res: '15', ms: 900_000 },
  { res: '60', ms: 3_600_000 }, { res: '240', ms: 14_400_000 },
  { res: '1D', ms: 86_400_000 }, { res: '1W', ms: 604_800_000 },
];

// GET /chart — array of { time(ISO), open, high, low, close, volume }.
// HollaEx returns many duplicate rows per period (intra-period snapshots);
// de-dup by timestamp (keep the freshest/last) and sort ascending so callers
// get one candle per period and slice(-width) selects distinct candles.
export async function getCandles(
  symbol: string,
  resolution: string,
  fromSec: number,
  toSec: number,
): Promise<Candle[]> {
  const raw = await get<unknown>('/chart', { symbol, resolution, from: fromSec, to: toSec });
  if (!Array.isArray(raw)) return [];
  const byTime = new Map<number, Candle>();
  for (const c of raw as any[]) {
    const t = new Date(c.time).getTime();
    if (!Number.isFinite(t)) continue;
    byTime.set(t, { t, o: num(c.open), h: num(c.high), l: num(c.low), c: num(c.close), v: num(c.volume) });
  }
  return Array.from(byTime.values()).sort((a, b) => a.t - b.t);
}

// GET /orderbook — HollaEx ignores ?symbol= and returns a map keyed by symbol.
export async function getOrderbook(symbol: string): Promise<OrderbookSide> {
  const map = await get<Record<string, any>>('/orderbook', { symbol });
  const ob = map?.[symbol] || {};
  const norm = (rows: any[] | undefined): [number, number][] =>
    (rows || []).map((r) => [num(r[0]), num(r[1])] as [number, number]);
  return { bids: norm(ob.bids), asks: norm(ob.asks) };
}

// Sort newest-first, dedup by identity, cap. Robust regardless of API order.
export function normalizeTrades(trades: PublicTrade[], cap = 50): PublicTrade[] {
  const seen = new Set<string>();
  const out: PublicTrade[] = [];
  const sorted = [...trades].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  for (const t of sorted) {
    const key = `${t.timestamp}|${t.price}|${t.size}|${t.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export const toPublicTrade = (t: any): PublicTrade => ({
  price: num(t.price),
  size: num(t.size),
  side: t.side === 'sell' ? 'sell' : 'buy',
  timestamp: t.timestamp,
});

// GET /trades — HollaEx returns a map keyed by symbol; value is an array of trades.
export async function getRecentTrades(symbol: string): Promise<PublicTrade[]> {
  const map = await get<Record<string, any[]>>('/trades', { symbol });
  const arr = map?.[symbol] || [];
  return normalizeTrades(arr.map(toPublicTrade));
}

// GET /ticker — single pair snapshot (values number-coerced). Field is `timestamp`.
export async function getMarketTicker(symbol: string): Promise<MarketTicker> {
  const t = await get<any>('/ticker', { symbol });
  return {
    open: num(t.open),
    high: num(t.high),
    low: num(t.low),
    close: num(t.close),
    last: num(t.last),
    volume: num(t.volume),
    timestamp: t.timestamp ?? t.time,
  };
}
