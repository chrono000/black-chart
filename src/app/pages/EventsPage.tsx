import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { chipProps } from '../lib/ui';
import { num } from '../../api/market';
import { publicApi } from '../../api/endpoints/public';
import { userApi } from '../../api/endpoints/user';
import { orderApi } from '../../api/endpoints/order';

type EvType = 'announcement' | 'deposit' | 'withdrawal' | 'trade' | 'order' | 'login';
interface EventItem {
  id: string;
  type: EvType;
  ts: number;
  title: string;
  detail?: string;
  tone: 'up' | 'down' | 'neutral';
}

const FILTERS: { key: 'all' | EvType; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'announcement', label: 'announcements' },
  { key: 'trade', label: 'trades' },
  { key: 'order', label: 'orders' },
  { key: 'deposit', label: 'deposits' },
  { key: 'withdrawal', label: 'withdrawals' },
  { key: 'login', label: 'security' },
];

const TAG: Record<EvType, { label: string; cls: string }> = {
  announcement: { label: 'NEWS', cls: 'text-sec' },
  deposit: { label: 'DEPOSIT', cls: 'text-up' },
  withdrawal: { label: 'WITHDRAW', cls: 'text-down' },
  trade: { label: 'TRADE', cls: 'text-sec' },
  order: { label: 'ORDER', cls: 'text-sec' },
  login: { label: 'LOGIN', cls: 'text-ter' },
};

const ms = (v: any) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; };
const fmt = (t: number) => {
  if (!t) return '—';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const sym = (s: any) => String(s || '').toUpperCase();
const stripHtml = (s: any) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

export function EventsPage() {
  const { isAuthenticated, isPaper, paper } = useAuth();
  const [filter, setFilter] = useState<'all' | EvType>('all');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const tasks: Promise<EventItem[]>[] = [
      publicApi.getAnnouncements({ limit: 20 })
        .then((r) => (r.data || []).map((a: any, i: number): EventItem => ({
          id: `ann-${a.id ?? i}`, type: 'announcement', ts: ms(a.created_at), title: a.title || 'announcement', detail: a.message ? stripHtml(a.message).slice(0, 140) : undefined, tone: 'neutral',
        })))
        .catch(() => []),
    ];

    if (isAuthenticated && !isPaper) {
      tasks.push(
        userApi.getDeposits({ limit: 30 }).then((r) => (r.data || []).map((d: any, i: number): EventItem => ({
          id: `dep-${d.id ?? i}`, type: 'deposit', ts: ms(d.created_at), title: `Deposit ${num(d.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym(d.currency)}`, detail: (d.network ? sym(d.network) + ' · ' : '') + (d.status ? 'completed' : 'pending'), tone: 'up',
        }))).catch(() => []),
        userApi.getWithdrawals({ limit: 30 }).then((r) => (r.data || []).map((w: any, i: number): EventItem => ({
          id: `wd-${w.id ?? i}`, type: 'withdrawal', ts: ms(w.created_at), title: `Withdraw ${num(w.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym(w.currency)}`, detail: (w.network ? sym(w.network) + ' · ' : '') + (w.dismissed || w.dissmissed ? 'canceled' : w.rejected ? 'rejected' : w.status ? 'completed' : 'pending'), tone: 'down',
        }))).catch(() => []),
        userApi.getTrades({ limit: 30 }).then((r) => (r.data || []).map((t: any, i: number): EventItem => ({
          id: `tr-${i}`, type: 'trade', ts: ms(t.timestamp || t.created_at), title: `${t.side} ${num(t.size).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym(t.symbol)}`, detail: `@ ${num(t.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}`, tone: t.side === 'sell' ? 'down' : 'up',
        }))).catch(() => []),
        orderApi.getAllOrders({ limit: 30, order_by: 'created_at', order: 'desc' }).then((r) => (r.data || []).map((o: any): EventItem => ({
          id: `ord-${o.id}`, type: 'order', ts: ms(o.created_at), title: `${o.side} ${o.type} ${sym(o.symbol)}`, detail: `${o.status}${o.price ? ' @ ' + o.price : ''}`, tone: o.side === 'sell' ? 'down' : 'up',
        }))).catch(() => []),
        userApi.getLogins({ limit: 20 }).then((r) => (r.data || []).map((l: any, i: number): EventItem => ({
          id: `lg-${i}`, type: 'login', ts: ms(l.timestamp), title: `Login ${l.ip || ''}`, detail: l.device || undefined, tone: 'neutral',
        }))).catch(() => []),
      );
    }

    Promise.all(tasks).then((parts) => {
      if (cancelled) return;
      let all = parts.flat();
      if (isPaper && paper) {
        all = all.concat(
          paper.trades.map((t, i): EventItem => ({ id: `ptr-${i}-${t.timestamp}`, type: 'trade', ts: ms(t.timestamp), title: `${t.side} ${num(t.size).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym(t.symbol)}`, detail: `@ ${num(t.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}`, tone: t.side === 'sell' ? 'down' : 'up' })),
          paper.orders.map((o): EventItem => ({ id: `pord-${o.id}`, type: 'order', ts: ms(o.created_at), title: `${o.side} ${o.type} ${sym(o.symbol)}`, detail: `${o.status}${o.price ? ' @ ' + o.price : ''}`, tone: o.side === 'sell' ? 'down' : 'up' })),
          paper.deposits.map((d): EventItem => ({ id: `pdep-${d.id}`, type: 'deposit', ts: ms(d.created_at), title: `Deposit ${num(d.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym(d.currency)}`, detail: 'simulated', tone: 'up' })),
          paper.withdrawals.map((w): EventItem => ({ id: `pwd-${w.id}`, type: 'withdrawal', ts: ms(w.created_at), title: `Withdraw ${num(w.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym(w.currency)}`, detail: 'simulated', tone: 'down' })),
        );
      }
      all.sort((a, b) => b.ts - a.ts);
      setEvents(all);
    }).finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [isAuthenticated, isPaper, paper]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.type === filter);

  return (
    <div>
      <div className="text-sec">:: events</div>
      <div className="divider" />

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === 'all' ? events.length : events.filter((e) => e.type === f.key).length;
          return (
            <span key={f.key} className="interact" {...chipProps(() => setFilter(f.key))}
              style={{ padding: '0 2px', color: active ? 'var(--bg-primary)' : 'var(--text-secondary)', backgroundColor: active ? 'var(--text-primary)' : 'transparent', fontWeight: active ? 'bold' : 'normal' }}>
              {active ? ` ${f.label} ` : `[${f.label}]`}<span className="text-ter" style={{ fontSize: '10px' }}> {n}</span>
            </span>
          );
        })}
      </div>

      {loading && events.length === 0 ? (
        <div className="text-ter">loading events...</div>
      ) : filtered.length === 0 ? (
        <div className="text-ter">no {filter === 'all' ? '' : filter + ' '}events{!isAuthenticated ? ' — log in for your account activity' : ''}.</div>
      ) : (
        <table style={{ fontSize: '12px', width: '100%' }}>
          <thead>
            <tr><th style={{ width: '130px' }}>time</th><th style={{ width: '90px' }}>type</th><th>event</th></tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td className="text-ter" style={{ whiteSpace: 'nowrap' }}>{fmt(e.ts)}</td>
                <td className={TAG[e.type].cls}>[{TAG[e.type].label}]</td>
                <td>
                  <span className={e.tone === 'up' ? 'text-up' : e.tone === 'down' ? 'text-down' : ''}>{e.title}</span>
                  {e.detail && <span className="text-ter"> · {e.detail}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
