import { useExchange } from '../lib/ExchangeContext';
import { useAuth } from '../lib/AuthContext';
import { num } from '../../api/market';
import { Link } from 'react-router';

export function HomePage() {
  const { tickers, constants } = useExchange();
  const { user } = useAuth();

  const pairs = Object.values(constants?.pairs || {}).filter(p => p.active);
  // Sort by volume descending
  const sortedPairs = pairs.sort((a, b) => num(tickers[b.name]?.volume) - num(tickers[a.name]?.volume));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="text-sec">:: market_overview</span>
        {user ? (
          <span className="text-up">logged_in: {user.email}</span>
        ) : (
          <span className="text-ter">viewer_mode</span>
        )}
      </div>
      <div className="divider" />
      
      <table>
        <thead>
          <tr>
            <th>pair</th>
            <th>last_price</th>
            <th>24h_chg</th>
            <th>24h_vol</th>
            <th>action</th>
          </tr>
        </thead>
        <tbody>
          {sortedPairs.map(pair => {
            const ticker = tickers[pair.name];
            if (!ticker) return null;

            const last = num(ticker.last);
            const open = num(ticker.open);
            const close = num(ticker.close);
            const hasChange = open > 0;
            const isUp = close >= open;
            const changePct = hasChange ? ((close - open) / open) * 100 : 0;
            const changeStr = `${isUp ? '+' : ''}${changePct.toFixed(2)}%`;
            const colorClass = isUp ? 'text-up' : 'text-down';

            return (
              <tr key={pair.name}>
                <td>{pair.name.toUpperCase()}</td>
                <td>{last.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className={hasChange ? colorClass : 'text-ter'}>
                  {hasChange ? `${isUp ? '▲' : '▼'} ${changeStr}` : '—'}
                </td>
                <td className="text-sec">{num(ticker.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td>
                  <Link to={`/trade?pair=${pair.name}`} className="text-primary">[trade]</Link>
                </td>
              </tr>
            );
          })}
          {sortedPairs.length === 0 && (
            <tr><td colSpan={5} className="text-ter">loading markets...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
