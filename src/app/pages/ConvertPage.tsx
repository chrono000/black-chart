import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router';
import { useExchange } from '../lib/ExchangeContext';
import { useAuth } from '../lib/AuthContext';
import { orderApi } from '../../api/endpoints/order';
import { publicApi } from '../../api/endpoints/public';
import { num } from '../../api/market';
import { selectStyle as baseSelect } from '../lib/ui';

export function ConvertPage() {
  const { constants } = useExchange();
  const { isAuthenticated, isPaper, balance, paper, refreshBalance } = useAuth();

  const coins = useMemo(
    () => Object.values(constants?.coins || {}).filter((c) => c.active).map((c) => c.symbol).sort(),
    [constants],
  );

  const [from, setFrom] = useState('usdt');
  const [to, setTo] = useState('btc');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ receiving: number; token?: string; estimate: boolean } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const fromAvail = num(balance?.[`${from}_available`]);
  const amtNum = parseFloat(amount);

  // Quote (debounced). Try HollaEx quick-trade; in paper mode fall back to
  // oracle prices so any pair can be simulated.
  useEffect(() => {
    setQuote(null);
    setStatus('');
    if (!(amtNum > 0) || from === to) return;
    let cancelled = false;
    setQuoting(true);
    const id = setTimeout(async () => {
      try {
        const q = await orderApi.getQuickTrade({ spending_currency: from, receiving_currency: to, spending_amount: String(amtNum) });
        const receiving = num(q.receiving_amount);
        if (receiving > 0) {
          if (!cancelled) { setQuote({ receiving, token: (q as any).token, estimate: !(q as any).token }); setQuoting(false); }
          return;
        }
        throw new Error('no liquidity');
      } catch (err: any) {
        if (cancelled) return;
        if (isPaper) {
          try {
            const px = await publicApi.getOraclePrices({ assets: `${from},${to}`, quote: 'usdt' });
            const pf = num(px[from]);
            const pt = num(px[to]);
            if (pf > 0 && pt > 0) {
              setQuote({ receiving: (amtNum * pf) / pt, token: undefined, estimate: true });
              setQuoting(false);
              return;
            }
          } catch { /* fall through */ }
        }
        setQuote(null);
        setQuoting(false);
        setStatus(`✗ ${err?.message || 'no quote available for this pair'}`);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(id); };
  }, [from, to, amtNum, isPaper]);

  const rate = quote && amtNum > 0 ? quote.receiving / amtNum : 0;

  const doConvert = useCallback(async () => {
    if (!quote || !(amtNum > 0)) return;
    if (amtNum > fromAvail + 1e-9) { setStatus(`✗ insufficient ${from.toUpperCase()}`); return; }
    setBusy(true);
    setStatus('converting...');
    try {
      if (isPaper) {
        paper!.convert(from, to, amtNum, quote.receiving);
        setStatus(`✓ converted ${amtNum} ${from.toUpperCase()} → ${quote.receiving.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${to.toUpperCase()}`);
        setAmount('');
      } else {
        if (!quote.token) throw new Error('quote not executable — adjust the amount to refresh');
        await orderApi.executeQuickTrade(quote.token);
        setStatus(`✓ converted ~${amtNum} ${from.toUpperCase()} → ${to.toUpperCase()}`);
        setAmount('');
        refreshBalance();
      }
    } catch (err: any) {
      setStatus(`✗ ${err?.isTimeout ? 'timed out — check your balance before retrying' : err?.message || 'convert failed'}`);
    } finally {
      setBusy(false);
    }
  }, [quote, amtNum, fromAvail, isPaper, from, to, paper, refreshBalance]);

  const swap = () => { setFrom(to); setTo(from); setAmount(''); setQuote(null); setStatus(''); };

  const selectStyle = { ...baseSelect, padding: '4px 6px', minWidth: '110px' };

  return (
    <div>
      <div className="text-sec">:: convert</div>
      <div className="divider" />

      <div style={{ maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* FROM */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span className="text-ter">from</span>
            <span className="text-ter" style={{ fontSize: '11px' }}>
              available: {fromAvail.toLocaleString(undefined, { maximumFractionDigits: 8 })} {from.toUpperCase()}
              {isAuthenticated && fromAvail > 0 && (
                <span role="button" tabIndex={0} className="interact text-sec" style={{ marginLeft: '8px' }}
                  onClick={() => setAmount(String(fromAvail))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAmount(String(fromAvail)); } }}>[max]</span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select value={from} onChange={(e) => setFrom(e.target.value)} style={selectStyle}>
              {coins.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ flex: 1 }} />
          </div>
        </div>

        {/* SWAP */}
        <div style={{ textAlign: 'center' }}>
          <span role="button" tabIndex={0} className="interact text-sec" onClick={swap}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swap(); } }}>[ ⇅ swap ]</span>
        </div>

        {/* TO */}
        <div>
          <div className="text-ter" style={{ marginBottom: '4px' }}>to</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select value={to} onChange={(e) => setTo(e.target.value)} style={selectStyle}>
              {coins.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            <input
              type="text"
              readOnly
              value={quoting ? '…' : quote ? quote.receiving.toLocaleString(undefined, { maximumFractionDigits: 8 }) : ''}
              placeholder="receiving"
              style={{ flex: 1, color: 'var(--text-secondary)' }}
            />
          </div>
        </div>

        {/* RATE */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }} className="text-ter">
          <span>{rate > 0 ? `1 ${from.toUpperCase()} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${to.toUpperCase()}` : 'enter an amount for a quote'}</span>
          {quote?.estimate && <span>estimate{isPaper ? ' · paper' : ''}</span>}
        </div>

        {/* ACTION */}
        {!isAuthenticated ? (
          <div className="text-ter" style={{ fontSize: '12px' }}>
            <Link to="/login" className="text-primary">[login]</Link> or use{' '}
            <Link to="/login" className="text-primary">[paper trading]</Link> to convert.
          </div>
        ) : (
          <button
            disabled={busy || quoting || !quote || from === to || !(amtNum > 0)}
            onClick={doConvert}
            style={{ width: '100%', borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}
          >
            {busy ? '[converting...]' : `[convert ${from.toUpperCase()} → ${to.toUpperCase()}]`}
          </button>
        )}

        {status && <div style={{ fontSize: '11px' }} className={status.startsWith('✓') ? 'text-up' : status.startsWith('✗') ? 'text-down' : 'text-sec'}>{status}</div>}

        <div className="text-ter" style={{ fontSize: '11px', marginTop: '6px' }}>
          {isPaper
            ? 'paper convert settles instantly against the live rate into your simulated balances.'
            : 'convert executes a HollaEx quick-trade at the quoted rate.'}
        </div>
      </div>
    </div>
  );
}
