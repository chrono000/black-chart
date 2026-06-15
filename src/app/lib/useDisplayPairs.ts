import { useMemo } from 'react';
import { useExchange } from './ExchangeContext';
import { num } from '../../api/market';

const DEFAULT_PAIRS = ['btc-usdt', 'eth-usdt', 'xrp-usdt', 'sol-usdt', 'ada-usdt', 'doge-usdt'];

// Active pairs ranked by 24h volume, capped to `limit`, with the current
// symbol pinned in. Shared by the Trade and Chart pair selectors.
export function useDisplayPairs(symbol: string, limit = 8): string[] {
  const { constants, tickers } = useExchange();
  return useMemo(() => {
    const active = Object.values(constants?.pairs || {}).filter((p) => p.active);
    let names = active
      .sort((a, b) => num(tickers[b.name]?.volume) - num(tickers[a.name]?.volume))
      .map((p) => p.name);
    if (names.length === 0) names = [...DEFAULT_PAIRS];
    names = names.slice(0, limit);
    if (!names.includes(symbol)) names = [symbol, ...names].slice(0, limit);
    return names;
  }, [constants, tickers, symbol, limit]);
}
