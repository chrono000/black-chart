import { Routes, Route, Link, useLocation } from 'react-router';

import { HomePage } from './app/pages/HomePage';
import { TradePage } from './app/pages/TradePage';
import { WalletPage } from './app/pages/WalletPage';
import { AccountPage } from './app/pages/AccountPage';
import { LoginPage } from './app/pages/LoginPage';
import { SignupPage } from './app/pages/SignupPage';
import { PricesPage } from './app/pages/PricesPage';
import { MarketsPage } from './app/pages/MarketsPage';
import { ChartPage } from './app/pages/ChartPage';
import { ConvertPage } from './app/pages/ConvertPage';
import { EarnPage } from './app/pages/EarnPage';
import { CoinPage } from './app/pages/CoinPage';
import { EventsPage } from './app/pages/EventsPage';
import { EventsBell } from './app/components/EventsBell';
import { useAuth } from './app/lib/AuthContext';
import { useExchange } from './app/lib/ExchangeContext';

declare const __API_HOST__: string;

function resolveApi(): { host: string; isSandbox: boolean } {
  const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
  let host = 'api.hollaex.com';
  try {
    host = apiUrl ? new URL(apiUrl).host : (typeof __API_HOST__ !== 'undefined' ? __API_HOST__ : host);
  } catch { /* keep default */ }
  return { host, isSandbox: host.includes('sandbox') };
}

function Layout() {
  const location = useLocation();

  const { isAuthenticated, isPaper, logout, paperLogin } = useAuth();
  const { constants, isLoading } = useExchange();
  const { host, isSandbox } = resolveApi();
  const systemStatus = isLoading ? 'connecting' : constants ? 'operational' : 'degraded';

  // Three banner states: paper (simulated), signed-out (browsing live data, can't move
  // funds), and signed-in real/sandbox (real funds — make that unmistakable).
  const loggedOutLive = !isAuthenticated && !isPaper;
  const darkBanner = isPaper || loggedOutLive; // dark background → light text/button
  const bannerBg = isPaper ? '#2563eb' : loggedOutLive ? 'var(--bg-tertiary)' : isSandbox ? '#d6a700' : 'var(--brand-down)';
  const bannerMsg = isPaper
    ? 'SIMULATED · PAPER TRADING'
    : loggedOutLive
      ? `NOT SIGNED IN · VIEWING ${host}`
      : `${isSandbox ? 'SANDBOX · TEST FUNDS' : 'LIVE · REAL FUNDS'} · ${host}`;
  const bannerBtn = darkBanner
    ? { background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: '10px', padding: '1px 6px', cursor: 'pointer', fontWeight: 'normal', letterSpacing: '0.5px' }
    : { background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(0,0,0,0.4)', color: 'var(--bg-primary)', fontSize: '10px', padding: '1px 6px', cursor: 'pointer', fontWeight: 'normal', letterSpacing: '0.5px' };

  const navItems = [
    { path: '/', label: 'home' },
    { path: '/prices', label: 'prices' },
    { path: '/markets', label: 'markets' },
    { path: '/trade', label: 'trade' },
    { path: '/convert', label: 'convert' },
    { path: '/earn', label: 'earn' },
    { path: '/wallet', label: 'wallet' },
    { path: '/events', label: 'events' },
    { path: '/account', label: 'account' },
  ];

  return (
    <div className="container">
      {/* Environment banner — make real-money vs test unmistakable */}
      <div
        style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px',
          padding: '3px 8px', marginBottom: '10px',
          fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px',
          color: darkBanner ? (isPaper ? '#fff' : 'var(--text-secondary)') : 'var(--bg-primary)',
          backgroundColor: bannerBg,
        }}
      >
        <span>{bannerMsg}</span>
        {isPaper ? (
          <button onClick={logout} style={bannerBtn}>switch to live</button>
        ) : (
          <button onClick={paperLogin} style={bannerBtn}>switch to simulated</button>
        )}
      </div>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>black chart // hollaex</div>
        {!isAuthenticated && (
          <div style={{ display: 'flex', gap: '12px' }}>
            <Link to="/login">[login]</Link>
            <Link to="/signup" className="text-up">[signup]</Link>
          </div>
        )}
      </header>
      <div className="divider" />

      {/* Nav — sticks to the top on mobile so it stays reachable when scrolling.
          Lives outside <header> so its sticky containing block is the full page. */}
      <nav className={location.pathname === '/trade' ? 'nav-no-pin' : undefined} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px' }}>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={location.pathname === item.path ? '' : 'text-sec'}
          >
            [{item.label}]
          </Link>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <EventsBell />
          {isAuthenticated && (
            <span className="text-up" style={{ fontSize: '11px', alignSelf: 'center' }}>[authed]</span>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/prices" element={<PricesPage />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/trade" element={<TradePage />} />
          <Route path="/convert" element={<ConvertPage />} />
          <Route path="/earn" element={<EarnPage />} />
          <Route path="/coin/:symbol" element={<CoinPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer style={{ marginTop: '40px' }}>
        <div className="divider" />
        <div className="text-ter footer-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>black chart</span>
          <span>api: <span style={{ color: 'var(--text-secondary)' }}>{host}/v2</span> · data: <span style={{ color: 'var(--text-secondary)' }}>hollaex</span> · auth: <span style={{ color: 'var(--text-secondary)' }}>bearer</span></span>
          <span>system: <span style={{ color: systemStatus === 'degraded' ? 'var(--brand-down)' : 'var(--text-secondary)' }}>{systemStatus}</span></span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/chart" element={<ChartPage />} />
      <Route path="/*" element={<Layout />} />
    </Routes>
  );
}
