import { useEffect, useMemo, useState } from 'react';
import { useExchange } from './ExchangeContext';
import { getCandles, num } from '../../api/market';

export type PerfWindow = '7d' | '1m' | '3m';

// window → lookback days + HollaEx /chart resolution (one candle per column).
const WINDOW_CFG: Record<PerfWindow, { days: number; resolution: string }> = {
  '7d': { days: 7, resolution: '240' }, // 4h candles → ~42 points
  '1m': { days: 30, resolution: '1D' }, // ~30 points
  '3m': { days: 90, resolution: '1D' }, // ~90 points
};

interface Series { coin: string; map: Map<number, number> }

// Portfolio value over time = current holdings valued against historical
// <coin>-usdt close prices. Consistent for live and paper (prices are public).
export function usePortfolioHistory(balance: Record<string, number> | null, win: PerfWindow) {
  const { constants } = useExchange();
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const heldKey = useMemo(() => {
    if (!balance) return '';
    return Object.keys(balance)
      .filter((k) => k.endsWith('_balance') && num(balance[k]) > 0)
      .map((k) => k.replace('_balance', ''))
      .sort()
      .join(',');
  }, [balance]);

  // Fetch price history per held coin (depends only on the coin set + window).
  useEffect(() => {
    if (!heldKey) { setSeries([]); setLoading(false); setError(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const coins = heldKey.split(',');
    const { days, resolution } = WINDOW_CFG[win];
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;
    const pairs = constants?.pairs || {};

    Promise.all(coins.map(async (coin): Promise<Series> => {
      if (coin === 'usdt' || !pairs[`${coin}-usdt`]) return { coin, map: new Map() };
      try {
        const candles = await getCandles(`${coin}-usdt`, resolution, from, to);
        const map = new Map<number, number>();
        for (const c of candles) map.set(c.t, c.c);
        return { coin, map };
      } catch {
        return { coin, map: new Map() };
      }
    }))
      .then((res) => { if (!cancelled) { setSeries(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });

    return () => { cancelled = true; };
  }, [heldKey, win, constants]);

  // Recompute the value curve when holdings or fetched series change (no refetch).
  const { values, times } = useMemo(() => {
    if (series.length === 0) return { values: [] as number[], times: [] as number[] };
    const tsSet = new Set<number>();
    for (const s of series) for (const t of s.map.keys()) tsSet.add(t);
    const sortedTimes = [...tsSet].sort((a, b) => a - b);
    if (sortedTimes.length === 0) return { values: [], times: [] };

    // Seed each coin with its first known price so early buckets aren't undervalued.
    const lastPrice: Record<string, number> = {};
    for (const s of series) {
      const first = s.map.size ? s.map.values().next().value : undefined;
      if (first !== undefined) lastPrice[s.coin] = first;
    }

    const vals = sortedTimes.map((t) => {
      let v = 0;
      for (const s of series) {
        const hold = num(balance?.[`${s.coin}_balance`]);
        if (hold === 0) continue;
        if (s.coin === 'usdt') { v += hold; continue; }
        const p = s.map.get(t);
        if (p !== undefined) lastPrice[s.coin] = p;
        const price = lastPrice[s.coin];
        if (price !== undefined) v += hold * price;
      }
      return v;
    });
    return { values: vals, times: sortedTimes };
  }, [series, balance]);

  return { values, times, loading, error };
}
