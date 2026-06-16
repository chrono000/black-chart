import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useExchange } from '../lib/ExchangeContext';
import { userApi } from '../../api/endpoints/user';
import { publicApi } from '../../api/endpoints/public';
import { num } from '../../api/market';
import { selectStyle } from '../lib/ui';
import { safeStorage } from '../lib/storage';
import { PortfolioPerformance } from '../components/PortfolioPerformance';
import type { CoinConfig, AddressBookEntry } from '../../api/types';

type TxTab = 'deposits' | 'withdrawals';

const PAPER_AB_KEY = 'black_chart_paper_addressbook';

const EVM_NETWORKS = ['eth', 'matic', 'bnb', 'bsc', 'arb', 'avax', 'base', 'op', 'optimism', 'ftm', 'pol'];

const networksFor = (coin?: CoinConfig | null): string[] =>
  coin?.network ? coin.network.split(',').map((n) => n.trim()).filter(Boolean) : [];

const feeFor = (coin: CoinConfig | undefined | null, network: string): number | null => {
  if (!coin) return null;
  const fees = coin.withdrawal_fees;
  const nets = networksFor(coin);
  if (fees) {
    if (network && fees[network]) return num(fees[network].value);
    if (nets.length === 1 && fees[nets[0]]) return num(fees[nets[0]].value);
    return null; // multi-network: no reliable fee until a network is chosen
  }
  if (typeof coin.withdrawal_fee === 'number') return coin.withdrawal_fee;
  return null;
};

// Defense-in-depth: block an obvious wrong-chain address for well-known networks.
// Lenient (allow) for networks we don't recognize, to avoid blocking valid withdrawals.
const addressLooksValid = (address: string, network: string): boolean => {
  const a = (address || '').trim();
  if (a.length < 8 || /\s/.test(a)) return false;
  if (network && EVM_NETWORKS.includes(network)) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (network === 'trx' || network === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (network === 'btc') return /^(bc1|[13])[0-9A-HJ-NP-Za-km-z]{20,90}$/.test(a);
  return true; // unknown network → basic sanity only
};

export function WalletPage() {
  const { balance, isAuthenticated, isPaper, paper, refreshBalance, user } = useAuth();
  const { constants } = useExchange();

  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [expandedMode, setExpandedMode] = useState<'deposit' | 'withdraw' | null>(null);
  const [depositAddress, setDepositAddress] = useState<string>('');
  const [depositNetwork, setDepositNetwork] = useState('');
  const [depNetwork, setDepNetwork] = useState('');
  const [depBusy, setDepBusy] = useState(false);
  const [depAmount, setDepAmount] = useState('');
  const [depMsg, setDepMsg] = useState('');

  const [txTab, setTxTab] = useState<TxTab>('deposits');
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [addressBook, setAddressBook] = useState<AddressBookEntry[]>([]);

  // Withdrawal form state
  const [wdlAddress, setWdlAddress] = useState('');
  const [wdlAmount, setWdlAmount] = useState('');
  const [wdlOtp, setWdlOtp] = useState('');
  const [wdlNetwork, setWdlNetwork] = useState('');
  const [wdlStatus, setWdlStatus] = useState('');
  const [wdlBusy, setWdlBusy] = useState(false);

  const expandedCoinConfig = expandedCoin ? constants?.coins?.[expandedCoin] : null;
  const expandedNetworks = useMemo(() => networksFor(expandedCoinConfig), [expandedCoinConfig]);

  // Coins the user actually holds (for portfolio valuation).
  const heldCoins = useMemo(() => {
    if (!balance) return [] as string[];
    return Object.keys(balance)
      .filter((k) => k.endsWith('_balance') && num(balance[k]) > 0)
      .map((k) => k.replace('_balance', ''));
  }, [balance]);
  const heldKey = heldCoins.join(',');

  // Fetch USDT oracle prices for held coins to value the portfolio.
  useEffect(() => {
    if (!heldKey) { setPrices({}); return; }
    let cancelled = false;
    const load = () => publicApi.getOraclePrices({ assets: heldKey, quote: 'usdt' })
      .then((p) => { if (!cancelled) setPrices(p || {}); })
      .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [heldKey]);

  const priceOf = (coin: string) => (coin === 'usdt' ? 1 : num(prices[coin]));
  const totalValue = heldCoins.reduce((sum, c) => sum + num(balance?.[`${c}_balance`]) * priceOf(c), 0);

  // Whitelisted withdrawal addresses (HollaEx address book; local store in paper mode).
  const loadAddressBook = useCallback(() => {
    if (!isAuthenticated) return;
    if (isPaper) {
      try { setAddressBook(JSON.parse(safeStorage.get(PAPER_AB_KEY) || '[]')); } catch { setAddressBook([]); }
      return;
    }
    userApi.getAddressBook()
      .then((res: any) => setAddressBook(Array.isArray(res) ? res : (res?.data ?? res?.addresses ?? [])))
      .catch(() => setAddressBook([]));
  }, [isAuthenticated, isPaper]);

  useEffect(() => { loadAddressBook(); }, [loadAddressBook]);

  const coinAddresses = useMemo(
    () => addressBook.filter((a) => a.address && (!a.currency || a.currency === expandedCoin)),
    [addressBook, expandedCoin],
  );

  const saveAddress = async () => {
    const addr = wdlAddress.trim();
    if (!addr) { setWdlStatus('✗ enter an address to save'); return; }
    if (!addressLooksValid(addr, wdlNetwork)) { setWdlStatus(`✗ address not valid for ${(wdlNetwork || expandedCoin || '').toUpperCase()}`); return; }
    if (coinAddresses.some((a) => a.address === addr)) { setWdlStatus('✓ already in your address book'); return; }
    const entry: AddressBookEntry = {
      address: addr,
      label: `${addr.slice(0, 8)}…${addr.slice(-6)}`,
      currency: expandedCoin!,
      network: wdlNetwork || undefined,
    };
    const next = [...addressBook, entry];
    if (isPaper) {
      safeStorage.set(PAPER_AB_KEY, JSON.stringify(next));
      setAddressBook(next);
      setWdlStatus('✓ saved to address book (paper)');
    } else {
      try { await userApi.updateAddressBook(next); loadAddressBook(); setWdlStatus('✓ saved to address book'); }
      catch (err: any) { setWdlStatus(`✗ ${err?.message || 'could not save address'}`); }
    }
  };

  // CRITICAL: whenever the expanded coin/mode changes, fully reset BOTH forms so
  // no address/amount/otp/address from a previous coin can carry over (wrong-chain hazard).
  useEffect(() => {
    setWdlAddress('');
    setWdlAmount('');
    setWdlOtp('');
    setWdlStatus('');
    setDepositAddress('');
    setDepositNetwork('');
    setDepAmount('');
    setDepMsg('');
    const nets = networksFor(expandedCoin ? constants?.coins?.[expandedCoin] : null);
    const def = nets.length === 1 ? nets[0] : '';
    setDepNetwork(def);
    setWdlNetwork(def);
  }, [expandedCoin, expandedMode, constants]);

  const fetchHistory = () => {
    if (!isAuthenticated || isPaper) return; // paper history is read from the engine
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
    const fee = feeFor(expandedCoinConfig, wdlNetwork);
    if (expandedNetworks.length > 1 && !wdlNetwork) { setWdlStatus('✗ select a network first'); return; }
    if (!addressLooksValid(wdlAddress, wdlNetwork)) { setWdlStatus(`✗ address does not look valid for the ${(wdlNetwork || expandedCoin || '').toUpperCase()} network`); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setWdlStatus('✗ enter a valid amount'); return; }
    if (amt > avail) { setWdlStatus('✗ insufficient available balance'); return; }
    if (fee !== null && amt <= fee) { setWdlStatus(`✗ amount must exceed the network fee (${fee} ${expandedCoin!.toUpperCase()})`); return; }
    if (isPaper && paper) {
      try {
        paper.withdraw(expandedCoin!, amt, wdlNetwork || undefined);
        setWdlStatus('✓ withdrawal simulated (paper)');
        setWdlAddress(''); setWdlAmount(''); setWdlOtp('');
      } catch (err: any) { setWdlStatus(`✗ ${err?.message || 'withdrawal failed'}`); }
      return;
    }
    // Real withdrawal: HollaEx requires OTP when 2FA is enabled, then emails a confirmation.
    if (user?.otp_enabled && !/^\d{6}$/.test(wdlOtp)) { setWdlStatus('✗ a 6-digit 2FA (otp) code is required for withdrawals'); return; }
    setWdlBusy(true);
    setWdlStatus('processing...');
    try {
      await userApi.requestWithdrawal({
        address: wdlAddress.trim(),
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
      setWdlStatus(`✗ ${err?.isTimeout ? 'request timed out — check Withdrawal History before retrying' : err.message || 'withdrawal failed'}`);
    } finally {
      setWdlBusy(false);
    }
  };

  const toggleExpand = (coin: string, mode: 'deposit' | 'withdraw') => {
    const cfg = constants?.coins?.[coin];
    if (mode === 'deposit' && cfg?.allow_deposit === false) return;
    if (mode === 'withdraw' && cfg?.allow_withdrawal === false) return;
    if (expandedCoin === coin && expandedMode === mode) {
      setExpandedCoin(null);
      setExpandedMode(null);
    } else {
      setExpandedCoin(coin);
      setExpandedMode(mode);
    }
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
  const wdlAmtNum = parseFloat(wdlAmount);
  const netReceived = wdlFee !== null && Number.isFinite(wdlAmtNum) ? Math.max(0, wdlAmtNum - wdlFee) : null;

  const networkSelect = (value: string, onChange: (v: string) => void, disabled = false) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle}
    >
      <option value="">[select network]</option>
      {expandedNetworks.map((n) => <option key={n} value={n}>{n.toUpperCase()}</option>)}
    </select>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <span className="text-sec">:: wallet_balances</span>
        <span className="text-sec">est. value <span className="text-up" style={{ fontWeight: 'bold' }}>≈ {totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</span></span>
      </div>
      <div className="divider" />

      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
            <th style={{ padding: '8px 0' }}>ASSET</th>
            <th>AVAILABLE</th>
            <th>IN_ORDER</th>
            <th>TOTAL</th>
            <th>VALUE_USDT</th>
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
            const allowDep = coin.allow_deposit !== false;
            const allowWdl = coin.allow_withdrawal !== false;

            return (
              <tr key={coin.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '8px 0' }}>{coin.symbol.toUpperCase()}</td>
                <td>{avail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className="text-sec">{inOrder > 1e-9 ? inOrder.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}</td>
                <td>{bal.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className="text-sec">{(() => { const v = bal * priceOf(coin.symbol); return v > 0 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'; })()}</td>
                <td>
                  {allowDep ? (
                    <span role="button" tabIndex={0} className="interact" onClick={() => toggleExpand(coin.symbol, 'deposit')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(coin.symbol, 'deposit'); } }} style={{ color: isDepActive ? 'black' : '', backgroundColor: isDepActive ? 'var(--brand-up)' : '' }}>[dep]</span>
                  ) : (
                    <span className="text-ter" title="deposits disabled">[dep:off]</span>
                  )}{' '}
                  {allowWdl ? (
                    <span role="button" tabIndex={0} className="interact" onClick={() => toggleExpand(coin.symbol, 'withdraw')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(coin.symbol, 'withdraw'); } }} style={{ color: isWdlActive ? 'black' : '', backgroundColor: isWdlActive ? 'var(--brand-down)' : '' }}>[wdl]</span>
                  ) : (
                    <span className="text-ter" title="withdrawals disabled">[wdl:off]</span>
                  )}
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
            <span role="button" tabIndex={0} className="interact text-ter" onClick={() => setExpandedCoin(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedCoin(null); }} style={{ marginLeft: '15px' }}>[close]</span>
          </div>
          {expandedNetworks.length > 1 && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
              <span className="text-ter">network</span>
              {networkSelect(depNetwork, (v) => { setDepNetwork(v); setDepositAddress(''); setDepositNetwork(''); }, !!depositAddress)}
              {depositAddress && <span role="button" tabIndex={0} className="interact text-ter" onClick={() => { setDepositAddress(''); setDepositNetwork(''); }} style={{ fontSize: '11px' }}>[change network]</span>}
            </div>
          )}
          {isPaper ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="number" step="any" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder={`amount ${expandedCoin.toUpperCase()}`} style={{ width: '160px' }} />
              <button onClick={() => {
                const a = parseFloat(depAmount);
                if (!(a > 0)) { setDepMsg('✗ enter an amount'); return; }
                try { paper?.deposit(expandedCoin, a, depNetwork || undefined); setDepAmount(''); setDepMsg(`✓ added ${a} ${expandedCoin.toUpperCase()} (simulated)`); } catch (err: any) { setDepMsg(`✗ ${err?.message || 'failed'}`); }
              }}>[add_test_funds]</button>
              <span className="text-ter" style={{ fontSize: '11px' }}>simulated faucet</span>
              {depMsg && <div style={{ fontSize: '11px', width: '100%' }} className={depMsg.startsWith('✓') ? 'text-up' : 'text-down'}>{depMsg}</div>}
            </div>
          ) : !depositAddress ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                disabled={depBusy || (expandedNetworks.length > 1 && !depNetwork)}
                onClick={async () => {
                  setDepBusy(true);
                  setDepMsg('');
                  try {
                    const res = await userApi.createAddress(expandedCoin, depNetwork || undefined);
                    if (res.address) {
                      setDepositAddress(res.address);
                      setDepositNetwork((res as any).network || depNetwork);
                    } else {
                      // HollaEx may generate the address asynchronously — surface the
                      // message and let the user re-check rather than dumping raw JSON.
                      setDepMsg((res as any).message || 'address is being generated — check again in a moment');
                    }
                  } catch (err: any) {
                    setDepMsg(`✗ ${err?.isTimeout ? 'timed out — try again' : err?.message || 'could not generate address'}`);
                  } finally { setDepBusy(false); }
                }}
              >
                {depBusy ? '[generating...]' : depMsg && !depMsg.startsWith('✗') ? '[check_for_address]' : '[generate_address]'}
              </button>
              {depMsg && <div className={depMsg.startsWith('✗') ? 'text-down' : 'text-ter'} style={{ fontSize: '11px' }}>{depMsg}</div>}
            </div>
          ) : (
            <>
              <div className="text-ter" style={{ fontSize: '11px', marginBottom: '4px' }}>
                {expandedCoin.toUpperCase()} deposit address{depositNetwork ? ` (${depositNetwork.toUpperCase()} network — send only ${expandedCoin.toUpperCase()} on ${depositNetwork.toUpperCase()})` : ''}:
              </div>
              <div style={{ padding: '10px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-light)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                {depositAddress}
              </div>
            </>
          )}
        </div>
      )}

      {/* Withdrawal Panel */}
      {expandedCoin && expandedMode === 'withdraw' && (
        <form onSubmit={handleWithdraw} style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-down)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ marginBottom: '5px' }}>
            <span className="text-down" style={{ fontWeight: 'bold' }}>▸ withdraw {expandedCoin.toUpperCase()}</span>
            <span role="button" tabIndex={0} className="interact text-ter" onClick={() => setExpandedCoin(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedCoin(null); }} style={{ marginLeft: '15px' }}>[close]</span>
            <span className="text-sec" style={{ marginLeft: '15px', fontSize: '11px' }}>available: {selectedAvail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px', alignItems: 'center' }}>
            {expandedNetworks.length > 1 && (
              <>
                <span>network</span>
                {networkSelect(wdlNetwork, setWdlNetwork)}
              </>
            )}
            {coinAddresses.length > 0 && (
              <>
                <span>saved</span>
                <select
                  defaultValue=""
                  onChange={(e) => { const a = coinAddresses[Number(e.target.value)]; if (a) { setWdlAddress(a.address); if (a.network) setWdlNetwork(a.network); } }}
                  style={selectStyle}
                >
                  <option value="">[choose whitelisted address]</option>
                  {coinAddresses.map((a, i) => (
                    <option key={i} value={i}>{(a.label || a.address)}{a.network ? ` · ${a.network.toUpperCase()}` : ''}</option>
                  ))}
                </select>
              </>
            )}
            <span>address</span>
            <input type="text" value={wdlAddress} onChange={(e) => setWdlAddress(e.target.value)} required placeholder="[destination_address]" />
            <span>amount</span>
            <input type="number" step="any" value={wdlAmount} onChange={(e) => setWdlAmount(e.target.value)} required placeholder="0.00" />
            <span>otp_code{user?.otp_enabled ? ' *' : ''}</span>
            <input type="text" inputMode="numeric" maxLength={6} value={wdlOtp} onChange={(e) => setWdlOtp(e.target.value)} required={!!user?.otp_enabled} placeholder={user?.otp_enabled ? '[required — 2fa enabled]' : '[if 2fa enabled]'} />
          </div>

          {wdlAddress.trim() && !coinAddresses.some((a) => a.address === wdlAddress.trim()) && (
            <div style={{ fontSize: '11px' }}>
              <span role="button" tabIndex={0} className="interact text-ter" onClick={saveAddress} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saveAddress(); } }}>
                [+ save address to whitelist]
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '11px' }}>
            <div className="text-sec">
              fee: {wdlFee !== null ? wdlFee : (expandedNetworks.length > 1 ? 'select a network' : '—')} {wdlFee !== null ? expandedCoin.toUpperCase() : ''}
              {expandedNetworks.length > 1 && wdlNetwork && <span className="text-ter"> · {wdlNetwork.toUpperCase()}</span>}
            </div>
            {netReceived !== null && netReceived > 0 && (
              <div className="text-sec">recipient gets: {netReceived.toLocaleString(undefined, { maximumFractionDigits: 8 })} {expandedCoin.toUpperCase()}</div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={wdlBusy} className="text-down" style={{ borderColor: 'var(--brand-down)' }}>
              {wdlBusy ? '[...]' : '[confirm_withdrawal →]'}
            </button>
          </div>
          {wdlStatus && <div style={{ fontSize: '11px' }} className={wdlStatus.startsWith('✓') ? 'text-up' : wdlStatus.startsWith('✗') ? 'text-down' : 'text-sec'}>{wdlStatus}</div>}
        </form>
      )}

      <PortfolioPerformance balance={balance} />

      <div style={{ marginTop: '40px' }} className="text-sec">:: transaction_history</div>
      <div className="divider" />
      <div style={{ display: 'flex', gap: '15px', marginBottom: '10px' }}>
        <span role="button" tabIndex={0} className="interact" onClick={() => setTxTab('deposits')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTxTab('deposits'); }} style={{ color: txTab === 'deposits' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[deposits]</span>
        <span role="button" tabIndex={0} className="interact" onClick={() => setTxTab('withdrawals')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTxTab('withdrawals'); }} style={{ color: txTab === 'withdrawals' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[withdrawals]</span>
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
            <tr><td colSpan={6} className="pulse text-ter">LOADING_HISTORY...</td></tr>
          ) : (
            (isPaper
              ? (txTab === 'deposits' ? (paper?.deposits || []) : (paper?.withdrawals || []))
              : (txTab === 'deposits' ? deposits : withdrawals)
            ).map((tx, i) => {
              const completed = tx.status === true || tx.status === 1 || tx.status === 'COMPLETED';
              const canceled = tx.dismissed === true || tx.dissmissed === true;
              const rejected = tx.rejected === true;
              const pending = !completed && !canceled && !rejected;
              const label = rejected ? 'REJECTED' : canceled ? 'CANCELED' : completed ? 'COMPLETED' : 'PENDING';
              return (
                <tr key={tx.id ?? i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '5px 0' }}>{new Date(tx.created_at).toLocaleString()}</td>
                  <td>{tx.currency?.toUpperCase()}</td>
                  <td className="text-ter">{(tx.network || '-').toUpperCase()}</td>
                  <td className={txTab === 'withdrawals' ? 'text-down' : 'text-up'}>{txTab === 'withdrawals' ? '-' : '+'}{num(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                  <td className={rejected ? 'text-down' : pending ? 'text-sec' : ''}>{label}</td>
                  <td>
                    {txTab === 'withdrawals' && pending && (
                      <span role="button" tabIndex={0} className="interact text-ter" onClick={async () => {
                        if (window.confirm('cancel this withdrawal?')) {
                          try { await userApi.cancelWithdrawal(tx.id); fetchHistory(); refreshBalance(); } catch (err: any) { alert(err.message); }
                        }
                      }} onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLElement).click(); } }}>[cancel]</span>
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
