import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { orderApi } from '../../../api/endpoints/order';
import { userApi } from '../../../api/endpoints/user';
import { num } from '../../../api/market';
import { chipProps } from '../../lib/ui';

type Tab = 'orders' | 'trades';

const fmtTime = (v: any) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

// Order & trade history. Live: getAllOrders (all statuses) + getUserTrades.
// Paper: the local engine's orders + simulated fills.
export function AccountHistory() {
  const { isPaper, paper } = useAuth();
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isPaper) {
      setOrders(paper?.orders || []);
      setTrades(paper?.trades || []);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      orderApi.getAllOrders({ limit: 50, order_by: 'created_at', order: 'desc' }).then((r) => r.data || []).catch(() => []),
      userApi.getTrades({ limit: 50, order_by: 'timestamp', order: 'desc' }).then((r) => r.data || []).catch(() => []),
    ]).then(([o, t]) => { if (!cancelled) { setOrders(o); setTrades(t); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isPaper, paper]);

  const rows = tab === 'orders' ? orders : trades;

  return (
    <div>
      <div style={{ display: 'flex', gap: '15px', marginBottom: '12px' }}>
        {(['orders', 'trades'] as const).map((t) => (
          <span key={t} className="interact" {...chipProps(() => setTab(t))} style={{ color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[{t}]</span>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <div className="text-ter">loading {tab}...</div>
      ) : rows.length === 0 ? (
        <div className="text-ter">no {tab} {isPaper ? 'in this paper session' : 'found'}.</div>
      ) : tab === 'orders' ? (
        <table style={{ fontSize: '12px', width: '100%' }}>
          <thead>
            <tr><th>date</th><th>pair</th><th>side</th><th>type</th><th>price</th><th>size</th><th>filled</th><th>status</th></tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={o.id ?? i} className={o.side === 'sell' ? 'text-down' : 'text-up'}>
                <td className="text-sec">{fmtTime(o.created_at)}</td>
                <td>{String(o.symbol || '').toUpperCase()}</td>
                <td>{o.side}</td>
                <td className="text-sec">{o.type}</td>
                <td>{o.price ?? '—'}</td>
                <td>{num(o.size).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className="text-sec">{num(o.filled).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className="text-sec">{o.status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table style={{ fontSize: '12px', width: '100%' }}>
          <thead>
            <tr><th>date</th><th>pair</th><th>side</th><th>price</th><th>size</th><th>total</th></tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={i} className={t.side === 'sell' ? 'text-down' : 'text-up'}>
                <td className="text-sec">{fmtTime(t.timestamp || t.created_at)}</td>
                <td>{String(t.symbol || '').toUpperCase()}</td>
                <td>{t.side}</td>
                <td>{num(t.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td>{num(t.size).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className="text-sec">{(num(t.price) * num(t.size)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
