import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../lib/AuthContext';
import { useExchange } from '../lib/ExchangeContext';
import { userApi } from '../../api/endpoints/user';
import { publicApi } from '../../api/endpoints/public';
import { num } from '../../api/market';
import { selectStyle } from '../lib/ui';
import { safeStorage } from '../lib/storage';
import { PortfolioPerformance } from '../components/PortfolioPerformance';
import { SearchSelect } from '../components/SearchSelect';
import type { CoinConfig, AddressBookEntry, WalletAddress } from '../../api/types';

type TxTab = 'deposits' | 'withdrawals';

const PAPER_AB_KEY = 'black_chart_paper_addressbook';

// A realistic-looking (but fake) deposit address for paper mode, so the demo
// mirrors the real deposit UX. Format matches the network family.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const randStr = (chars: string, n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
function fakeDepositAddress(coin: string, network: string): string {
  const n = (network || coin || '').toLowerCase();
  if (EVM_NETWORKS.includes(n)) return '0x' + randStr('0123456789abcdef', 40);
  if (n === 'trx' || n === 'tron') return 'T' + randStr(B58, 33);
  if (n === 'btc') return 'bc1q' + randStr('023456789acdefghjklmnpqrstuvwxyz', 38);
  if (n === 'ltc') return 'ltc1q' + randStr('023456789acdefghjklmnpqrstuvwxyz', 38);
  if (n === 'xrp') return 'r' + randStr(B58, 33);
  if (n === 'sol') return randStr(B58, 43);
  if (n === 'xlm') return 'G' + randStr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 55);
  return randStr(B58, 34);
}

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

// Basic client-side email sanity for internal (email) transfers. The real
// recipient is only verified by the server at the confirm step (USER_NOT_FOUND).
const isValidEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());

// xrp/xlm and the xlm/ton networks pack a destination tag/memo into the address
// as "address:tag" (single colon). Both are required — funds sent without the tag
// can be lost, so we split and surface both.
const needsMemo = (coin: string, network: string): boolean => {
  const c = (coin || '').toLowerCase(); const n = (network || '').toLowerCase();
  return c === 'xrp' || c === 'xlm' || n === 'xlm' || n === 'ton';
};
const splitAddress = (raw: string): { address: string; tag: string } => {
  const s = raw || ''; const i = s.indexOf(':');
  return i >= 0 ? { address: s.slice(0, i), tag: s.slice(i + 1) } : { address: s, tag: '' };
};
// Existing deposit addresses live on user.wallet[] (GET /user) — there is NO
// get-address endpoint. Match by currency, and by network for multi-chain coins.
const findWalletAddress = (wallet: WalletAddress[] | undefined, coin: string, network: string): WalletAddress | undefined => {
  if (!wallet || !wallet.length) return undefined;
  const c = (coin || '').toLowerCase();
  const forCoin = wallet.filter((w) => (w.currency || '').toLowerCase() === c && !!w.address);
  if (!forCoin.length) return undefined;
  const n = (network || '').toLowerCase();
  if (n) return forCoin.find((w) => (w.network || '').toLowerCase() === n);
  return forCoin[0];
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
  const { balance, isAuthenticated, isPaper, paper, refreshBalance, refreshUser, user } = useAuth();
  const { constants, displayCurrency } = useExchange();
  const CCY = displayCurrency.toUpperCase();

  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [expandedMode, setExpandedMode] = useState<'deposit' | 'withdraw' | null>(null);
  const [depositAddress, setDepositAddress] = useState<string>('');
  const [depositTag, setDepositTag] = useState('');    // destination tag/memo for xrp/xlm/ton
  const [depositNetwork, setDepositNetwork] = useState('');
  const [depositForCoin, setDepositForCoin] = useState(''); // coin the shown address belongs to (guards against a stale wrong-coin address on switch)
  const panelRef = useRef<HTMLDivElement>(null);       // deposit/withdraw panel, scrolled into view on open
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
  const [wdlDest, setWdlDest] = useState<'address' | 'email'>('address'); // crypto address vs internal email transfer
  const [wdlAddress, setWdlAddress] = useState('');
  const [wdlEmail, setWdlEmail] = useState(''); // recipient email when wdlDest === 'email'
  const [wdlAmount, setWdlAmount] = useState('');
  const [wdlOtp, setWdlOtp] = useState('');
  const [wdlNetwork, setWdlNetwork] = useState('');
  const [wdlStatus, setWdlStatus] = useState('');
  const [wdlBusy, setWdlBusy] = useState(false);
  const [savedIdx, setSavedIdx] = useState(''); // selected whitelist-address index ('' = custom)
  // Real withdrawals are 2-step on HollaEx: request emails a 6-digit code (version v4),
  // then confirm-withdrawal broadcasts. 'form' → 'confirm' (enter code) → 'done'.
  const [wdlPhase, setWdlPhase] = useState<'form' | 'confirm' | 'done'>('form');
  const [wdlCode, setWdlCode] = useState('');
  const [wdlTxid, setWdlTxid] = useState('');
  const [wdlReq, setWdlReq] = useState<{ coin: string; amount: string; dest: string; isEmail: boolean; network?: string } | null>(null);

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
    const load = () => publicApi.getOraclePrices({ assets: heldKey, quote: displayCurrency })
      .then((p) => { if (!cancelled) setPrices(p || {}); })
      .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [heldKey, displayCurrency]);

  const priceOf = (coin: string) => (coin === displayCurrency ? 1 : num(prices[coin]));
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

  // All coins allowed for the current action (deposit vs withdraw) — for the picker.
  const coinPickerOptions = useMemo(() => {
    const list = constants?.coins ? Object.values(constants.coins).filter((c) => c.active) : [];
    return list
      .filter((c) => (expandedMode === 'deposit' ? c.allow_deposit !== false : c.allow_withdrawal !== false))
      .map((c) => ({ value: c.symbol, label: c.symbol.toUpperCase() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [constants, expandedMode]);

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
    setWdlDest('address');
    setWdlAddress('');
    setWdlEmail('');
    setWdlAmount('');
    setWdlOtp('');
    setWdlStatus('');
    setSavedIdx('');
    setDepositAddress('');
    setDepositTag('');
    setDepositNetwork('');
    setDepositForCoin('');
    setDepAmount('');
    setDepMsg('');
    const nets = networksFor(expandedCoin ? constants?.coins?.[expandedCoin] : null);
    const def = nets.length === 1 ? nets[0] : '';
    setDepNetwork(def);
    setWdlNetwork(def);
  }, [expandedCoin, expandedMode, constants]);

  // Real deposits: an address may already exist on user.wallet[] (there is no
  // get-address endpoint). Surface it directly instead of showing a generate
  // button that would fail with "already has an address" (error 1001). Runs after
  // the reset effect (declared earlier), and re-runs when the network or user changes.
  useEffect(() => {
    if (isPaper || expandedMode !== 'deposit' || !expandedCoin) return;
    if (expandedNetworks.length > 1 && !depNetwork) return; // wait for a network choice
    const net = expandedNetworks.length > 1 ? depNetwork : (expandedNetworks[0] || '');
    const hit = findWalletAddress(user?.wallet, expandedCoin, expandedNetworks.length > 1 ? depNetwork : '');
    if (hit) {
      const { address, tag } = splitAddress(hit.address);
      setDepositAddress(address);
      setDepositTag(tag);
      setDepositNetwork(hit.network || net || expandedCoin);
      setDepositForCoin(expandedCoin);
      setDepMsg('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaper, expandedMode, expandedCoin, depNetwork, expandedNetworks, user]);

  // Bring the deposit/withdraw panel into view on open — the balances table is long,
  // so a panel rendered below it would otherwise be off-screen and easy to miss.
  useEffect(() => {
    if (expandedCoin && expandedMode) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [expandedCoin, expandedMode]);

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

  // Switch withdrawal destination, clearing fields so nothing carries across modes.
  const switchDest = (d: 'address' | 'email') => {
    setWdlDest(d);
    setWdlAddress('');
    setWdlEmail('');
    setSavedIdx('');
    setWdlStatus('');
  };

  // Reset the whole withdrawal flow (used by [close] and after a confirmed send).
  const resetWithdrawal = () => {
    setWdlPhase('form'); setWdlCode(''); setWdlTxid(''); setWdlReq(null);
    setWdlAddress(''); setWdlEmail(''); setWdlAmount(''); setWdlOtp(''); setWdlStatus('');
  };
  const closeWithdrawPanel = () => { resetWithdrawal(); setExpandedCoin(null); };

  // Switching coin/mode must never leave a stale confirm/done phase behind (a code
  // is bound to the specific request that emailed it). Reset phase machinery only —
  // not the in-progress form inputs — when the panel target changes.
  useEffect(() => { setWdlPhase('form'); setWdlCode(''); setWdlTxid(''); setWdlReq(null); setWdlStatus(''); }, [expandedCoin, expandedMode]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(wdlAmount);
    const avail = num(balance?.[`${expandedCoin}_available`]);
    if (!Number.isFinite(amt) || amt <= 0) { setWdlStatus('✗ enter a valid amount'); return; }
    if (amt > avail) { setWdlStatus('✗ insufficient available balance'); return; }

    // Build the withdrawal target. Two destinations share the same endpoint:
    //  · crypto address — on-chain, validated by network + has a network fee
    //  · email          — internal transfer (network:'email', recipient email in `address`), no fee
    type WdlBody = { address: string; amount: number; currency: string; otp_code?: string; network?: string; method?: string };
    let body: WdlBody;
    let paperNetwork: string | undefined;
    if (wdlDest === 'email') {
      const email = wdlEmail.trim().toLowerCase();
      if (!isValidEmail(email)) { setWdlStatus('✗ enter a valid recipient email'); return; }
      body = { address: email, amount: amt, currency: expandedCoin!, network: 'email', method: 'email' };
      paperNetwork = 'email';
    } else {
      const fee = feeFor(expandedCoinConfig, wdlNetwork);
      if (expandedNetworks.length > 1 && !wdlNetwork) { setWdlStatus('✗ select a network first'); return; }
      if (!addressLooksValid(wdlAddress, wdlNetwork)) { setWdlStatus(`✗ address does not look valid for the ${(wdlNetwork || expandedCoin || '').toUpperCase()} network`); return; }
      if (fee !== null && amt <= fee) { setWdlStatus(`✗ amount must exceed the network fee (${fee} ${expandedCoin!.toUpperCase()})`); return; }
      body = { address: wdlAddress.trim(), amount: amt, currency: expandedCoin!, network: wdlNetwork || undefined };
      paperNetwork = wdlNetwork || undefined;
    }

    if (isPaper && paper) {
      // Mirror the real 2-step UX in the demo: "code emailed" → enter code → send.
      // Nothing leaves the balance until confirm (paper.withdraw runs there), and we
      // never touch the real endpoint. Any code is accepted at confirm.
      setWdlReq({ coin: expandedCoin!, amount: String(amt), dest: body.address, isEmail: wdlDest === 'email', network: paperNetwork });
      setWdlCode('');
      setWdlOtp('');
      setWdlPhase('confirm');
      setWdlStatus('✓ code emailed (simulated) — enter any 6 digits to confirm.');
      return;
    }
    // Real withdrawal: HollaEx requires OTP when 2FA is enabled, then emails a confirmation.
    if (user?.otp_enabled && !/^\d{6}$/.test(wdlOtp)) { setWdlStatus('✗ a 6-digit 2FA (otp) code is required for withdrawals'); return; }
    setWdlBusy(true);
    setWdlStatus('processing...');
    try {
      await userApi.requestWithdrawal({ ...body, otp_code: wdlOtp || undefined });
      // Step 1 only emailed a 6-digit confirmation code — the withdrawal is NOT sent
      // yet. Advance to the confirm phase so the user can enter that code. Snapshot
      // what was requested for the confirm summary; clear the (single-use) OTP.
      setWdlReq({ coin: expandedCoin!, amount: String(amt), dest: body.address, isEmail: wdlDest === 'email' });
      setWdlCode('');
      setWdlOtp('');
      setWdlPhase('confirm');
      setWdlStatus(wdlDest === 'email'
        ? '✓ code emailed — enter it to send the transfer. recipient is verified at confirm.'
        : '✓ code emailed — enter it to broadcast the withdrawal.');
    } catch (err: any) {
      setWdlStatus(`✗ ${err?.isTimeout ? 'request timed out — check Withdrawal History before retrying' : err.message || 'withdrawal failed'}`);
    } finally {
      setWdlBusy(false);
    }
  };

  // Step 2: enter the emailed code → confirm-withdrawal broadcasts (or sends the
  // internal transfer). Only now do balances/history actually change.
  const handleConfirmWithdraw = async () => {
    const code = wdlCode.trim();
    if (!code) { setWdlStatus('✗ enter the confirmation code from your email'); return; }
    // Paper mode: simulate confirmation locally — accept any code, never hit the API.
    // The balance only moves now (on confirm), matching the real two-step flow.
    if (isPaper && paper) {
      if (!wdlReq) { setWdlStatus('✗ nothing to confirm'); return; }
      try {
        paper.withdraw(wdlReq.coin, parseFloat(wdlReq.amount), wdlReq.network);
        setWdlTxid('');
        setWdlPhase('done');
        setWdlStatus(`✓ ${wdlReq.isEmail ? 'transfer sent' : 'withdrawal'} (paper)`);
      } catch (err: any) { setWdlStatus(`✗ ${err?.message || 'withdrawal failed'}`); }
      return;
    }
    setWdlBusy(true);
    setWdlStatus('confirming...');
    try {
      const r = await userApi.confirmWithdrawal({ token: code });
      const tx = (r && r.transaction_id) || '';
      setWdlTxid(tx);
      setWdlPhase('done');
      setWdlStatus(tx
        ? `✓ ${wdlReq?.isEmail ? 'transfer sent' : 'withdrawal broadcast'} · tx ${tx}`
        : `✓ ${wdlReq?.isEmail ? 'transfer sent' : 'withdrawal confirmed'}`);
      fetchHistory();
      refreshBalance();
    } catch (err: any) {
      setWdlStatus(`✗ ${err?.isTimeout ? 'request timed out — check Withdrawal History before retrying' : err?.message || 'confirmation failed'}`);
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

  // General entry point: open the deposit/withdraw flow for any coin (picker-driven).
  const openGeneral = (mode: 'deposit' | 'withdraw') => {
    const list = Object.values(constants?.coins || {}).filter((c) => c.active && (mode === 'deposit' ? c.allow_deposit !== false : c.allow_withdrawal !== false));
    const first = list.find((c) => c.symbol === 'btc') || list[0];
    setExpandedMode(mode);
    setExpandedCoin(first?.symbol || 'btc');
  };

  // Deep-link from the coin hub: /wallet?coin=<sym>&action=deposit|withdraw.
  // Re-runs on auth / constants / param changes (no permanent guard) so successive
  // deep-links and post-login navigation both open the right panel.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (!isAuthenticated) return;
    const coin = (searchParams.get('coin') || '').toLowerCase();
    const action = searchParams.get('action');
    if (!coin || (action !== 'deposit' && action !== 'withdraw')) return;
    const cfg = constants?.coins?.[coin];
    if (!cfg) return; // wait until constants load
    if (action === 'deposit' && cfg.allow_deposit === false) return;
    if (action === 'withdraw' && cfg.allow_withdrawal === false) return;
    setExpandedMode(action);
    setExpandedCoin(coin);
  }, [isAuthenticated, constants, searchParams]);

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
  const wdlFromBook = savedIdx !== '';
  // Only treat an address as displayable if it belongs to the currently-selected coin.
  // Guards against a 1-frame stale wrong-coin address between a coin switch and the
  // reset/lookup effects (fund-critical: never show another coin's deposit address).
  const depositReady = !!depositAddress && depositForCoin === expandedCoin;
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
        <span className="text-sec">est. value <span className="text-up" style={{ fontWeight: 'bold' }}>≈ {totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} {CCY}</span></span>
      </div>
      <div className="divider" />

      {/* General deposit/withdraw — pick any coin via the searchable dropdown in the
          panel below. Panels render here (above the balances table) so the flow opens
          right under these buttons instead of far down the page. */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
        <button onClick={() => openGeneral('deposit')} style={{ borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>[+ deposit]</button>
        <button onClick={() => openGeneral('withdraw')} style={{ borderColor: 'var(--brand-down)', color: 'var(--brand-down)' }}>[- withdraw]</button>
      </div>

      {/* Deposit Panel */}
      {expandedCoin && expandedMode === 'deposit' && (
        <div ref={panelRef} style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-up)' }}>
          <div style={{ marginBottom: '8px' }}>
            <span className="text-up" style={{ fontWeight: 'bold' }}>▸ deposit {expandedCoin.toUpperCase()}</span>
            <span role="button" tabIndex={0} className="interact text-ter" onClick={() => setExpandedCoin(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedCoin(null); }} style={{ marginLeft: '15px' }}>[close]</span>
          </div>
          {/* coin picker — deposit any coin, not just the ones listed */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
            <span className="text-ter" style={{ width: '90px' }}>coin</span>
            <SearchSelect value={expandedCoin} options={coinPickerOptions} onChange={(c) => setExpandedCoin(c)} placeholder="search coin" style={{ flex: '0 0 160px' }} />
          </div>
          {expandedNetworks.length > 1 && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
              <span className="text-ter" style={{ width: '90px' }}>network</span>
              {networkSelect(depNetwork, (v) => { setDepNetwork(v); setDepositAddress(''); setDepositTag(''); setDepositNetwork(''); }, depositReady)}
              {depositReady && <span role="button" tabIndex={0} className="interact text-ter" onClick={() => { setDepositAddress(''); setDepositTag(''); setDepositNetwork(''); }} style={{ fontSize: '11px' }}>[change network]</span>}
            </div>
          )}

          {!depositReady ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                disabled={depBusy || (expandedNetworks.length > 1 && !depNetwork)}
                onClick={async () => {
                  setDepBusy(true);
                  setDepMsg('');
                  if (isPaper) {
                    setDepositAddress(fakeDepositAddress(expandedCoin, depNetwork));
                    setDepositNetwork(depNetwork || expandedNetworks[0] || expandedCoin);
                    setDepositForCoin(expandedCoin);
                    setDepBusy(false);
                    return;
                  }
                  try {
                    const res = await userApi.createAddress(expandedCoin, depNetwork || undefined);
                    if (res.address) {
                      const { address, tag } = splitAddress(res.address);
                      setDepositAddress(address);
                      setDepositTag(tag);
                      setDepositNetwork((res as any).network || depNetwork);
                      setDepositForCoin(expandedCoin);
                    } else {
                      // HollaEx may generate the address asynchronously — surface the
                      // message and let the user re-check rather than dumping raw JSON.
                      setDepMsg((res as any).message || 'address is being generated — check again in a moment');
                    }
                    // Keep user.wallet[] (the source of truth) in sync for next time.
                    await refreshUser();
                  } catch (err: any) {
                    // 1001: an address already exists but create-address won't return it.
                    // Re-read user.wallet[] — the auto-lookup effect then fills it in.
                    if (/already has/i.test(err?.message || '') || err?.data?.code === 1001) {
                      setDepMsg('fetching your existing address…');
                      await refreshUser();
                    } else {
                      setDepMsg(`✗ ${err?.isTimeout ? 'timed out — try again' : err?.message || 'could not generate address'}`);
                    }
                  } finally { setDepBusy(false); }
                }}
              >
                {depBusy ? '[working...]' : (!isPaper && depMsg && !depMsg.startsWith('✗')) ? '[check_for_address]' : '[generate_address]'}
              </button>
              {!isPaper && depMsg && <div className={depMsg.startsWith('✗') ? 'text-down' : 'text-ter'} style={{ fontSize: '11px' }}>{depMsg}</div>}
            </div>
          ) : (
            <>
              <div className="text-ter" style={{ fontSize: '11px', marginBottom: '4px' }}>
                {expandedCoin.toUpperCase()} deposit address{depositNetwork ? ` (${depositNetwork.toUpperCase()} network — send only ${expandedCoin.toUpperCase()} on ${depositNetwork.toUpperCase()})` : ''}:
                {isPaper && <span className="text-down"> · simulated</span>}
              </div>
              <div style={{ padding: '10px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-light)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                {depositAddress}
              </div>
              {/* Destination tag/memo — REQUIRED alongside the address on xrp/xlm/ton. */}
              {depositTag ? (
                <>
                  <div className="text-down" style={{ fontSize: '11px', margin: '8px 0 4px', fontWeight: 'bold' }}>
                    ⚠ destination tag / memo (REQUIRED — send with the address or funds are lost):
                  </div>
                  <div style={{ padding: '10px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--brand-down)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {depositTag}
                  </div>
                </>
              ) : needsMemo(expandedCoin, depositNetwork) && (
                <div className="text-down" style={{ fontSize: '11px', marginTop: '6px' }}>
                  ⚠ this network uses a destination tag/memo — make sure yours is included.
                </div>
              )}
              {isPaper && (
                <div style={{ marginTop: '6px' }}>
                  <span role="button" tabIndex={0} className="interact text-ter" style={{ fontSize: '11px' }} onClick={() => { setDepositAddress(''); setDepositTag(''); setDepositNetwork(''); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDepositAddress(''); setDepositTag(''); setDepositNetwork(''); } }}>[new address]</span>
                </div>
              )}
            </>
          )}

          {isPaper && (
            <>
              <div className="divider" style={{ margin: '12px 0' }} />
              <div className="text-ter" style={{ fontSize: '11px', marginBottom: '6px' }}>simulated deposits aren't on-chain — use the faucet to credit your paper balance:</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="number" step="any" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder={`amount ${expandedCoin.toUpperCase()}`} style={{ width: '160px' }} />
                <button onClick={() => {
                  const a = parseFloat(depAmount);
                  if (!(a > 0)) { setDepMsg('✗ enter an amount'); return; }
                  try { paper?.deposit(expandedCoin, a, depNetwork || undefined); setDepAmount(''); setDepMsg(`✓ added ${a} ${expandedCoin.toUpperCase()} (simulated)`); } catch (err: any) { setDepMsg(`✗ ${err?.message || 'failed'}`); }
                }}>[add_test_funds]</button>
                {depMsg && <div style={{ fontSize: '11px', width: '100%' }} className={depMsg.startsWith('✓') ? 'text-up' : 'text-down'}>{depMsg}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Withdrawal Panel */}
      {expandedCoin && expandedMode === 'withdraw' && (
        <div ref={panelRef} style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-down)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ marginBottom: '5px' }}>
            <span className="text-down" style={{ fontWeight: 'bold' }}>▸ withdraw {expandedCoin.toUpperCase()}</span>
            <span role="button" tabIndex={0} className="interact text-ter" onClick={closeWithdrawPanel} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') closeWithdrawPanel(); }} style={{ marginLeft: '15px' }}>[close]</span>
            <span className="text-sec" style={{ marginLeft: '15px', fontSize: '11px' }}>available: {selectedAvail.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
          </div>

          {wdlPhase === 'form' && (
          <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ width: '90px' }}>coin</span>
            <SearchSelect value={expandedCoin} options={coinPickerOptions} onChange={(c) => setExpandedCoin(c)} placeholder="search coin" style={{ flex: '0 0 160px' }} />
          </div>

          {/* Destination: on-chain crypto address vs internal transfer to another user's email */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ width: '90px' }}>send to</span>
            <div style={{ display: 'flex', gap: '14px' }}>
              <span role="button" tabIndex={0} className="interact" onClick={() => switchDest('address')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchDest('address'); } }} style={{ color: wdlDest === 'address' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[crypto address]</span>
              <span role="button" tabIndex={0} className="interact" onClick={() => switchDest('email')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchDest('email'); } }} style={{ color: wdlDest === 'email' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>[email · internal]</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px', alignItems: 'center' }}>
            {wdlDest === 'address' ? (
              <>
                {expandedNetworks.length > 1 && (
                  <>
                    <span>network</span>
                    {networkSelect(wdlNetwork, (v) => { setWdlNetwork(v); if (savedIdx !== '') { setSavedIdx(''); setWdlAddress(''); } })}
                  </>
                )}
                {coinAddresses.length > 0 && (
                  <>
                    <span>saved</span>
                    <select
                      value={savedIdx}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSavedIdx(v);
                        if (v === '') { setWdlAddress(''); return; }
                        const a = coinAddresses[Number(v)];
                        if (a) { setWdlAddress(a.address); if (a.network) setWdlNetwork(a.network); }
                      }}
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
                <input
                  type="text"
                  value={wdlAddress}
                  onChange={(e) => setWdlAddress(e.target.value)}
                  required
                  readOnly={wdlFromBook}
                  placeholder="[destination_address]"
                  style={wdlFromBook ? { borderColor: 'var(--brand-up)', color: 'var(--text-secondary)', cursor: 'not-allowed' } : undefined}
                />
              </>
            ) : (
              <>
                <span>recipient</span>
                <input
                  type="email"
                  value={wdlEmail}
                  onChange={(e) => setWdlEmail(e.target.value)}
                  required
                  placeholder="recipient@email.com"
                />
              </>
            )}
            <span>amount</span>
            <input type="number" step="any" value={wdlAmount} onChange={(e) => setWdlAmount(e.target.value)} required placeholder="0.00" />
            <span>otp_code{user?.otp_enabled ? ' *' : ''}</span>
            <input type="text" inputMode="numeric" maxLength={6} value={wdlOtp} onChange={(e) => setWdlOtp(e.target.value)} required={!!user?.otp_enabled} placeholder={user?.otp_enabled ? '[required — 2fa enabled]' : '[if 2fa enabled]'} />
          </div>

          {wdlDest === 'email' && (
            <div className="text-ter" style={{ fontSize: '11px' }}>
              ▸ internal transfer to another exchange account. no network fee. the recipient must be an existing user — verified when you confirm.
            </div>
          )}

          {wdlDest === 'address' && (wdlFromBook ? (
            <div style={{ fontSize: '11px' }} className="text-up">
              ✓ using whitelisted address
              <span role="button" tabIndex={0} className="interact text-ter" style={{ marginLeft: '10px' }}
                onClick={() => { setSavedIdx(''); setWdlAddress(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSavedIdx(''); setWdlAddress(''); } }}>
                [use a different address]
              </span>
            </div>
          ) : wdlAddress.trim() && !coinAddresses.some((a) => a.address === wdlAddress.trim()) ? (
            <div style={{ fontSize: '11px' }}>
              <span role="button" tabIndex={0} className="interact text-ter" onClick={saveAddress} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saveAddress(); } }}>
                [+ save address to whitelist]
              </span>
            </div>
          ) : null)}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '11px' }}>
            {wdlDest === 'email' ? (
              <>
                <div className="text-sec">fee: 0 {expandedCoin.toUpperCase()} <span className="text-ter">· internal</span></div>
                {Number.isFinite(wdlAmtNum) && wdlAmtNum > 0 && (
                  <div className="text-sec">recipient gets: {wdlAmtNum.toLocaleString(undefined, { maximumFractionDigits: 8 })} {expandedCoin.toUpperCase()}</div>
                )}
              </>
            ) : (
              <>
                <div className="text-sec">
                  fee: {wdlFee !== null ? wdlFee : (expandedNetworks.length > 1 ? 'select a network' : '—')} {wdlFee !== null ? expandedCoin.toUpperCase() : ''}
                  {expandedNetworks.length > 1 && wdlNetwork && <span className="text-ter"> · {wdlNetwork.toUpperCase()}</span>}
                </div>
                {netReceived !== null && netReceived > 0 && (
                  <div className="text-sec">recipient gets: {netReceived.toLocaleString(undefined, { maximumFractionDigits: 8 })} {expandedCoin.toUpperCase()}</div>
                )}
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={wdlBusy} className="text-down" style={{ borderColor: 'var(--brand-down)' }}>
              {wdlBusy ? '[...]' : (isPaper ? '[withdraw →]' : '[send_code →]')}
            </button>
          </div>
          </form>
          )}

          {wdlPhase === 'confirm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="text-sec" style={{ fontSize: '11px' }}>
              ✉ {isPaper ? 'demo — enter any 6 digits to' : 'a 6-digit code was emailed. enter it to'} {wdlReq?.isEmail ? 'send' : 'broadcast'}{' '}
              <span style={{ color: 'var(--text-primary)' }}>{wdlReq?.amount} {(wdlReq?.coin || '').toUpperCase()}</span>
              {wdlReq?.isEmail ? <> to <span style={{ color: 'var(--text-primary)' }}>{wdlReq?.dest}</span></> : ' on-chain'}.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px', alignItems: 'center' }}>
              <span>code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={wdlCode}
                onChange={(e) => setWdlCode(e.target.value)}
                placeholder={isPaper ? '[any 6 digits — demo]' : '[6-digit code from email]'}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!wdlBusy && wdlCode.trim()) handleConfirmWithdraw(); } }}
              />
            </div>
            <div className="text-ter" style={{ fontSize: '11px' }}>▸ not sent until you confirm. internal transfers can't be reversed.</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span role="button" tabIndex={0} className="interact text-ter" style={{ fontSize: '11px' }} onClick={() => { setWdlPhase('form'); setWdlStatus(''); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWdlPhase('form'); setWdlStatus(''); } }}>[‹ back]</span>
              <button type="button" disabled={wdlBusy || !wdlCode.trim()} onClick={handleConfirmWithdraw} className="text-down" style={{ borderColor: 'var(--brand-down)' }}>
                {wdlBusy ? '[...]' : '[confirm_withdrawal →]'}
              </button>
            </div>
          </div>
          )}

          {wdlPhase === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="text-up" style={{ fontWeight: 'bold' }}>✓ {wdlReq?.isEmail ? 'transfer sent' : 'withdrawal broadcast'}</div>
            <div className="text-sec" style={{ fontSize: '11px' }}>
              {wdlReq?.amount} {(wdlReq?.coin || '').toUpperCase()}{wdlReq?.isEmail ? ` → ${wdlReq?.dest}` : ''}
              {wdlTxid ? ` · tx ${String(wdlTxid).slice(0, 16)}…` : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <span role="button" tabIndex={0} className="interact text-ter" style={{ fontSize: '11px' }} onClick={closeWithdrawPanel} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeWithdrawPanel(); } }}>[close]</span>
            </div>
          </div>
          )}

          {wdlStatus && <div style={{ fontSize: '11px' }} className={wdlStatus.startsWith('✓') ? 'text-up' : wdlStatus.startsWith('✗') ? 'text-down' : 'text-sec'}>{wdlStatus}</div>}
        </div>
      )}

      <div className="text-sec" style={{ marginTop: '20px' }}>:: your_assets</div>
      <div className="divider" />
      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
            <th style={{ padding: '8px 0' }}>ASSET</th>
            <th>AVAILABLE</th>
            <th>IN_ORDER</th>
            <th>TOTAL</th>
            <th>VALUE_{CCY}</th>
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
                <td style={{ padding: '8px 0' }}><Link to={`/coin/${coin.symbol}`} className="text-primary">{coin.symbol.toUpperCase()}</Link></td>
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
