import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../lib/AuthContext';
import { chipProps } from '../lib/ui';
import { stakeApi } from '../../api/endpoints/stake';
import { num } from '../../api/market';
import { PAPER_POOLS, paperStakeReward, paperStakeMatured } from '../lib/paper';

interface Pool {
  id: number;
  name: string;
  currency: string;
  reward_currency: string;
  apy: number;
  duration: number; // days; 0 = flexible
  min_amount: number;
  status: string;
}

interface MyStake {
  id: number;
  currency: string;
  reward_currency: string;
  amount: number;
  reward: number;
  apy: number;
  duration: number;
  created_at: string;
  status: string;
  matured: boolean;
  canUnstake: boolean;
}

const fmtAmt = (v: number, d = 8) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const fmtLock = (d: number) => (d > 0 ? `${d}d lock` : 'flexible');
const msgClass = (m: string) => (m.startsWith('✓') ? 'text-up' : m.startsWith('✗') ? 'text-down' : 'text-sec');
const DAY_MS = 24 * 3600 * 1000;

// Days remaining until a locked stake matures (0 if flexible / already matured).
const daysLeft = (s: MyStake, now: number) => {
  if (s.duration <= 0) return 0;
  const end = new Date(s.created_at).getTime() + s.duration * DAY_MS;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
};

export function EarnPage() {
  const { isAuthenticated, isPaper, balance, paper, refreshBalance } = useAuth();

  const [livePools, setLivePools] = useState<Pool[]>([]);
  const [liveStakes, setLiveStakes] = useState<MyStake[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // staking form
  const [openPool, setOpenPool] = useState<Pool | null>(null);
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // tick so paper rewards visibly accrue
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPaper) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isPaper]);

  const loadLive = useCallback(() => {
    if (isPaper || !isAuthenticated) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      stakeApi.getStakes({ limit: 100 }).then((r) => r.data || []).catch(() => null),
      stakeApi.getStakers({ limit: 100, order_by: 'created_at', order: 'desc' }).then((r) => r.data || []).catch(() => []),
    ]).then(([p, s]) => {
      let mapped: Pool[] = [];
      if (p === null) { setErr('could not load staking pools — staking may be disabled on this exchange.'); setLivePools([]); }
      else {
        setErr('');
        mapped = p.filter((x: any) => x.status !== 'uninitialized').map((x: any): Pool => ({
          id: x.id, name: x.name, currency: x.currency, reward_currency: x.reward_currency || x.currency,
          apy: num(x.apy), duration: num(x.duration), min_amount: num(x.min_amount), status: x.status,
        }));
        setLivePools(mapped);
      }
      // Staker objects don't carry apy / duration / reward_currency — recover them
      // from the matching pool via stake_id so the table shows correct terms.
      const poolById = new Map(mapped.map((pp) => [pp.id, pp]));
      setLiveStakes((s as any[]).map((x): MyStake => {
        const pool = poolById.get(x.stake_id);
        const active = x.status === 'staking' || x.status === 'active' || x.status === 'unlocked';
        return {
          id: x.id, currency: x.currency,
          reward_currency: x.reward_currency || pool?.reward_currency || x.currency,
          amount: num(x.amount), reward: num(x.reward),
          apy: pool?.apy ?? 0, duration: pool?.duration ?? 0,
          created_at: x.created_at, status: x.status, matured: x.status === 'unlocked', canUnstake: active,
        };
      }));
    }).finally(() => setLoading(false));
  }, [isPaper, isAuthenticated]);

  useEffect(() => { loadLive(); }, [loadLive]);

  // Unified view model: paper uses the simulated pools/stakes, live uses the API,
  // viewers see the paper pools as a representative preview.
  const pools: Pool[] = useMemo(() => {
    if (isPaper || !isAuthenticated) return PAPER_POOLS.map((p) => ({ ...p }));
    return livePools;
  }, [isPaper, isAuthenticated, livePools]);

  const stakes: MyStake[] = useMemo(() => {
    if (isPaper && paper) {
      return paper.stakes.map((s): MyStake => ({
        id: s.id, currency: s.currency, reward_currency: s.reward_currency, amount: s.amount,
        reward: paperStakeReward(s, now), apy: s.apy, duration: s.duration, created_at: s.created_at,
        status: s.status, matured: paperStakeMatured(s, now), canUnstake: true,
      }));
    }
    return liveStakes;
  }, [isPaper, paper, liveStakes, now]);

  // If the open pool disappears after a live refresh, close the stale form.
  useEffect(() => {
    if (openPool && !pools.some((p) => p.id === openPool.id)) { setOpenPool(null); setConfirming(false); }
  }, [pools, openPool]);

  const canStake = isAuthenticated; // paper or live
  const beginStake = (pool: Pool) => { setOpenPool(pool); setAmount(''); setConfirming(false); setMsg(''); };

  const amtNum = parseFloat(amount);
  const poolAvail = openPool ? num(balance?.[`${openPool.currency}_available`]) : 0;
  const apy = openPool?.apy ?? 0;
  const projAnnual = amtNum > 0 ? (amtNum * apy) / 100 : 0;
  const projTerm = openPool && openPool.duration > 0 ? (projAnnual * openPool.duration) / 365 : null;

  const startConfirm = () => {
    if (!openPool || !(amtNum > 0)) return;
    if (openPool.min_amount && amtNum < openPool.min_amount) { setMsg(`✗ minimum is ${fmtAmt(openPool.min_amount)} ${openPool.currency.toUpperCase()}`); return; }
    if (amtNum > poolAvail + 1e-9) { setMsg(`✗ insufficient ${openPool.currency.toUpperCase()}`); return; }
    setMsg(''); setConfirming(true);
  };

  const doStake = async () => {
    if (!openPool || !(amtNum > 0)) return;
    setBusy(true); setMsg('staking...');
    try {
      if (isPaper) paper!.stake(openPool.id, amtNum);
      else { await stakeApi.createStaker({ stake_id: openPool.id, amount: amtNum }); refreshBalance(); loadLive(); }
      setMsg('✓ staked'); setOpenPool(null); setAmount(''); setConfirming(false);
    } catch (e: any) {
      setMsg(`✗ ${e?.message || 'stake failed'}`); setConfirming(false);
    } finally { setBusy(false); }
  };

  const unstake = async (s: MyStake) => {
    const warn = s.duration > 0 && !s.matured ? ' early unstaking forfeits accrued rewards.' : '';
    if (!window.confirm(`unstake ${fmtAmt(s.amount)} ${s.currency.toUpperCase()}?${warn}`)) return;
    setMsg('unstaking...');
    try {
      if (isPaper) paper!.unstake(s.id);
      else { await stakeApi.deleteStaker(s.id); refreshBalance(); loadLive(); }
      setMsg('✓ unstaked');
    } catch (e: any) { setMsg(`✗ ${e?.message || 'unstake failed'}`); }
  };

  const totalStaked = stakes.filter((s) => s.canUnstake).length;
  const card = { border: '1px solid var(--border-light)', padding: '14px 16px', minWidth: '190px', flex: '1 1 190px', maxWidth: '240px' } as const;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="text-sec">:: earn</span>
        {canStake && totalStaked > 0 && <span className="text-ter" style={{ fontSize: '11px' }}>{totalStaked} active stake{totalStaked > 1 ? 's' : ''} · rewards accruing</span>}
      </div>
      <div className="divider" />

      {!canStake && (
        <div className="text-ter" style={{ fontSize: '12px', marginBottom: '18px', lineHeight: '1.7' }}>
          stake your assets to earn rewards. <Link to="/login" className="text-primary">[login]</Link> or <Link to="/signup" className="text-primary">[signup]</Link> for live rates — or try it now in <Link to="/login" className="text-primary">[paper trading]</Link>. rates below are representative.
        </div>
      )}

      {msg && <div style={{ fontSize: '11px', marginBottom: '12px' }} className={msgClass(msg)}>{msg}</div>}

      {/* YOUR STAKES */}
      {canStake && stakes.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div className="text-sec" style={{ marginBottom: '8px' }}>[ your_stakes ]</div>
          <table style={{ fontSize: '12px', width: '100%' }}>
            <thead><tr><th>asset</th><th>staked</th><th>reward</th><th>apy</th><th>status</th><th>action</th></tr></thead>
            <tbody>
              {stakes.map((s) => {
                const left = daysLeft(s, now);
                return (
                  <tr key={s.id}>
                    <td>{s.currency.toUpperCase()}</td>
                    <td className="text-sec">{fmtAmt(s.amount)}</td>
                    <td className="text-up">{s.reward > 0 ? `+${fmtAmt(s.reward)} ${s.reward_currency.toUpperCase()}` : '—'}</td>
                    <td className="text-ter">{s.apy > 0 ? `${s.apy.toFixed(1)}%` : '—'}</td>
                    <td className={s.canUnstake ? 'text-up' : 'text-ter'}>
                      {s.duration > 0 && left > 0 && s.canUnstake ? `locked ${left}d` : s.status}
                    </td>
                    <td>{s.canUnstake
                      ? <span className="interact text-down" {...chipProps(() => unstake(s))}>[unstake]</span>
                      : <span className="text-ter">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* EARN PRODUCTS */}
      <div className="text-sec" style={{ marginBottom: '10px' }}>[ earn_products ]</div>
      {loading ? (
        <div className="text-ter">loading staking...</div>
      ) : err ? (
        <div className="text-ter" style={{ fontSize: '12px' }}>{err}</div>
      ) : pools.length === 0 ? (
        <div className="text-ter">no staking pools available right now.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {pools.map((p) => (
            <div key={p.id} className="earn-card" style={card}>
              <div style={{ marginBottom: '6px' }}>{p.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '8px' }}>
                <span className="text-up" style={{ fontSize: '24px', fontWeight: 'bold' }}>{p.apy > 0 ? `${p.apy.toFixed(1)}%` : '—'}</span>
                <span className="text-ter" style={{ fontSize: '10px' }}>est. apy</span>
              </div>
              <div className="text-ter" style={{ fontSize: '11px', marginBottom: '10px' }}>
                {p.currency.toUpperCase()}{p.reward_currency && p.reward_currency !== p.currency ? ` → ${p.reward_currency.toUpperCase()}` : ''} · {fmtLock(p.duration)}
                {p.min_amount ? <><br />min {fmtAmt(p.min_amount)} {p.currency.toUpperCase()}</> : null}
              </div>
              {p.status === 'active' ? (
                canStake
                  ? <button onClick={() => beginStake(p)} style={{ width: '100%', borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>[stake]</button>
                  : <Link to="/login" className="text-primary" style={{ fontSize: '12px' }}>[login to stake]</Link>
              ) : <span className="text-ter" style={{ fontSize: '11px' }}>{p.status}</span>}
            </div>
          ))}
        </div>
      )}

      {/* STAKE PANEL */}
      {openPool && canStake && (
        <div style={{ marginTop: '20px', padding: '14px', border: '1px dashed var(--brand-up)', maxWidth: '440px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span className="text-sec">stake · {openPool.name}</span>
            <span className="interact text-ter" {...chipProps(() => { setOpenPool(null); setConfirming(false); })}>[×]</span>
          </div>
          <div className="text-ter" style={{ fontSize: '11px', marginBottom: '6px' }}>
            available: {fmtAmt(poolAvail)} {openPool.currency.toUpperCase()}
            {poolAvail > 0 && (
              <span className="interact text-sec" style={{ marginLeft: '8px' }} {...chipProps(() => setAmount(String(poolAvail)))}>[max]</span>
            )}
          </div>
          {!confirming ? (
            <>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`0.00 ${openPool.currency.toUpperCase()}`} style={{ flex: 1 }} />
                <button disabled={!(amtNum > 0)} onClick={startConfirm} style={{ borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>[review]</button>
              </div>
              {amtNum > 0 && apy > 0 && (
                <div className="text-ter" style={{ fontSize: '11px', marginTop: '8px', lineHeight: '1.6' }}>
                  projected rewards @ {apy.toFixed(1)}%:<br />
                  +{fmtAmt(projAnnual / 365)} /day · +{fmtAmt(projAnnual / 12)} /mo · +{fmtAmt(projAnnual)} /yr {openPool.reward_currency.toUpperCase()}
                  {projTerm != null && <><br /><span className="text-sec">≈ +{fmtAmt(projTerm)} {openPool.reward_currency.toUpperCase()} over the {openPool.duration}d term</span></>}
                </div>
              )}
            </>
          ) : (
            <div>
              <div style={{ marginBottom: '8px' }}>
                confirm: stake <span className="text-up">{fmtAmt(amtNum)} {openPool.currency.toUpperCase()}</span>
                <span className="text-ter"> · {fmtLock(openPool.duration)} · est. {apy.toFixed(1)}% apy</span>
                {projTerm != null && <><br /><span className="text-ter" style={{ fontSize: '11px' }}>≈ +{fmtAmt(projTerm)} {openPool.reward_currency.toUpperCase()} at term</span></>}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button disabled={busy} onClick={doStake} style={{ flex: 1, borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>{busy ? '[staking...]' : '[confirm →]'}</button>
                <button disabled={busy} onClick={() => setConfirming(false)} className="text-ter">[back]</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-ter" style={{ fontSize: '11px', marginTop: '18px' }}>
        {isPaper
          ? 'paper staking simulates locked funds and rewards accruing in real time — no real assets move.'
          : 'staking locks assets for a reward; APYs are estimates and rewards/penalties settle on HollaEx.'}
      </div>
    </div>
  );
}
