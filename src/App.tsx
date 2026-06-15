import { Routes, Route, Link, useLocation } from 'react-router';

import { HomePage } from './app/pages/HomePage';
import { TradePage } from './app/pages/TradePage';
import { WalletPage } from './app/pages/WalletPage';
import { AccountPage } from './app/pages/AccountPage';
import { LoginPage } from './app/pages/LoginPage';
import { SignupPage } from './app/pages/SignupPage';
import { PricesPage } from './app/pages/PricesPage';
import { ChartPage } from './app/pages/ChartPage';
import { useAuth } from './app/lib/AuthContext';

function Layout() {
  const location = useLocation();
  
  const { isAuthenticated } = useAuth();

  const navItems = [
    { path: '/', label: 'home' },
    { path: '/prices', label: 'prices' },
    { path: '/trade', label: 'trade' },
    { path: '/wallet', label: 'wallet' },
    { path: '/account', label: 'account' },
  ];

  return (
    <div className="container">
      {/* Header / Nav */}
      <header>
        <div>black chart // hollaex</div>
        <div className="divider" />
        <nav style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
          {navItems.map(item => (
            <Link 
              key={item.path} 
              to={item.path}
              className={location.pathname === item.path ? '' : 'text-sec'}
            >
              [{item.label}]
            </Link>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
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
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer style={{ marginTop: '40px' }}>
        <div className="divider" />
        <div className="text-ter" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>black chart</span>
          <span>api: <span style={{ color: 'var(--text-secondary)' }}>hollaex.com/v2</span> · data: <span style={{ color: 'var(--text-secondary)' }}>hollaex</span> · auth: <span style={{ color: 'var(--text-secondary)' }}>bearer + hmac</span></span>
          <span>system: operational</span>
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
