// ═══════════════════════════════════════════════════════════
// Paper-trading engine — fully local simulation.
// NEVER touches a real money-moving API. Real market data (prices,
// orderbook, chart) still comes from HollaEx; only the ACCOUNT side
// (balances, orders, trades, deposits, withdrawals) is simulated.
// ═══════════════════════════════════════════════════════════

export interface PaperOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: number;
  stop?: number;
  size: number;
  filled: number;
  status: string;
  created_at: string;
}

export interface PaperTx {
  id: number;
  currency: string;
  amount: number;
  status: boolean;
  type: string;
  network?: string;
  created_at: string;
}

export interface PaperTrade {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  timestamp: string;
}

export interface PaperStake {
  id: number;
  pool_id: number;
  currency: string;
  reward_currency: string;
  amount: number;
  apy: number;       // snapshot APY (%) at stake time
  duration: number;  // lock in days; 0 = flexible
  created_at: string;
  status: string;    // 'staking'
}

export interface PaperState {
  totals: Record<string, number>;
  orders: PaperOrder[];
  trades: PaperTrade[];
  deposits: PaperTx[];
  withdrawals: PaperTx[];
  stakes: PaperStake[];
  seq: number;
}

// Simulated earn products. Currencies match the seeded paper balances so a
// demo user can actually stake. Shaped like a HollaEx StakePool.
export interface PaperPool {
  id: number;
  name: string;
  currency: string;
  reward_currency: string;
  apy: number;
  duration: number; // days; 0 = flexible
  min_amount: number;
  status: string;
}

export const PAPER_POOLS: PaperPool[] = [
  { id: 1, name: 'USDT Flexible Savings', currency: 'usdt', reward_currency: 'usdt', apy: 5.5, duration: 0, min_amount: 10, status: 'active' },
  { id: 2, name: 'USDT Locked 30D', currency: 'usdt', reward_currency: 'usdt', apy: 9.2, duration: 30, min_amount: 50, status: 'active' },
  { id: 3, name: 'ETH Staking 30D', currency: 'eth', reward_currency: 'eth', apy: 4.2, duration: 30, min_amount: 0.01, status: 'active' },
  { id: 4, name: 'BTC Vault 90D', currency: 'btc', reward_currency: 'btc', apy: 3.1, duration: 90, min_amount: 0.001, status: 'active' },
];

const KEY = 'black_chart_paper_state';
export const PAPER_FEE = 0.001; // 0.1% simulated taker fee

export function seedPaper(): PaperState {
  return {
    totals: { usdt: 100000, btc: 1, eth: 10 },
    orders: [],
    trades: [],
    deposits: [],
    withdrawals: [],
    stakes: [],
    seq: 1,
  };
}

const clone = (s: PaperState): PaperState => JSON.parse(JSON.stringify(s));

export function loadPaper(): PaperState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedPaper();
    const parsed = JSON.parse(raw);
    return { ...seedPaper(), ...parsed };
  } catch {
    return seedPaper();
  }
}

export function savePaper(state: PaperState) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function clearPaper() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Funds locked by resting limit orders (so "available" excludes them).
export function lockedFor(state: PaperState, coin: string): number {
  let locked = 0;
  for (const o of state.orders) {
    const [b, q] = o.symbol.split('-');
    const remaining = o.size - o.filled;
    if (o.side === 'buy' && q === coin) locked += (o.price || o.stop || 0) * remaining;
    if (o.side === 'sell' && b === coin) locked += remaining;
  }
  return locked;
}

// Produce a HollaEx-shaped balance object (coin_balance / coin_available).
export function paperBalanceObject(state: PaperState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of Object.keys(state.totals)) {
    const total = state.totals[c] || 0;
    out[`${c}_balance`] = total;
    out[`${c}_available`] = Math.max(0, total - lockedFor(state, c));
  }
  return out;
}

const avail = (s: PaperState, c: string) => (s.totals[c] || 0) - lockedFor(s, c);
const EPS = 1e-9;

function recordFill(s: PaperState, symbol: string, side: 'buy' | 'sell', price: number, size: number) {
  const [base, quote] = symbol.split('-');
  if (side === 'buy') {
    s.totals[quote] = (s.totals[quote] || 0) - price * size;
    s.totals[base] = (s.totals[base] || 0) + size * (1 - PAPER_FEE);
  } else {
    s.totals[base] = (s.totals[base] || 0) - size;
    s.totals[quote] = (s.totals[quote] || 0) + price * size * (1 - PAPER_FEE);
  }
  s.trades.unshift({ symbol, side, price, size, timestamp: new Date().toISOString() });
  s.trades = s.trades.slice(0, 100);
}

export interface PaperOrderReq {
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  type: 'limit' | 'market';
  price?: number;
  stop?: number;
}

// Place a simulated order. Market fills at marketPrice; a marketable limit fills
// at its limit price; otherwise it rests. A stop order rests until the market
// crosses the stop, then becomes a market fill / resting limit.
export function paperPlaceOrder(state: PaperState, req: PaperOrderReq, marketPrice: number): PaperState {
  const s = clone(state);
  const [base, quote] = req.symbol.split('-');

  if (req.stop && req.stop > 0) {
    const triggered = marketPrice > 0 && ((req.side === 'buy' && marketPrice >= req.stop) || (req.side === 'sell' && marketPrice <= req.stop));
    if (!triggered) {
      const refPrice = req.type === 'limit' ? (req.price || req.stop) : req.stop;
      if (req.side === 'buy' && refPrice * req.size > avail(s, quote) + EPS) throw new Error(`insufficient ${quote.toUpperCase()}`);
      if (req.side === 'sell' && req.size > avail(s, base) + EPS) throw new Error(`insufficient ${base.toUpperCase()}`);
      s.orders.unshift({ id: `p${s.seq}`, symbol: req.symbol, side: req.side, type: req.type, price: req.price, stop: req.stop, size: req.size, filled: 0, status: 'stop', created_at: new Date().toISOString() });
      s.seq += 1;
      return s;
    }
    // already triggered → fall through to immediate market/limit handling
  }

  if (req.type === 'market') {
    if (!(marketPrice > 0)) throw new Error('no market price available');
    if (req.side === 'buy' && marketPrice * req.size > avail(s, quote) + EPS) throw new Error(`insufficient ${quote.toUpperCase()}`);
    if (req.side === 'sell' && req.size > avail(s, base) + EPS) throw new Error(`insufficient ${base.toUpperCase()}`);
    recordFill(s, req.symbol, req.side, marketPrice, req.size);
    return s;
  }

  const px = req.price || 0;
  if (px <= 0) throw new Error('invalid price');
  const marketable = marketPrice > 0 && ((req.side === 'buy' && marketPrice <= px) || (req.side === 'sell' && marketPrice >= px));
  if (req.side === 'buy' && px * req.size > avail(s, quote) + EPS) throw new Error(`insufficient ${quote.toUpperCase()}`);
  if (req.side === 'sell' && req.size > avail(s, base) + EPS) throw new Error(`insufficient ${base.toUpperCase()}`);

  if (marketable) {
    recordFill(s, req.symbol, req.side, px, req.size);
  } else {
    s.orders.unshift({
      id: `p${s.seq}`, symbol: req.symbol, side: req.side, type: 'limit',
      price: px, size: req.size, filled: 0, status: 'new', created_at: new Date().toISOString(),
    });
    s.seq += 1;
  }
  return s;
}

export function paperCancelOrder(state: PaperState, id: string): PaperState {
  const s = clone(state);
  s.orders = s.orders.filter((o) => o.id !== id);
  return s;
}

// On each price tick: trigger stop orders the market has crossed (→ market fill,
// or convert to a resting limit), then fill resting limits the market has crossed.
export function paperFillCheck(state: PaperState, symbol: string, lastPrice: number): PaperState | null {
  if (!(lastPrice > 0)) return null;
  const s = clone(state);
  let changed = false;

  // 1. Trigger stops.
  for (const o of s.orders) {
    if (o.symbol !== symbol || o.status !== 'stop' || !o.stop) continue;
    const crossed = (o.side === 'buy' && lastPrice >= o.stop) || (o.side === 'sell' && lastPrice <= o.stop);
    if (!crossed) continue;
    if (o.type === 'market') {
      recordFill(s, o.symbol, o.side, lastPrice, o.size - o.filled);
      o.status = '__filled__';
    } else {
      o.status = 'new'; // becomes a resting limit; may fill below in the same pass
      delete o.stop;
    }
    changed = true;
  }
  s.orders = s.orders.filter((o) => o.status !== '__filled__');

  // 2. Fill resting limit orders the market has crossed.
  const toFill = s.orders.filter((o) =>
    o.symbol === symbol && o.status !== 'stop' && o.price &&
    ((o.side === 'buy' && lastPrice <= o.price) || (o.side === 'sell' && lastPrice >= o.price)),
  );
  for (const o of toFill) { recordFill(s, o.symbol, o.side, o.price!, o.size - o.filled); changed = true; }
  const filledIds = new Set(toFill.map((o) => o.id));
  s.orders = s.orders.filter((o) => !filledIds.has(o.id));

  return changed ? s : null;
}

export function paperConvert(state: PaperState, from: string, to: string, fromAmt: number, toAmt: number): PaperState {
  const s = clone(state);
  if (!(fromAmt > 0) || !(toAmt > 0)) throw new Error('invalid amount');
  if (from === to) throw new Error('choose two different assets');
  if (fromAmt > avail(s, from) + EPS) throw new Error(`insufficient ${from.toUpperCase()}`);
  s.totals[from] = (s.totals[from] || 0) - fromAmt;
  s.totals[to] = (s.totals[to] || 0) + toAmt;
  s.trades.unshift({ symbol: `${to}-${from}`, side: 'buy', price: toAmt > 0 ? fromAmt / toAmt : 0, size: toAmt, timestamp: new Date().toISOString() });
  s.trades = s.trades.slice(0, 100);
  return s;
}

export function paperDeposit(state: PaperState, coin: string, amount: number, network?: string): PaperState {
  const s = clone(state);
  if (!(amount > 0)) throw new Error('invalid amount');
  s.totals[coin] = (s.totals[coin] || 0) + amount;
  s.deposits.unshift({ id: s.seq, currency: coin, amount, status: true, type: 'deposit', network, created_at: new Date().toISOString() });
  s.seq += 1;
  return s;
}

export function paperWithdraw(state: PaperState, coin: string, amount: number, network?: string): PaperState {
  const s = clone(state);
  if (!(amount > 0)) throw new Error('invalid amount');
  if (amount > avail(s, coin) + EPS) throw new Error(`insufficient ${coin.toUpperCase()}`);
  s.totals[coin] = (s.totals[coin] || 0) - amount;
  s.withdrawals.unshift({ id: s.seq, currency: coin, amount, status: true, type: 'withdrawal', network, created_at: new Date().toISOString() });
  s.seq += 1;
  return s;
}

// ── Staking / earn ──────────────────────────────────────────
const YEAR_MS = 365 * 24 * 3600 * 1000;

// Reward accrued so far on a stake. Locked stakes stop accruing at term end.
export function paperStakeReward(stake: PaperStake, now: number = Date.now()): number {
  const start = new Date(stake.created_at).getTime();
  let elapsed = Math.max(0, now - start);
  if (stake.duration > 0) elapsed = Math.min(elapsed, stake.duration * 24 * 3600 * 1000);
  return stake.amount * (stake.apy / 100) * (elapsed / YEAR_MS);
}

// Flexible stakes are always withdrawable; locked stakes mature after `duration` days.
export function paperStakeMatured(stake: PaperStake, now: number = Date.now()): boolean {
  if (stake.duration <= 0) return true;
  return now - new Date(stake.created_at).getTime() >= stake.duration * 24 * 3600 * 1000;
}

// Stake moves the principal out of the spot balance into the stake.
export function paperStake(state: PaperState, poolId: number, amount: number): PaperState {
  const s = clone(state);
  const pool = PAPER_POOLS.find((p) => p.id === poolId);
  if (!pool) throw new Error('unknown pool');
  if (pool.status !== 'active') throw new Error('pool not active');
  if (!(amount > 0)) throw new Error('invalid amount');
  if (pool.min_amount && amount < pool.min_amount) throw new Error(`minimum ${pool.min_amount} ${pool.currency.toUpperCase()}`);
  if (amount > avail(s, pool.currency) + EPS) throw new Error(`insufficient ${pool.currency.toUpperCase()}`);
  s.totals[pool.currency] = (s.totals[pool.currency] || 0) - amount;
  s.stakes.unshift({
    id: s.seq, pool_id: pool.id, currency: pool.currency, reward_currency: pool.reward_currency,
    amount, apy: pool.apy || 0, duration: pool.duration || 0, created_at: new Date().toISOString(), status: 'staking',
  });
  s.seq += 1;
  return s;
}

// Unstake returns the principal; an early exit on a locked stake forfeits rewards.
export function paperUnstake(state: PaperState, id: number): PaperState {
  const s = clone(state);
  const stake = s.stakes.find((x) => x.id === id);
  if (!stake) throw new Error('stake not found');
  const reward = paperStakeMatured(stake) ? paperStakeReward(stake) : 0;
  s.totals[stake.currency] = (s.totals[stake.currency] || 0) + stake.amount;
  if (reward > 0) s.totals[stake.reward_currency] = (s.totals[stake.reward_currency] || 0) + reward;
  s.stakes = s.stakes.filter((x) => x.id !== id);
  return s;
}
