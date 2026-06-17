import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useExchange } from '../lib/ExchangeContext';
import { useAuth } from '../lib/AuthContext';
import { num } from '../../api/market';
import { publicApi } from '../../api/endpoints/public';
import { WatchStar } from '../components/WatchStar';
import type { CoinConfig, PairConfig } from '../../api/types';

// HollaEx returns more fields on a coin than our base type declares.
type CoinExtra = CoinConfig & {
  description?: string;
  display_name?: string;
  market_cap?: number;
  category?: string;
};

const stripHtml = (s?: string) =>
  String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = (v: number, d = 8) => v.toLocaleString(undefined, { maximumFractionDigits: d });

function Row({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <span className="text-ter" style={{ width: '130px', flexShrink: 0 }}>{label}</span>
      <span className={tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}>{value}</span>
    </div>
  );
}

export function CoinPage() {
  const params = useParams();
  const symbol = (params.symbol || '').toLowerCase();
  const { constants, tickers, displayCurrency } = useExchange();
  const { isAuthenticated, balance } = useAuth();
  const CCY = displayCurrency.toUpperCase();

  const coin = constants?.coins?.[symbol] as CoinExtra | undefined;

  // Headline price in the display currency (works for any asset, not just bases).
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setPrice(null);
    publicApi.getOraclePrices({ assets: symbol, quote: displayCurrency })
      .then((p) => { if (!cancelled) { const v = num(p[symbol]); setPrice(v > 0 ? v : null); } })
      .catch(() => { if (!cancelled) setPrice(null); });
    return () => { cancelled = true; };
  }, [symbol, displayCurrency]);

  const markets = useMemo<PairConfig[]>(() =>
    (Object.values(constants?.pairs || {}) as PairConfig[])
      .filter((p) => p.active && (p.pair_base === symbol || p.pair_2 === symbol))
      .sort((a, b) => num(tickers[b.name]?.volume) - num(tickers[a.name]?.volume)),
  [constants, tickers, symbol]);

  const primaryPair = useMemo(() =>
    markets.find((p) => p.name === `${symbol}-usdt`) || markets.find((p) => p.pair_base === symbol) || markets[0],
  [markets, symbol]);

  const changeOf = (name?: string): number | null => {
    if (!name) return null;
    const t = tickers[name];
    if (!t) return null;
    const open = num(t.open);
    if (open <= 0) return null;
    return ((num(t.close) - open) / open) * 100;
  };
  const chg = changeOf(primaryPair?.name);
  const up = (chg ?? 0) >= 0;

  const bal = num(balance?.[`${symbol}_balance`]);
  const availBal = num(balance?.[`${symbol}_available`]);
  const balValue = price != null ? bal * price : 0;

  if (!constants) {
    return <div><div className="text-sec">:: coin</div><div className="divider" /><div className="text-ter">loading…</div></div>;
  }
  if (!coin) {
    return (
      <div>
        <div className="text-sec">:: coin / {symbol.toUpperCase()}</div>
        <div className="divider" />
        <div className="text-ter">unknown asset "{symbol.toUpperCase()}". <Link to="/prices" className="text-primary">[browse coins]</Link></div>
      </div>
    );
  }

  const desc = stripHtml(coin.description);
  const website = coin.meta && typeof coin.meta.website === 'string' ? coin.meta.website : '';
  const explorer = coin.meta && typeof coin.meta.explorer === 'string' ? coin.meta.explorer : '';
  const allowDep = coin.allow_deposit !== false;
  const allowWdl = coin.allow_withdrawal !== false;
  const wdFeeEntries = coin.withdrawal_fees && typeof coin.withdrawal_fees === 'object'
    ? Object.entries(coin.withdrawal_fees).filter(([, f]) => f && typeof f === 'object' && typeof (f as { value?: unknown }).value === 'number')
    : [];

  return (
    <div>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <span className="text-sec">:: coin / {symbol.toUpperCase()}</span>
        <Link to="/markets" className="text-primary" style={{ fontSize: '12px' }}>[all markets →]</Link>
      </div>
      <div className="divider" />

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {coin.logo && <img src={coin.logo} alt="" width={28} height={28} style={{ borderRadius: '50%' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
        <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{symbol.toUpperCase()}</span>
        <span className="text-sec">{coin.fullname}</span>
        {coin.type && <span className="text-ter" style={{ fontSize: '11px' }}>[{coin.type}{coin.network ? ` · ${coin.network}` : ''}{coin.standard ? ` · ${coin.standard}` : ''}]</span>}
      </div>

      {/* PRICE + YOUR BALANCE */}
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '18px' }}>
        <span>
          <span className="text-ter" style={{ fontSize: '11px' }}>price </span>
          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{price != null ? fmt(price) : '—'}</span>{' '}
          <span className="text-ter">{CCY}</span>{' '}
          {chg != null && <span className={up ? 'text-up' : 'text-down'}>{up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}% <span className="text-ter">24h</span></span>}
        </span>
        {isAuthenticated && bal > 0 && (
          <span className="text-sec" style={{ fontSize: '12px' }}>
            you hold <span className="text-up">{fmt(bal)} {symbol.toUpperCase()}</span>
            {price != null && <> ≈ {fmt(balValue, 2)} {CCY}</>}
            {availBal < bal && <span className="text-ter"> ({fmt(availBal)} available)</span>}
          </span>
        )}
      </div>

      {/* ACTIONS HUB */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '24px' }}>
        {primaryPair && <Link to={`/trade?pair=${primaryPair.name}`} className="text-primary">[trade]</Link>}
        <Link to={`/convert?to=${symbol}`} className="text-primary">[buy]</Link>
        <Link to={`/convert?from=${symbol}`} className="text-primary">[sell]</Link>
        {allowDep && <Link to={`/wallet?coin=${symbol}&action=deposit`} className="text-primary">[deposit]</Link>}
        {allowWdl && <Link to={`/wallet?coin=${symbol}&action=withdraw`} className="text-primary">[withdraw]</Link>}
      </div>

      {/* ABOUT */}
      {(desc || website || explorer) && (
        <>
          <div className="text-sec" style={{ marginBottom: '8px' }}>[ about {symbol.toUpperCase()} ]</div>
          {desc && <p className="text-sec" style={{ fontSize: '12px', lineHeight: '1.7', maxWidth: '680px', marginBottom: '10px' }}>{desc}</p>}
          {(website || explorer) && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
              {website && <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary" style={{ fontSize: '12px' }}>[website ↗]</a>}
              {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-primary" style={{ fontSize: '12px' }}>[explorer ↗]</a>}
            </div>
          )}
        </>
      )}

      {/* MARKETS */}
      <div className="text-sec" style={{ marginBottom: '8px' }}>[ markets ]</div>
      {markets.length > 0 ? (
        <table style={{ marginBottom: '24px' }}>
          <thead><tr><th aria-label="watch" style={{ width: '24px' }}></th><th>pair</th><th>last</th><th>24h</th><th>action</th></tr></thead>
          <tbody>
            {markets.map((p) => {
              const t = tickers[p.name];
              const c = changeOf(p.name);
              const u = (c ?? 0) >= 0;
              return (
                <tr key={p.name}>
                  <td style={{ textAlign: 'center' }}><WatchStar pair={p.name} /></td>
                  <td>{p.name.toUpperCase()}</td>
                  <td>{num(t?.last).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                  <td className={c === null ? 'text-ter' : u ? 'text-up' : 'text-down'}>{c === null ? '—' : `${u ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}%`}</td>
                  <td><Link to={`/trade?pair=${p.name}`} className="text-primary">[trade]</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="text-ter" style={{ marginBottom: '24px', fontSize: '12px' }}>no active markets for {symbol.toUpperCase()} — you can still convert, deposit or withdraw.</div>
      )}

      {/* DETAILS */}
      <div className="text-sec" style={{ marginBottom: '8px' }}>[ details ]</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', maxWidth: '560px' }}>
        <Row label="asset type" value={coin.type || '—'} />
        {coin.network && <Row label="network" value={coin.network + (coin.standard ? ` (${coin.standard})` : '')} />}
        <Row label="deposits" value={allowDep ? 'enabled' : 'disabled'} tone={allowDep ? 'up' : 'down'} />
        <Row label="withdrawals" value={allowWdl ? 'enabled' : 'disabled'} tone={allowWdl ? 'up' : 'down'} />
        {wdFeeEntries.length > 0
          ? <Row label="withdrawal fee" value={wdFeeEntries.map(([net, f]) => `${num((f as { value: number }).value)} ${((f as { symbol?: string }).symbol || net).toUpperCase()}`).join(' · ')} />
          : (coin.withdrawal_fee != null ? <Row label="withdrawal fee" value={`${coin.withdrawal_fee} ${symbol.toUpperCase()}`} /> : null)}
        {typeof coin.market_cap === 'number' && coin.market_cap > 0 && <Row label="market cap" value={`${fmt(coin.market_cap, 0)} USD`} />}
        {coin.category ? <Row label="category" value={String(coin.category)} /> : null}
      </div>
    </div>
  );
}
