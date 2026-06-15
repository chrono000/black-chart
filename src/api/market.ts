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
  time?: string;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Timeframe label (UI) → HollaEx /chart resolution.
// HollaEx accepts minute counts plus 1D / 1W.
export const RESOLUTION: Record<string, string> = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '1d': '1D', '1w': '1W',
};

// HollaEx resolution → candle duration in ms (used for windowing/zoom math).
export const RES_MS: Record<string, number> = {
  '1': 60_000, '3': 180_000, '5': 300_000, '15': 900_000, '30': 1_800_000,
  '60': 3_600_000, '120': 7_200_000, '240': 14_400_000, '1D': 86_400_000, '1W': 604_800_000,
};

// Candidate resolutions (ascending duration) for zoom auto-selection.
export const RES_LADDER: { res: string; ms: number }[] = [
  { res: '1', ms: 60_000 }, { res: '5', ms: 300_000 }, { res: '15', ms: 900_000 },
  { res: '30', ms: 1_800_000 }, { res: '60', ms: 3_600_000 }, { res: '240', ms: 14_400_000 },
  { res: '1D', ms: 86_400_000 }, { res: '1W', ms: 604_800_000 },
];

// GET /chart — array of { time(ISO), open, high, low, close, volume }.
export async function getCandles(
  symbol: string,
  resolution: string,
  fromSec: number,
  toSec: number,
): Promise<Candle[]> {
  const raw = await get<unknown>('/chart', { symbol, resolution, from: fromSec, to: toSec });
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any) => ({
    t: new Date(c.time).getTime(),
    o: num(c.open),
    h: num(c.high),
    l: num(c.low),
    c: num(c.close),
    v: num(c.volume),
  }));
}

// GET /orderbook — returns a map keyed by symbol even when ?symbol= is passed.
export async function getOrderbook(symbol: string): Promise<OrderbookSide> {
  const map = await get<Record<string, any>>('/orderbook', { symbol });
  const ob = map?.[symbol] || {};
  const norm = (rows: any[] | undefined): [number, number][] =>
    (rows || []).map((r) => [num(r[0]), num(r[1])] as [number, number]);
  return { bids: norm(ob.bids), asks: norm(ob.asks) };
}

// GET /trades — returns a map keyed by symbol; value is an array of trades.
export async function getRecentTrades(symbol: string): Promise<PublicTrade[]> {
  const map = await get<Record<string, any[]>>('/trades', { symbol });
  const arr = map?.[symbol] || [];
  return arr.map((t) => ({
    price: num(t.price),
    size: num(t.size),
    side: t.side === 'sell' ? 'sell' : 'buy',
    timestamp: t.timestamp,
  }));
}

// GET /ticker — single pair snapshot (values number-coerced).
export async function getMarketTicker(symbol: string): Promise<MarketTicker> {
  const t = await get<any>('/ticker', { symbol });
  return {
    open: num(t.open),
    high: num(t.high),
    low: num(t.low),
    close: num(t.close),
    last: num(t.last),
    volume: num(t.volume),
    time: t.time,
  };
}
