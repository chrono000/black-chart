// ═══════════════════════════════════════════════════════════
// AuthContext — Authentication + paper-trading session
// ═══════════════════════════════════════════════════════════
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { configureApi, clearAuth, setOnUnauthorized, ApiError } from '../../api/client';
import { authApi } from '../../api/endpoints/auth';
import { userApi } from '../../api/endpoints/user';
import type { User, UserBalance } from '../../api/types';
import {
  loadPaper, savePaper, seedPaper, paperBalanceObject,
  paperPlaceOrder, paperCancelOrder, paperFillCheck, paperConvert, paperDeposit, paperWithdraw,
  type PaperState, type PaperOrder, type PaperTx, type PaperTrade, type PaperOrderReq,
} from './paper';
import { safeStorage } from './storage';

export interface PaperApi {
  orders: PaperOrder[];
  trades: PaperTrade[];
  deposits: PaperTx[];
  withdrawals: PaperTx[];
  placeOrder: (req: PaperOrderReq, marketPrice: number) => void;
  cancelOrder: (id: string) => void;
  fillCheck: (symbol: string, lastPrice: number) => void;
  convert: (from: string, to: string, fromAmt: number, toAmt: number) => void;
  deposit: (coin: string, amount: number, network?: string) => void;
  withdraw: (coin: string, amount: number, network?: string) => void;
  reset: () => void;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  balance: UserBalance | null;
  token: string | null;
  isPaper: boolean;
  login: (email: string, password: string, otpCode?: string, captcha?: string) => Promise<{ requiresOtp?: boolean }>;
  signup: (email: string, password: string, referral?: string, captcha?: string) => Promise<void>;
  paperLogin: () => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  paper: PaperApi | null;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'hollaex_lite_token';
const PAPER_MODE_KEY = 'black_chart_paper_mode';

// Boot straight into paper trading when embedded/demoed: ?paper / ?embed / ?demo
// in the URL, a paper-build (VITE_START_MODE=paper), or a prior paper session.
// Lets an <iframe> land in a fully usable simulated exchange with no login.
function shouldStartPaper(): boolean {
  try {
    const p = new URLSearchParams(window.location.search);
    const truthy = (k: string) => { const v = p.get(k); return v !== null && v !== '0' && v !== 'false'; };
    if (truthy('paper') || truthy('embed') || truthy('demo')) return true;
  } catch { /* ignore */ }
  if ((import.meta as any).env?.VITE_START_MODE === 'paper') return true;
  return safeStorage.get(PAPER_MODE_KEY) === '1';
}

const PAPER_USER: User = {
  id: 0,
  email: 'paper@blackchart.local',
  full_name: 'Paper Trader',
  verification_level: 3,
  otp_enabled: false,
  created_at: '2026-01-01T00:00:00.000Z',
};

// Centralized, locale-tolerant OTP-required detection (HollaEx messages are localized).
function isOtpRequired(err: any): boolean {
  const m = String(err?.data?.message ?? err?.message ?? '').toLowerCase();
  return m.includes('otp') || m.includes('2fa') || m.includes('two-factor') || m.includes('two factor');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => safeStorage.get(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [isLoading, setIsLoading] = useState(!!safeStorage.get(TOKEN_KEY));
  const [isPaper, setIsPaper] = useState<boolean>(() => shouldStartPaper());

  const [paperState, setPaperState] = useState<PaperState>(() => loadPaper());
  const paperRef = useRef(paperState);
  useEffect(() => { paperRef.current = paperState; }, [paperState]);
  const commitPaper = useCallback((next: PaperState) => {
    paperRef.current = next;
    setPaperState(next);
    savePaper(next);
  }, []);

  const isAuthenticated = isPaper || (!!token && !!user);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setBalance(null);
  }, []);

  // Configure API client with token
  useEffect(() => {
    if (token) {
      configureApi({ token });
      safeStorage.set(TOKEN_KEY, token);
    } else {
      clearAuth();
      safeStorage.remove(TOKEN_KEY);
    }
  }, [token]);

  // Global 401 reaction — drop a dead/expired/revoked session from any authed call.
  useEffect(() => {
    setOnUnauthorized(() => { clearSession(); });
    return () => setOnUnauthorized(null);
  }, [clearSession]);

  // Load user data on mount if a real token exists (never in paper mode).
  useEffect(() => {
    if (!isPaper && token && !user) {
      setIsLoading(true);
      Promise.all([userApi.getUser(), userApi.getBalance()])
        .then(([u, b]) => { setUser(u); setBalance(b); })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [token, user, isPaper, clearSession]);

  const login = useCallback(async (email: string, password: string, otpCode?: string, captcha?: string) => {
    let res: { token?: string };
    try {
      res = await authApi.login({ email, password, otp_code: otpCode, captcha, long_term: true });
    } catch (err: any) {
      if (isOtpRequired(err)) return { requiresOtp: true };
      throw err;
    }
    if (!res?.token) return {};
    configureApi({ token: res.token });
    setToken(res.token);
    try {
      const [u, b] = await Promise.all([userApi.getUser(), userApi.getBalance()]);
      setUser(u);
      setBalance(b);
    } catch {
      // Token valid; profile fetch failed transiently — keep the session.
    }
    return {};
  }, []);

  const signup = useCallback(async (email: string, password: string, referral?: string, captcha?: string) => {
    await authApi.signup({ email, password, referral, captcha });
  }, []);

  const paperLogin = useCallback(() => {
    // Enter paper mode and ensure no real session/credentials remain active.
    setToken(null);
    setUser(null);
    setBalance(null);
    clearAuth();
    setIsPaper(true);
    safeStorage.set(PAPER_MODE_KEY, '1');
  }, []);

  const logout = useCallback(() => {
    if (isPaper) {
      setIsPaper(false);
      safeStorage.remove(PAPER_MODE_KEY);
      return; // paper balances persist for next time; nothing server-side to revoke
    }
    authApi.logout().catch(() => {});
    clearSession();
    clearAuth();
  }, [isPaper, clearSession]);

  const refreshUser = useCallback(async () => {
    if (isPaper || !token) return;
    const u = await userApi.getUser();
    setUser(u);
  }, [isPaper, token]);

  const refreshBalance = useCallback(async () => {
    if (isPaper || !token) return;
    const b = await userApi.getBalance();
    setBalance(b);
  }, [isPaper, token]);

  const paper = useMemo<PaperApi | null>(() => {
    if (!isPaper) return null;
    return {
      orders: paperState.orders,
      trades: paperState.trades,
      deposits: paperState.deposits,
      withdrawals: paperState.withdrawals,
      placeOrder: (req, mp) => commitPaper(paperPlaceOrder(paperRef.current, req, mp)),
      cancelOrder: (id) => commitPaper(paperCancelOrder(paperRef.current, id)),
      fillCheck: (sym, lp) => { const n = paperFillCheck(paperRef.current, sym, lp); if (n) commitPaper(n); },
      convert: (f, t, fa, ta) => commitPaper(paperConvert(paperRef.current, f, t, fa, ta)),
      deposit: (c, a, n) => commitPaper(paperDeposit(paperRef.current, c, a, n)),
      withdraw: (c, a, n) => commitPaper(paperWithdraw(paperRef.current, c, a, n)),
      reset: () => commitPaper(seedPaper()),
    };
  }, [isPaper, paperState, commitPaper]);

  const effectiveUser = isPaper ? PAPER_USER : user;
  const effectiveBalance = isPaper ? paperBalanceObject(paperState) : balance;

  const value = useMemo<AuthState>(() => ({
    isAuthenticated,
    isLoading: isPaper ? false : isLoading,
    user: effectiveUser,
    balance: effectiveBalance,
    token,
    isPaper,
    login, signup, paperLogin, logout, refreshUser, refreshBalance,
    paper,
  }), [isAuthenticated, isLoading, effectiveUser, effectiveBalance, token, isPaper, login, signup, paperLogin, logout, refreshUser, refreshBalance, paper]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
