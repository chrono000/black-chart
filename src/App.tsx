import { Routes, Route, Link, useLocation } from 'react-router';

import { HomePage } from './app/pages/HomePage';
import { TradePage } from './app/pages/TradePage';
import { WalletPage } from './app/pages/WalletPage';
import { AccountPage } from './app/pages/AccountPage';
import { LoginPage } from './app/pages/LoginPage';
import { SignupPage } from './app/pages/SignupPage';
import { PricesPage } from './app/pages/PricesPage';
import { ChartPage } from './app/pages/ChartPage';
import { ConvertPage } from './app/pages/ConvertPage';
import { EarnPage } from './app/pages/EarnPage';
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

  const { isAuthenticated, isPaper } = useAuth();
  const { constants, isLoading } = useExchange();
  const { host, isSandbox } = resolveApi();
  const systemStatus = isLoading ? 'connecting' : constants ? 'operational' : 'degraded';

  const bannerBg = isPaper ? '#2563eb' : isSandbox ? '#d6a700' : 'var(--brand-down)';
  const bannerText = isPaper
    ? 'SIMULATED · PAPER TRADING'
    : `${isSandbox ? 'SANDBOX · TEST FUNDS' : 'LIVE · REAL FUNDS'} · ${host}`;

  const navItems = [
    { path: '/', label: 'home' },
    { path: '/prices', label: 'prices' },
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
          textAlign: 'center', padding: '3px 0', marginBottom: '10px',
          fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px',
          color: isPaper ? '#fff' : 'var(--bg-primary)',
          backgroundColor: bannerBg,
        }}
      >
        {bannerText}
      </div>
      {/* Header / Nav */}
      <header>
        <div>black chart // hollaex</div>
        <div className="divider" />
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 18px', marginBottom: '20px' }}>
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
            {!isAuthenticated ? (
              <>
                <Link to="/login" className="text-sec">[login]</Link>
                <Link to="/signup" className="text-sec">[signup]</Link>
              </>
            ) : (
              <span className="text-up" style={{ fontSize: '11px', alignSelf: 'center' }}>[authed]</span>
            )}
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/prices" element={<PricesPage />} />
          <Route path="/trade" element={<TradePage />} />
          <Route path="/convert" element={<ConvertPage />} />
          <Route path="/earn" element={<EarnPage />} />
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
