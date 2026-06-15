// ═══════════════════════════════════════════════════════════
// HollaEx API Types — from swagger definitions.yaml
// ═══════════════════════════════════════════════════════════

export interface User {
  id: number;
  email: string;
  full_name: string;
  gender?: boolean;
  nationality?: string;
  phone_number?: string;
  address?: {
    country?: string;
    address?: string;
    postal_code?: string;
    city?: string;
    verified?: boolean;
  };
  id_data?: {
    type?: string;
    number?: string;
    issued_date?: string;
    expiration_date?: string;
    verified?: boolean;
  };
  bank_account?: BankAccount[];
  wallet?: WalletAddress[];
  verification_level: number;
  otp_enabled?: boolean;
  settings?: UserSettings;
  created_at?: string;
  updated_at?: string;
}

export interface BankAccount {
  bank_name?: string;
  account_number?: string;
  card_number?: string;
}

export interface WalletAddress {
  currency: string;
  address: string;
  network?: string;
  created_at?: string;
}

export interface UserSettings {
  language?: string;
  risk?: {
    popup_warning?: boolean;
    order_portfolio_percentage?: number;
  };
  audio?: {
    public_trade?: boolean;
    order_completed?: boolean;
    order_partially_completed?: boolean;
  };
  interface?: {
    theme?: string;
    display_currency?: string;
    order_book_levels?: number;
  };
  notification?: {
    popup_order_completed?: boolean;
    popup_order_confirmation?: boolean;
    popup_order_partially_filled?: boolean;
    popup_order_new?: boolean;
    popup_order_canceled?: boolean;
  };
  watchlist?: string[];
}

export interface UserBalance {
  [key: string]: number; // e.g. btc_available, btc_balance, usdt_available, usdt_balance
}

export interface UserStats {
  [key: string]: unknown;
}

export interface Order {
  id: string;
  side: 'buy' | 'sell';
  symbol: string;
  size: number;
  filled: number;
  type: 'market' | 'limit';
  price?: number;
  stop?: number;
  status: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  meta?: {
    post_only?: boolean;
    note?: string;
  };
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  type: 'market' | 'limit';
  price?: number;
  stop?: number;
  meta?: {
    post_only?: boolean;
    note?: string;
  };
}

export interface Ticker {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  last: number;
  symbol?: string;
}

export interface OrderbookEntry {
  price: number;
  size: number;
}

export interface Orderbook {
  bids: [number, number][];
  asks: [number, number][];
  timestamp: string;
}

export interface Trade {
  side: 'buy' | 'sell';
  size: number;
  price: number;
  timestamp: string;
  symbol?: string;
}

export interface WithdrawalRequest {
  address: string;
  amount: number;
  currency: string;
  otp_code?: string;
  network?: string;
}

export interface Deposit {
  id: number;
  amount: number;
  currency: string;
  status: boolean; // false = pending/processing, true = completed
  dismissed?: boolean;
  dissmissed?: boolean; // API body uses this misspelling
  rejected?: boolean;
  type: string;
  network?: string;
  transaction_id?: string;
  address?: string;
  created_at: string;
  updated_at: string;
  fee?: number;
}

export interface Withdrawal {
  id: number;
  amount: number;
  currency: string;
  status: boolean; // false = pending/processing, true = completed
  dismissed?: boolean;
  dissmissed?: boolean; // API body uses this misspelling
  rejected?: boolean;
  type: string;
  network?: string;
  transaction_id?: string;
  address: string;
  created_at: string;
  updated_at: string;
  fee?: number;
}

export interface StakePool {
  id: number;
  name: string;
  currency: string;
  reward_currency: string;
  duration?: number;
  slashing?: boolean;
  apy?: number;
  min_amount?: number;
  max_amount?: number;
  status: string;
  created_at: string;
}

export interface Staker {
  id: number;
  stake_id: number;
  amount: number;
  currency: string;
  reward: number;
  slashed: number;
  status: string;
  created_at: string;
  unstaked_date?: string;
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface LoginEntry {
  ip: string;
  device: string;
  domain: string;
  timestamp: string;
  status?: boolean;
}

export interface Session {
  id: number;
  role: string;
  ip: string;
  device: string;
  status: boolean;
  last_seen: string;
  created_at: string;
  expiry_date: string;
}

export interface AddressBookEntry {
  address: string;
  label: string;
  network?: string;
  currency?: string;
}

export interface ApiToken {
  id: number;
  name: string;
  apiKey: string;
  apiSecret?: string; // only shown on creation
  active: boolean;
  permissions: string[];
  created_at: string;
}

// Exchange config types
export interface ExchangeConstants {
  coins: Record<string, CoinConfig>;
  pairs: Record<string, PairConfig>;
  [key: string]: unknown;
}

export interface CoinConfig {
  id: number;
  fullname: string;
  symbol: string;
  active: boolean;
  allow_deposit: boolean;
  allow_withdrawal: boolean;
  withdrawal_fee: number;
  withdrawal_fees?: Record<string, { value: number; symbol?: string; active?: boolean }> | null;
  min: number;
  max: number;
  increment_unit: number;
  deposit_limits?: Record<string, number>;
  withdrawal_limits?: Record<string, number>;
  logo?: string;
  meta?: Record<string, unknown>;
  estimated_price?: number;
  type: string;
  network?: string;
  standard?: string;
}

export interface PairConfig {
  id: number;
  name: string;
  pair_base: string;
  pair_2: string;
  min_size: number;
  max_size: number;
  min_price: number;
  max_price: number;
  increment_size: number;
  increment_price: number;
  active: boolean;
  code?: string;
  estimated_price?: number;
}

export interface KitConfig {
  meta: Record<string, unknown>;
  color: Record<string, string>;
  icons: Record<string, string>;
  links: Record<string, string>;
  title: string;
  description: string;
  logo_image: string;
  valid_languages: string;
  native_currency: string;
  features: Record<string, boolean>;
  captcha?: { site_key?: string };
  cloudflare_turnstile?: { site_key?: string };
  [key: string]: unknown;
}

// Paginated response
export interface PaginatedResponse<T> {
  count: number;
  data: T[];
}

export interface QuickTradeQuote {
  token: string;
  spending_currency: string;
  spending_amount: number;
  receiving_currency: string;
  receiving_amount: number;
  expiry: string;
  [key: string]: unknown;
}

// Chart data — GET /chart returns an array of OHLCV candles (time is an ISO string).
export interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol?: string;
}
export type ChartData = ChartCandle[];
