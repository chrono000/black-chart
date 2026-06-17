import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../lib/AuthContext';
import { stakeApi } from '../../api/endpoints/stake';
import { num } from '../../api/market';
import type { StakePool, Staker } from '../../api/types';

const fmtAmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 8 });
const fmtDuration = (d?: number) => (d && d > 0 ? `${d}d` : 'flexible');
const msgClass = (m: string) => (m.startsWith('✓') ? 'text-up' : m.startsWith('✗') ? 'text-down' : 'text-sec');

export function EarnPage() {
  const { isAuthenticated, isPaper, balance, refreshBalance } = useAuth();

  const [pools, setPools] = useState<StakePool[]>([]);
  const [stakes, setStakes] = useState<Staker[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // staking form (one pool at a time)
  const [openPool, setOpenPool] = useState<StakePool | null>(null);
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!isAuthenticated || isPaper) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      stakeApi.getStakes({ limit: 100 }).then((r) => r.data || []).catch(() => null),
      stakeApi.getStakers({ limit: 100, order_by: 'created_at', order: 'desc' }).then((r) => r.data || []).catch(() => []),
    ]).then(([p, s]) => {
      if (p === null) { setErr('could not load staking pools — staking may be disabled on this exchange.'); setPools([]); }
      else { setErr(''); setPools(p.filter((x) => x.status !== 'uninitialized')); }
      setStakes(s);
    }).finally(() => setLoading(false));
  }, [isAuthenticated, isPaper]);

  useEffect(() => { load(); }, [load]);

  const beginStake = (pool: StakePool) => {
    setOpenPool(pool); setAmount(''); setConfirming(false); setMsg('');
  };

  const amtNum = parseFloat(amount);
  const poolAvail = openPool ? num(balance?.[`${openPool.currency}_available`]) : 0;

  const startConfirm = () => {
    if (!openPool || !(amtNum > 0)) return;
    if (openPool.min_amount && amtNum < openPool.min_amount) { setMsg(`✗ minimum is ${fmtAmt(openPool.min_amount)} ${openPool.currency.toUpperCase()}`); return; }
    if (openPool.max_amount && amtNum > openPool.max_amount) { setMsg(`✗ maximum is ${fmtAmt(openPool.max_amount)} ${openPool.currency.toUpperCase()}`); return; }
    if (amtNum > poolAvail + 1e-9) { setMsg(`✗ insufficient ${openPool.currency.toUpperCase()}`); return; }
    setMsg(''); setConfirming(true);
  };

  const doStake = async () => {
    if (!openPool || !(amtNum > 0)) return;
    setBusy(true); setMsg('staking...');
    try {
      await stakeApi.createStaker({ stake_id: openPool.id, amount: amtNum });
      setMsg('✓ stake submitted'); setOpenPool(null); setAmount(''); setConfirming(false);
      refreshBalance(); load();
    } catch (e: any) {
      setMsg(`✗ ${e?.message || 'stake failed'}`); setConfirming(false);
    } finally { setBusy(false); }
  };

  const unstake = async (s: Staker) => {
    if (!window.confirm(`unstake ${fmtAmt(num(s.amount))} ${s.currency.toUpperCase()}? early unstaking may forfeit rewards.`)) return;
    setMsg('unstaking...');
    try {
      await stakeApi.deleteStaker(s.id);
      setMsg('✓ unstake requested'); refreshBalance(); load();
    } catch (e: any) { setMsg(`✗ ${e?.message || 'unstake failed'}`); }
  };

  return (
    <div>
      <div className="text-sec">:: earn</div>
      <div className="divider" />

      {isPaper ? (
        <div className="text-ter" style={{ fontSize: '12px', lineHeight: '1.7' }}>
          staking runs against a real account — not available in paper trading.
          <br />
          <Link to="/login" className="text-primary">[log in]</Link> to stake real assets and earn rewards.
        </div>
      ) : !isAuthenticated ? (
        <div className="text-ter" style={{ fontSize: '12px', lineHeight: '1.7' }}>
          stake your assets to earn rewards.
          <br />
          <Link to="/login" className="text-primary">[login]</Link> or <Link to="/signup" className="text-primary">[signup]</Link> to get started.
        </div>
      ) : loading ? (
        <div className="text-ter">loading staking...</div>
      ) : (
        <>
          {msg && <div style={{ fontSize: '11px', marginBottom: '12px' }} className={msgClass(msg)}>{msg}</div>}

          {/* YOUR STAKES */}
          {stakes.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <div className="text-sec" style={{ marginBottom: '8px' }}>[ your_stakes ]</div>
              <table style={{ fontSize: '12px', width: '100%' }}>
                <thead><tr><th>asset</th><th>amount</th><th>reward</th><th>status</th><th>since</th><th>action</th></tr></thead>
                <tbody>
                  {stakes.map((s) => {
                    const active = s.status === 'staking' || s.status === 'active' || s.status === 'unlocked';
                    return (
                      <tr key={s.id}>
                        <td>{s.currency?.toUpperCase()}</td>
                        <td className="text-sec">{fmtAmt(num(s.amount))}</td>
                        <td className="text-up">{num(s.reward) > 0 ? `+${fmtAmt(num(s.reward))}` : '—'}</td>
                        <td className={active ? 'text-up' : 'text-ter'}>{s.status}</td>
                        <td className="text-ter">{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                        <td>{active
                          ? <span role="button" tabIndex={0} className="interact text-down" onClick={() => unstake(s)} onKeyDown={(e) => { if (e.key === 'Enter') unstake(s); }}>[unstake]</span>
                          : <span className="text-ter">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* AVAILABLE POOLS */}
          <div className="text-sec" style={{ marginBottom: '8px' }}>[ staking_pools ]</div>
          {err ? (
            <div className="text-ter" style={{ fontSize: '12px' }}>{err}</div>
          ) : pools.length === 0 ? (
            <div className="text-ter">no staking pools available right now.</div>
          ) : (
            <table style={{ fontSize: '12px', width: '100%' }}>
              <thead><tr><th>pool</th><th>asset</th><th>est. apy</th><th>lock</th><th>min</th><th>action</th></tr></thead>
              <tbody>
                {pools.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="text-sec">{p.currency?.toUpperCase()}{p.reward_currency && p.reward_currency !== p.currency ? ` → ${p.reward_currency.toUpperCase()}` : ''}</td>
                    <td className="text-up">{p.apy != null ? `${num(p.apy).toFixed(2)}%` : '—'}</td>
                    <td className="text-ter">{fmtDuration(p.duration)}{p.slashing ? ' · slashing' : ''}</td>
                    <td className="text-ter">{p.min_amount ? fmtAmt(p.min_amount) : '—'}</td>
                    <td>
                      {p.status === 'active'
                        ? <span role="button" tabIndex={0} className="interact text-primary" onClick={() => beginStake(p)} onKeyDown={(e) => { if (e.key === 'Enter') beginStake(p); }}>[stake]</span>
                        : <span className="text-ter">{p.status}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* STAKE FORM */}
          {openPool && (
            <div style={{ marginTop: '20px', padding: '14px', border: '1px dashed var(--brand-up)', maxWidth: '420px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span className="text-sec">stake into {openPool.name}</span>
                <span role="button" tabIndex={0} className="interact text-ter" onClick={() => { setOpenPool(null); setConfirming(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { setOpenPool(null); setConfirming(false); } }}>[×]</span>
              </div>
              <div className="text-ter" style={{ fontSize: '11px', marginBottom: '6px' }}>
                available: {fmtAmt(poolAvail)} {openPool.currency.toUpperCase()}
                {poolAvail > 0 && (
                  <span role="button" tabIndex={0} className="interact text-sec" style={{ marginLeft: '8px' }}
                    onClick={() => setAmount(String(openPool.max_amount ? Math.min(poolAvail, openPool.max_amount) : poolAvail))}
                    onKeyDown={(e) => { if (e.key === 'Enter') setAmount(String(poolAvail)); }}>[max]</span>
                )}
              </div>
              {!confirming ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`0.00 ${openPool.currency.toUpperCase()}`} style={{ flex: 1 }} />
                  <button disabled={!(amtNum > 0)} onClick={startConfirm} style={{ borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>[stake]</button>
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: '8px' }}>
                    confirm: stake <span className="text-up">{fmtAmt(amtNum)} {openPool.currency.toUpperCase()}</span>
                    {openPool.apy != null && <span className="text-ter"> · est. {num(openPool.apy).toFixed(2)}% apy</span>}
                    {openPool.duration ? <span className="text-ter"> · locked {openPool.duration}d</span> : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button disabled={busy} onClick={doStake} style={{ flex: 1, borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>{busy ? '[staking...]' : '[confirm →]'}</button>
                    <button disabled={busy} onClick={() => setConfirming(false)} className="text-ter">[cancel]</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-ter" style={{ fontSize: '11px', marginTop: '18px' }}>
            staking locks assets for a reward; APYs are estimates and rewards/penalties settle on HollaEx.
          </div>
        </>
      )}
    </div>
  );
}
