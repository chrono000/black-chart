import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { useExchange } from '../lib/ExchangeContext';
import { publicApi } from '../../api/endpoints/public';
import { num } from '../../api/market';
import type { CoinConfig } from '../../api/types';

type CoinExtra = CoinConfig & { market_cap?: number };
type SortKey = 'rank' | 'name' | 'price' | 'change' | 'mcap';

const compact = (n: number) => {
  if (!(n > 0)) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

// A CoinGecko / CoinMarketCap-style directory of assets (not trading pairs).
// Pairs live on the Markets page; each asset here links to its coin hub.
export function PricesPage() {
  const { constants, tickers } = useExchange();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('mcap');
  const [sortDesc, setSortDesc] = useState(true);
  const [prices, setPrices] = useState<Record<string, number>>({});

  const coins = useMemo(
    () => (Object.values(constants?.coins || {}) as CoinExtra[]).filter((c) => c.active !== false),
    [constants],
  );

  // USD price for every asset (oracle), batched to keep the query string sane.
  useEffect(() => {
    if (!coins.length) return;
    let cancelled = false;
    const syms = coins.map((c) => c.symbol);
    const chunks: string[][] = [];
    for (let i = 0; i < syms.length; i += 80) chunks.push(syms.slice(i, i + 80));
    Promise.all(chunks.map((ch) => publicApi.getOraclePrices({ assets: ch.join(','), quote: 'usdt' }).catch(() => ({}))))
      .then((parts) => { if (!cancelled) setPrices(Object.assign({}, ...parts)); });
    return () => { cancelled = true; };
  }, [coins]);

  // 24h change for an asset from its <coin>-usdt market (best-effort).
  const changeOf = (sym: string): number | null => {
    const t = tickers[`${sym}-usdt`];
    if (!t) return null;
    const open = num(t.open);
    if (open <= 0) return null;
    return ((num(t.close) - open) / open) * 100;
  };
  const priceOf = (sym: string) => (sym === 'usdt' ? 1 : num(prices[sym]));

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    const list = coins
      .filter((c) => c.symbol.includes(q) || (c.fullname || '').toLowerCase().includes(q))
      .map((c) => ({ coin: c, price: priceOf(c.symbol), chg: changeOf(c.symbol), mcap: num(c.market_cap) }));
    list.sort((a, b) => {
      let d = 0;
      if (sortKey === 'name') d = a.coin.symbol.localeCompare(b.coin.symbol);
      else if (sortKey === 'price') d = a.price - b.price;
      else if (sortKey === 'change') d = (a.chg ?? -Infinity) - (b.chg ?? -Infinity);
      else d = a.mcap - b.mcap; // rank & mcap both sort by market cap
      return sortDesc ? -d : d;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins, prices, tickers, search, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(key !== 'name'); }
  };
  const ind = (key: SortKey) => (sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : '');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-sec">:: prices <span className="text-ter" style={{ fontSize: '11px' }}>(assets by market cap)</span></span>
        <input
          type="text"
          placeholder="[search coin]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '150px' }}
        />
      </div>
      <div className="divider" />

      <table>
        <thead>
          <tr>
            <th onClick={() => toggleSort('rank')} style={{ cursor: 'pointer', width: '32px' }}>#{ind('rank')}</th>
            <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>asset{ind('name')}</th>
            <th onClick={() => toggleSort('price')} style={{ cursor: 'pointer' }}>price (USD){ind('price')}</th>
            <th onClick={() => toggleSort('change')} style={{ cursor: 'pointer' }}>24h{ind('change')}</th>
            <th onClick={() => toggleSort('mcap')} style={{ cursor: 'pointer' }}>market cap{ind('mcap')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ coin, price, chg, mcap }, i) => {
            const up = (chg ?? 0) >= 0;
            return (
              <tr key={coin.symbol}>
                <td className="text-ter">{sortKey === 'mcap' || sortKey === 'rank' ? (sortDesc ? i + 1 : rows.length - i) : '·'}</td>
                <td>
                  <Link to={`/coin/${coin.symbol}`} className="text-primary">{coin.symbol.toUpperCase()}</Link>
                  <span className="text-ter" style={{ fontSize: '11px', marginLeft: '8px' }}>{coin.fullname}</span>
                </td>
                <td>{price > 0 ? price.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</td>
                <td className={chg === null ? 'text-ter' : up ? 'text-up' : 'text-down'}>
                  {chg === null ? '—' : `${up ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%`}
                </td>
                <td className="text-sec">{compact(mcap)}</td>
                <td><Link to={`/coin/${coin.symbol}`} className="text-primary">[info]</Link></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={6} className="text-ter">{coins.length ? 'no assets match.' : 'loading assets…'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
