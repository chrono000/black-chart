import { useExchange } from '../../lib/ExchangeContext';
import { selectStyle } from '../../lib/ui';

const QUOTES = ['usdt', 'usd', 'eur', 'btc', 'eth'];
const THEMES = ['dark', 'light'] as const;

// Preferences that actually change the app: theme + the currency balances are valued in.
// Stored locally (works in live and paper); no account round-trip needed.
export function AccountPreferences() {
  const { theme, setTheme, displayCurrency, setDisplayCurrency } = useExchange();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '380px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-ter">theme</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              style={{ borderColor: theme === t ? 'var(--text-primary)' : 'var(--border-light)', color: theme === t ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              [{t}]
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-ter">display currency</span>
        <select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)} style={selectStyle}>
          {QUOTES.map((q) => <option key={q} value={q}>{q.toUpperCase()}</option>)}
        </select>
      </div>

      <div className="text-ter" style={{ fontSize: '11px', lineHeight: '1.5' }}>
        display currency sets how your wallet balances and portfolio value are valued.
        preferences are saved on this device.
      </div>
    </div>
  );
}
