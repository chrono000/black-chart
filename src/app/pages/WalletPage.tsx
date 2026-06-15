import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useExchange } from '../lib/ExchangeContext';
import { userApi } from '../../api/endpoints/user';
import { num } from '../../api/market';
import type { CoinConfig } from '../../api/types';

type TxTab = 'deposits' | 'withdrawals';

const networksFor = (coin?: CoinConfig | null): string[] =>
  coin?.network ? coin.network.split(',').map((n) => n.trim()).filter(Boolean) : [];

const feeFor = (coin: CoinConfig | undefined | null, network: string): number | null => {
  if (!coin) return null;
  const fees = coin.withdrawal_fees;
  if (fees && network && fees[network]) return num(fees[network].value);
  if (typeof coin.withdrawal_fee === 'number') return coin.withdrawal_fee;
  return null;
};

export function WalletPage() {
  const { balance, isAuthenticated, refreshBalance } = useAuth();
  const { constants } = useExchange();

  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [expandedMode, setExpandedMode] = useState<'deposit' | 'withdraw' | null>(null);
  const [depositAddress, setDepositAddress] = useState<string>('');
  const [depNetwork, setDepNetwork] = useState('');
  const [depBusy, setDepBusy] = useState(false);

  const [txTab, setTxTab] = useState<TxTab>('deposits');
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  // Withdrawal form state
  const [wdlAddress, setWdlAddress] = useState('');
  const [wdlAmount, setWdlAmount] = useState('');
  const [wdlOtp, setWdlOtp] = useState('');
  const [wdlNetwork, setWdlNetwork] = useState('');
  const [wdlStatus, setWdlStatus] = useState('');
  const [wdlBusy, setWdlBusy] = useState(false);

  const expandedCoinConfig = expandedCoin ? constants?.coins?.[expandedCoin] : null;
  const expandedNetworks = useMemo(() => networksFor(expandedCoinConfig), [expandedCoinConfig]);

  const fetchHistory = () => {
    if (!isAuthenticated) return;
    setTxLoading(true);
    const fetcher = txTab === 'deposits' ? userApi.getDeposits : userApi.getWithdrawals;
    fetcher({ limit: 50 })
      .then((res) => {
        if (txTab === 'deposits') setDeposits(res.data);
        else setWithdrawals(res.data);
        setTxLoading(false);
      })
      .catch(() => setTxLoading(false));
  };

  useEffect(() => { fetchHistory(); /* eslint-disable-next-line */ }, [isAuthenticated, txTab]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(wdlAmount);
    const avail = num(balance?.[`${expandedCoin}_available`]);
    if (!Number.isFinite(amt) || amt <= 0) { setWdlStatus('✗ enter a valid amount'); return; }
    if (amt > avail) { setWdlStatus('✗ insufficient available balance'); return; }
    if (expandedNetworks.length > 1 && !wdlNetwork) { setWdlStatus('✗ select a network'); return; }
    setWdlBusy(true);
    setWdlStatus('processing...');
    try {
      await userApi.requestWithdrawal({
        address: wdlAddress,
        amount: amt,
        currency: expandedCoin!,
        otp_code: wdlOtp || undefined,
        network: wdlNetwork || undefined,
      });
      setWdlStatus('✓ submitted. check email to confirm.');
      setWdlAddress('');
      setWdlAmount('');
      setWdlOtp('');
      fetchHistory();
      refreshBalance();
    } catch (err: any) {
      setWdlStatus(`✗ ${err.message || 'withdrawal failed'}`);
    } finally {
      setWdlBusy(false);
    }
  };

  const toggleExpand = (coin: string, mode: 'deposit' | 'withdraw') => {
    if (expandedCoin === coin && expandedMode === mode) {
      setExpandedCoin(null);
      setExpandedMode(null);
      return;
    }
    setExpandedCoin(coin);
    setExpandedMode(mode);
    setWdlStatus('');
    setDepositAddress('');
    const nets = networksFor(constants?.coins?.[coin]);
    const defaultNet = nets.length === 1 ? nets[0] : '';
    setDepNetwork(defaultNet);
    setWdlNetwork(defaultNet);
  };

  if (!isAuthenticated) {
    return (
      <div>
        <div className="text-sec">:: wallet_module</div>
        <div className="divider" />
        <div className="text-ter" style={{ padding: '40px 0', textAlign: 'center' }}>
          [LOGIN_REQUIRED_TO_VIEW_BALANCES]
        </div>
      </div>
    );
  }

  const coins = constants?.coins ? Object.values(constants.coins).filter((c) => c.active) : [];
  const selectedAvail = num(balance?.[`${expandedCoin}_available`]);
  const wdlFee = feeFor(expandedCoinConfig, wdlNetwork);

  const networkSelect = (value: string, onChange: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-light)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size)', padding: '2px 4px' }}
    >
      <option value="">[select network]</option>
      {expandedNetworks.map((n) => <option key={n} value={n}>{n.toUpperCase()}</option>)}
    </select>
  );

  return (
    <div>
      <div className="text-sec">:: wallet_balances</div>
      <div className="divider" />

      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
            <th style={{ padding: '8px 0' }}>ASSET</th>
            <th>AVAILABLE</th>
            <th>IN_ORDER</th>
            <th>TOTAL</th>
            <th>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {coins.map((coin) => {
            const avail = num(balance?.[`${coin.symbol}_available`]);
            const bal = num(balance?.[`${coin.symbol}_balance`]);
            const inOrder = bal - avail;
            if (bal === 0 && !['usdt', 'btc', 'eth'].includes(coin.symbol)) return null;

            const isDepActive = expandedCoin === coin.symbol && expandedMode === 'deposit';
            const isWdlActive = expandedCoin === coin.symbol && expandedMode === 'withdraw';

            return (
              <tr key={coin.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '8px 0' }}>{coin.symbol.toUpperCase()}</td>
                <td>{avail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className="text-sec">{inOrder > 1e-9 ? inOrder.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}</td>
                <td>{bal.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td>
                  <span className="interact" onClick={() => toggleExpand(coin.symbol, 'deposit')} style={{ color: isDepActive ? 'black' : '', backgroundColor: isDepActive ? 'var(--brand-up)' : '' }}>[dep]</span>{' '}
                  <span className="interact" onClick={() => toggleExpand(coin.symbol, 'withdraw')} style={{ color: isWdlActive ? 'black' : '', backgroundColor: isWdlActive ? 'var(--brand-down)' : '' }}>[wdl]</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Deposit Panel */}
      {expandedCoin && expandedMode === 'deposit' && (
        <div style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-up)' }}>
          <div style={{ marginBottom: '8px' }}>
            <span className="text-up" style={{ fontWeight: 'bold' }}>▸ deposit {expandedCoin.toUpperCase()}</span>
            <span className="interact text-ter" onClick={() => setExpandedCoin(null)} style={{ marginLeft: '15px' }}>[close]</span>
          </div>
          {expandedNetworks.length > 1 && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
              <span className="text-ter">network</span>
              {networkSelect(depNetwork, setDepNetwork)}
            </div>
          )}
          {!depositAddress ? (
            <button
              disabled={depBusy || (expandedNetworks.length > 1 && !depNetwork)}
              onClick={async () => {
                setDepBusy(true);
                try {
                  const res = await userApi.createAddress(expandedCoin, depNetwork || undefined);
                  setDepositAddress(res.address || JSON.stringify(res));
                } catch (err: any) { alert(err.message); } finally { setDepBusy(false); }
              }}
            >
              {depBusy ? '[generating...]' : '[generate_address]'}
            </button>
          ) : (
            <div style={{ padding: '10px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-light)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {depositAddress}
            </div>
          )}
        </div>
      )}

      {/* Withdrawal Panel */}
      {expandedCoin && expandedMode === 'withdraw' && (
        <form onSubmit={handleWithdraw} style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-down)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ marginBottom: '5px' }}>
            <span className="text-down" style={{ fontWeight: 'bold' }}>▸ withdraw {expandedCoin.toUpperCase()}</span>
            <span className="interact text-ter" onClick={() => setExpandedCoin(null)} style={{ marginLeft: '15px' }}>[close]</span>
            <span className="text-sec" style={{ marginLeft: '15px', fontSize: '11px' }}>available: {selectedAvail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px', alignItems: 'center' }}>
            {expandedNetworks.length > 1 && (
              <>
                <span>network</span>
                {networkSelect(wdlNetwork, setWdlNetwork)}
              </>
            )}
            <span>address</span>
            <input type="text" value={wdlAddress} onChange={(e) => setWdlAddress(e.target.value)} required placeholder="[destination_address]" />
            <span>amount</span>
            <input type="number" step="any" value={wdlAmount} onChange={(e) => setWdlAmount(e.target.value)} required placeholder="0.00" />
            <span>otp_code</span>
            <input type="text" value={wdlOtp} onChange={(e) => setWdlOtp(e.target.value)} placeholder="[if 2fa enabled]" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
            <div className="text-sec" style={{ fontSize: '11px' }}>
              fee: {wdlFee !== null ? wdlFee : '—'} {expandedCoin.toUpperCase()}
              {expandedNetworks.length > 1 && wdlNetwork && <span className="text-ter"> · {wdlNetwork.toUpperCase()}</span>}
            </div>
            <button type="submit" disabled={wdlBusy} className="text-down" style={{ borderColor: 'var(--brand-down)' }}>
              {wdlBusy ? '[...]' : '[confirm_withdrawal →]'}
            </button>
          </div>
          {wdlStatus && <div style={{ fontSize: '11px' }} className={wdlStatus.startsWith('✓') ? 'text-up' : wdlStatus.startsWith('✗') ? 'text-down' : 'text-sec'}>{wdlStatus}</div>}
        </form>
      )}

      <div style={{ marginTop: '40px' }} className="text-sec">:: transaction_history</div>
      <div className="divider" />
      <div style={{ display: 'flex', gap: '15px', marginBottom: '10px' }}>
        <span className="interact" onClick={() => setTxTab('deposits')} style={{ color: txTab === 'deposits' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[deposits]</span>
        <span className="interact" onClick={() => setTxTab('withdrawals')} style={{ color: txTab === 'withdrawals' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[withdrawals]</span>
      </div>

      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
            <th style={{ padding: '5px 0' }}>DATE</th>
            <th>ASSET</th>
            <th>NETWORK</th>
            <th>AMOUNT</th>
            <th>STATUS</th>
            <th>{txTab === 'withdrawals' ? 'ACTION' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {txLoading ? (
            <tr><td colSpan={6} className="text-ter">LOADING_HISTORY...</td></tr>
          ) : (
            (txTab === 'deposits' ? deposits : withdrawals).map((tx, i) => {
              const completed = tx.status === 1 || tx.status === true || tx.status === 'COMPLETED';
              const pending = tx.status === 0 || tx.status === false || tx.status === 'PENDING';
              return (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '5px 0' }}>{new Date(tx.created_at).toLocaleString()}</td>
                  <td>{tx.currency?.toUpperCase()}</td>
                  <td className="text-ter">{(tx.network || '-').toUpperCase()}</td>
                  <td className={txTab === 'withdrawals' ? 'text-down' : 'text-up'}>{txTab === 'withdrawals' ? '-' : '+'}{num(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                  <td>{completed ? 'COMPLETED' : 'PENDING'}</td>
                  <td>
                    {txTab === 'withdrawals' && pending && (
                      <span className="interact text-ter" onClick={async () => {
                        if (window.confirm('cancel this withdrawal?')) {
                          try { await userApi.cancelWithdrawal(tx.id); fetchHistory(); refreshBalance(); } catch (err: any) { alert(err.message); }
                        }
                      }}>[cancel]</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
