import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useExchange } from '../lib/ExchangeContext';
import { useAuth } from '../lib/AuthContext';
import { num } from '../../api/market';
import { publicApi } from '../../api/endpoints/public';
import type { Announcement } from '../../api/types';

export function HomePage() {
  const { tickers, constants } = useExchange();
  const { user, isAuthenticated, isPaper, balance } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    publicApi.getAnnouncements({ limit: 5 }).then((r) => setAnnouncements(r.data || [])).catch(() => {});
  }, []);

  const topPairs = useMemo(() =>
    Object.values(constants?.pairs || {})
      .filter((p) => p.active && tickers[p.name])
      .sort((a, b) => num(tickers[b.name]?.volume) - num(tickers[a.name]?.volume))
      .slice(0, 6),
  [constants, tickers]);

  const holdings = useMemo(() => {
    if (!balance) return [] as { coin: string; amt: number }[];
    return Object.keys(balance)
      .filter((k) => k.endsWith('_balance') && num(balance[k]) > 0)
      .map((k) => ({ coin: k.replace('_balance', ''), amt: num(balance[k]) }))
      .sort((a, b) => b.amt - a.amt);
  }, [balance]);

  const changeOf = (name: string): number | null => {
    const t = tickers[name];
    if (!t) return null;
    const open = num(t.open);
    if (open <= 0) return null;
    return ((num(t.close) - open) / open) * 100;
  };

  const label = (text: string) => (
    <span className="text-ter" style={{ display: 'inline-block', width: '90px' }}>{text}</span>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="text-sec">:: dashboard</span>
        <span className={isAuthenticated ? 'text-up' : 'text-ter'}>
          {isAuthenticated ? (isPaper ? 'paper account' : `logged in: ${user?.email}`) : 'viewer mode'}
        </span>
      </div>
      <div className="divider" />

      <div className="trade-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
        {/* ACCOUNT */}
        <div>
          <div className="text-sec" style={{ marginBottom: '10px' }}>[ account ]</div>
          {isAuthenticated ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div>{label('mode:')} {isPaper ? <span className="text-up">paper trading</span> : 'live'}</div>
              {!isPaper && <div>{label('email:')} {user?.email}</div>}
              <div>{label('verification:')} level {user?.verification_level ?? 0}</div>
              <div className="text-ter" style={{ marginTop: '8px' }}>holdings:</div>
              {holdings.length > 0 ? holdings.slice(0, 5).map((h) => (
                <div key={h.coin} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '240px' }}>
                  <span>{h.coin.toUpperCase()}</span>
                  <span className="text-sec">{h.amt.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
                </div>
              )) : <div className="text-ter">no balances yet</div>}
              {holdings.length > 5 && <div className="text-ter" style={{ fontSize: '11px' }}>+{holdings.length - 5} more</div>}
              <div style={{ marginTop: '12px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                <Link to="/wallet" className="text-primary">[wallet →]</Link>
                <Link to="/convert" className="text-primary">[convert →]</Link>
                <Link to="/account" className="text-primary">[account →]</Link>
              </div>
            </div>
          ) : (
            <div style={{ lineHeight: '1.7' }}>
              <div className="text-ter">market data is live &amp; read-only in viewer mode.</div>
              <div className="text-ter" style={{ marginBottom: '12px' }}>log in for your real account, or try paper trading — no signup, no real funds.</div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                <Link to="/login" className="text-primary">[login]</Link>
                <Link to="/signup" className="text-primary">[signup]</Link>
                <Link to="/login" className="text-primary">[paper trading]</Link>
              </div>
            </div>
          )}
        </div>

        {/* ANNOUNCEMENTS */}
        <div>
          <div className="text-sec" style={{ marginBottom: '10px' }}>[ announcements ]</div>
          {announcements.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {announcements.slice(0, 5).map((a) => (
                <div key={a.id}>
                  <div>{a.title}</div>
                  <div className="text-ter" style={{ fontSize: '11px' }}>{a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-ter">no announcements right now.</div>
          )}
        </div>
      </div>

      {/* TOP MARKETS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="text-sec">[ top markets ]</span>
        <Link to="/prices" className="text-primary" style={{ fontSize: '12px' }}>[all prices →]</Link>
      </div>
      <div className="divider" />
      <table>
        <thead>
          <tr><th>pair</th><th>last</th><th>24h</th><th>volume</th><th>action</th></tr>
        </thead>
        <tbody>
          {topPairs.map((pair) => {
            const t = tickers[pair.name];
            const chg = changeOf(pair.name);
            const up = (chg ?? 0) >= 0;
            return (
              <tr key={pair.name}>
                <td>{pair.name.toUpperCase()}</td>
                <td>{num(t?.last).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className={chg === null ? 'text-ter' : up ? 'text-up' : 'text-down'}>
                  {chg === null ? '—' : `${up ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%`}
                </td>
                <td className="text-sec">{num(t?.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td><Link to={`/trade?pair=${pair.name}`} className="text-primary">[trade]</Link></td>
              </tr>
            );
          })}
          {topPairs.length === 0 && <tr><td colSpan={5} className="text-ter">loading markets...</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
