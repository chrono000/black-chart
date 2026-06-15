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

export interface PaperState {
  totals: Record<string, number>;
  orders: PaperOrder[];
  trades: PaperTrade[];
  deposits: PaperTx[];
  withdrawals: PaperTx[];
  seq: number;
}

const KEY = 'black_chart_paper_state';
export const PAPER_FEE = 0.001; // 0.1% simulated taker fee

export function seedPaper(): PaperState {
  return {
    totals: { usdt: 100000, btc: 1, eth: 10 },
    orders: [],
    trades: [],
    deposits: [],
    withdrawals: [],
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
    if (o.side === 'buy' && q === coin && o.price) locked += o.price * remaining;
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
}

// Place a simulated order. Market fills at marketPrice; a marketable limit
// fills at its limit price; otherwise it rests as an open order (locks funds).
export function paperPlaceOrder(state: PaperState, req: PaperOrderReq, marketPrice: number): PaperState {
  const s = clone(state);
  const [base, quote] = req.symbol.split('-');

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

// Fill any resting limit orders for `symbol` whose price the market has crossed.
// Returns a new state if anything filled, else null.
export function paperFillCheck(state: PaperState, symbol: string, lastPrice: number): PaperState | null {
  if (!(lastPrice > 0)) return null;
  const toFill = state.orders.filter((o) =>
    o.symbol === symbol && o.price &&
    ((o.side === 'buy' && lastPrice <= o.price) || (o.side === 'sell' && lastPrice >= o.price)),
  );
  if (toFill.length === 0) return null;
  const s = clone(state);
  for (const o of toFill) {
    const remaining = o.size - o.filled;
    recordFill(s, o.symbol, o.side, o.price!, remaining);
  }
  const filledIds = new Set(toFill.map((o) => o.id));
  s.orders = s.orders.filter((o) => !filledIds.has(o.id));
  return s;
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
