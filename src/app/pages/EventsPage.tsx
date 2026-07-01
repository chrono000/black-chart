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
  detail?: string;             // short one-liner shown collapsed
  tone: 'up' | 'down' | 'neutral';
  meta?: { k: string; v: string }[]; // key/value rows revealed on expand
  body?: string;               // long free text (e.g. announcement message)
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
const qty = (v: any) => num(v).toLocaleString(undefined, { maximumFractionDigits: 8 });
const amt = (v: any, c: any) => `${qty(v)} ${sym(c)}`;
const quoteOf = (pair: any) => sym(String(pair || '').split('-')[1] || '');

// Build an ordered key/value list, dropping empty / non-finite values.
const metaOf = (pairs: Array<[string, any]>): { k: string; v: string }[] =>
  pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)))
    .map(([k, v]) => ({ k, v: String(v) }));

const txStatus = (o: any): string =>
  o.dismissed || o.dissmissed ? 'canceled' : o.rejected ? 'rejected' : o.status === true || o.status === 'COMPLETED' || o.status === 1 ? 'completed' : o.waiting ? 'waiting' : o.processing ? 'processing' : 'pending';

export function EventsPage() {
  const { isAuthenticated, isPaper, paper } = useAuth();
  const [filter, setFilter] = useState<'all' | EvType>('all');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const tasks: Promise<EventItem[]>[] = [
      publicApi.getAnnouncements({ limit: 20 })
        .then((r) => (r.data || []).map((a: any, i: number): EventItem => {
          const full = stripHtml(a.message);
          return {
            id: `ann-${a.id ?? i}`, type: 'announcement', ts: ms(a.created_at),
            title: a.title || 'announcement',
            detail: full ? full.slice(0, 90) + (full.length > 90 ? '…' : '') : undefined,
            tone: 'neutral',
            body: full || undefined,
            meta: metaOf([['posted', fmt(ms(a.created_at))], ['type', a.type], ['id', a.id]]),
          };
        }))
        .catch(() => []),
    ];

    if (isAuthenticated && !isPaper) {
      tasks.push(
        userApi.getDeposits({ limit: 30 }).then((r) => (r.data || []).map((d: any, i: number): EventItem => {
          const st = txStatus(d);
          return {
            id: `dep-${d.id ?? i}`, type: 'deposit', ts: ms(d.created_at),
            title: `Deposit ${amt(d.amount, d.currency)}`,
            detail: (d.network ? sym(d.network) + ' · ' : '') + st, tone: 'up',
            meta: metaOf([
              ['amount', amt(d.amount, d.currency)],
              ['network', d.network ? sym(d.network) : ''],
              ['status', st],
              ['fee', d.fee != null && num(d.fee) > 0 ? amt(d.fee, d.currency) : ''],
              ['address', d.address],
              ['tx id', d.transaction_id],
              ['time', fmt(ms(d.created_at))],
            ]),
          };
        })).catch(() => []),
        userApi.getWithdrawals({ limit: 30 }).then((r) => (r.data || []).map((w: any, i: number): EventItem => {
          const st = txStatus(w);
          const isEmail = String(w.network || '').toLowerCase() === 'email';
          return {
            id: `wd-${w.id ?? i}`, type: 'withdrawal', ts: ms(w.created_at),
            title: `Withdraw ${amt(w.amount, w.currency)}`,
            detail: (isEmail ? 'EMAIL · ' : w.network ? sym(w.network) + ' · ' : '') + st, tone: 'down',
            meta: metaOf([
              ['amount', amt(w.amount, w.currency)],
              ['network', isEmail ? 'EMAIL (internal)' : w.network ? sym(w.network) : ''],
              [isEmail ? 'recipient' : 'address', w.address],
              ['status', st],
              ['fee', w.fee != null && num(w.fee) > 0 ? amt(w.fee, w.currency) : (isEmail ? 'none (internal)' : '')],
              ['tx id', w.transaction_id],
              ['time', fmt(ms(w.created_at))],
            ]),
          };
        })).catch(() => []),
        userApi.getTrades({ limit: 30 }).then((r) => (r.data || []).map((t: any, i: number): EventItem => {
          const q = quoteOf(t.symbol);
          const base = String(t.symbol).split('-')[0];
          // HollaEx charges the trade fee in the asset received: quote on a sell, base on a buy.
          const feeCcy = t.side === 'sell' ? q : sym(base);
          const total = num(t.size) * num(t.price);
          return {
            id: `tr-${i}`, type: 'trade', ts: ms(t.timestamp || t.created_at),
            title: `${t.side} ${qty(t.size)} ${sym(base)}`,
            detail: `@ ${qty(t.price)}${q ? ' ' + q : ''}`, tone: t.side === 'sell' ? 'down' : 'up',
            meta: metaOf([
              ['side', String(t.side || '').toUpperCase()],
              ['pair', sym(t.symbol)],
              ['price', `${qty(t.price)}${q ? ' ' + q : ''}`],
              ['size', amt(t.size, base)],
              ['total', total > 0 ? `${total.toLocaleString(undefined, { maximumFractionDigits: 8 })}${q ? ' ' + q : ''}` : ''],
              ['fee', t.fee != null && num(t.fee) > 0 ? `${qty(t.fee)}${feeCcy ? ' ' + feeCcy : ''}` : ''],
              ['time', fmt(ms(t.timestamp || t.created_at))],
            ]),
          };
        })).catch(() => []),
        orderApi.getAllOrders({ limit: 30, order_by: 'created_at', order: 'desc' }).then((r) => (r.data || []).map((o: any): EventItem => {
          const q = quoteOf(o.symbol);
          const base = String(o.symbol).split('-')[0];
          return {
            id: `ord-${o.id}`, type: 'order', ts: ms(o.created_at),
            title: `${o.side} ${o.type} ${sym(o.symbol)}`,
            detail: `${o.status}${o.price ? ' @ ' + o.price : ''}`, tone: o.side === 'sell' ? 'down' : 'up',
            meta: metaOf([
              ['side', String(o.side || '').toUpperCase()],
              ['type', o.type],
              ['pair', sym(o.symbol)],
              ['price', o.price ? `${num(o.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}${q ? ' ' + q : ''}` : 'market'],
              ['stop', o.stop ? `${num(o.stop).toLocaleString(undefined, { maximumFractionDigits: 8 })}${q ? ' ' + q : ''}` : ''],
              ['size', amt(o.size, base)],
              ['filled', o.filled != null ? `${qty(o.filled)} / ${qty(o.size)}` : ''],
              ['status', o.status],
              ['time', fmt(ms(o.created_at))],
            ]),
          };
        })).catch(() => []),
        userApi.getLogins({ limit: 20 }).then((r) => (r.data || []).map((l: any, i: number): EventItem => ({
          id: `lg-${i}`, type: 'login', ts: ms(l.timestamp),
          title: `Login ${l.ip || ''}`.trim(), detail: l.device || l.domain || undefined, tone: 'neutral',
          meta: metaOf([
            ['ip', l.ip],
            ['device', l.device],
            ['domain', l.domain],
            ['time', fmt(ms(l.timestamp))],
          ]),
        }))).catch(() => []),
      );
    }

    Promise.all(tasks).then((parts) => {
      if (cancelled) return;
      let all = parts.flat();
      if (isPaper && paper) {
        all = all.concat(
          paper.trades.map((t, i): EventItem => {
            const q = quoteOf(t.symbol);
            const total = num(t.size) * num(t.price);
            return {
              id: `ptr-${i}-${t.timestamp}`, type: 'trade', ts: ms(t.timestamp),
              title: `${t.side} ${qty(t.size)} ${sym(String(t.symbol).split('-')[0])}`,
              detail: `@ ${qty(t.price)}${q ? ' ' + q : ''}`, tone: t.side === 'sell' ? 'down' : 'up',
              meta: metaOf([
                ['side', String(t.side).toUpperCase()],
                ['pair', sym(t.symbol)],
                ['price', `${qty(t.price)}${q ? ' ' + q : ''}`],
                ['size', amt(t.size, String(t.symbol).split('-')[0])],
                ['total', total > 0 ? `${total.toLocaleString(undefined, { maximumFractionDigits: 8 })}${q ? ' ' + q : ''}` : ''],
                ['time', fmt(ms(t.timestamp))],
                ['mode', 'simulated'],
              ]),
            };
          }),
          paper.orders.map((o): EventItem => {
            const q = quoteOf(o.symbol);
            const base = String(o.symbol).split('-')[0];
            return {
              id: `pord-${o.id}`, type: 'order', ts: ms(o.created_at),
              title: `${o.side} ${o.type} ${sym(o.symbol)}`,
              detail: `${o.status}${o.price ? ' @ ' + o.price : ''}`, tone: o.side === 'sell' ? 'down' : 'up',
              meta: metaOf([
                ['side', String(o.side).toUpperCase()],
                ['type', o.type],
                ['pair', sym(o.symbol)],
                ['price', o.price ? `${num(o.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}${q ? ' ' + q : ''}` : 'market'],
                ['stop', o.stop ? `${num(o.stop).toLocaleString(undefined, { maximumFractionDigits: 8 })}${q ? ' ' + q : ''}` : ''],
                ['size', amt(o.size, base)],
                ['filled', `${qty(o.filled)} / ${qty(o.size)}`],
                ['status', o.status],
                ['time', fmt(ms(o.created_at))],
                ['mode', 'simulated'],
              ]),
            };
          }),
          paper.deposits.map((d): EventItem => ({
            id: `pdep-${d.id}`, type: 'deposit', ts: ms(d.created_at),
            title: `Deposit ${amt(d.amount, d.currency)}`, detail: (d.network ? sym(d.network) + ' · ' : '') + 'simulated', tone: 'up',
            meta: metaOf([
              ['amount', amt(d.amount, d.currency)],
              ['network', d.network ? sym(d.network) : ''],
              ['status', 'completed'],
              ['time', fmt(ms(d.created_at))],
              ['mode', 'simulated'],
            ]),
          })),
          paper.withdrawals.map((w): EventItem => {
            const isEmail = String(w.network || '').toLowerCase() === 'email';
            return {
              id: `pwd-${w.id}`, type: 'withdrawal', ts: ms(w.created_at),
              title: `Withdraw ${amt(w.amount, w.currency)}`, detail: (isEmail ? 'EMAIL · ' : w.network ? sym(w.network) + ' · ' : '') + 'simulated', tone: 'down',
              meta: metaOf([
                ['amount', amt(w.amount, w.currency)],
                ['network', isEmail ? 'EMAIL (internal)' : w.network ? sym(w.network) : ''],
                ['fee', isEmail ? 'none (internal)' : ''],
                ['status', 'completed'],
                ['time', fmt(ms(w.created_at))],
                ['mode', 'simulated'],
              ]),
            };
          }),
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
        <div>
          {filtered.slice(0, 200).map((e) => {
            const isOpen = !!open[e.id];
            const hasMore = (e.meta && e.meta.length > 0) || !!e.body;
            const toneCls = e.tone === 'up' ? 'text-up' : e.tone === 'down' ? 'text-down' : '';
            return (
              <div key={e.id}>
                <div
                  className="event-row"
                  {...(hasMore ? chipProps(() => toggle(e.id)) : {})}
                  style={{ cursor: hasMore ? 'pointer' : 'default' }}
                  aria-expanded={hasMore ? isOpen : undefined}
                >
                  <div className="event-row-body">
                    <div className="event-row-line1">
                      <span className={`event-tag ${TAG[e.type].cls}`}>[{TAG[e.type].label}]</span>
                      <span className={toneCls}>{e.title}</span>
                      {e.detail && <span className="text-ter"> · {e.detail}</span>}
                    </div>
                    <div className="event-row-line2 text-ter">{fmt(e.ts)}</div>
                  </div>
                  {hasMore && <span className="event-chev text-ter" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>}
                </div>
                {isOpen && hasMore && (
                  <div className="event-detail">
                    {(e.meta || []).map((m, i) => (
                      <div key={i} className="event-detail-row">
                        <span className="event-detail-k text-ter">{m.k}</span>
                        <span className="event-detail-v">{m.v}</span>
                      </div>
                    ))}
                    {e.body && <div className="event-detail-body text-sec">{e.body}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
