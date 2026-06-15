// ═══════════════════════════════════════════════════════════
// AuthContext — Authentication state management
// ═══════════════════════════════════════════════════════════
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { configureApi, clearAuth, setOnUnauthorized, ApiError } from '../../api/client';
import { authApi } from '../../api/endpoints/auth';
import { userApi } from '../../api/endpoints/user';
import type { User, UserBalance } from '../../api/types';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  balance: UserBalance | null;
  token: string | null;
  login: (email: string, password: string, otpCode?: string, captcha?: string) => Promise<{ requiresOtp?: boolean }>;
  signup: (email: string, password: string, referral?: string, captcha?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'hollaex_lite_token';

// Centralized, locale-tolerant OTP-required detection (HollaEx messages are localized).
function isOtpRequired(err: any): boolean {
  const m = String(err?.data?.message ?? err?.message ?? '').toLowerCase();
  return m.includes('otp') || m.includes('2fa') || m.includes('two-factor') || m.includes('two factor');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [isLoading, setIsLoading] = useState(!!localStorage.getItem(TOKEN_KEY));

  const isAuthenticated = !!token && !!user;

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setBalance(null);
  }, []);

  // Configure API client with token
  useEffect(() => {
    if (token) {
      configureApi({ token });
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      clearAuth();
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  // Global 401 reaction — drop a dead/expired/revoked session from any authed call.
  useEffect(() => {
    setOnUnauthorized(() => { clearSession(); });
    return () => setOnUnauthorized(null);
  }, [clearSession]);

  // Load user data on mount if token exists. Only clear on a genuine auth
  // failure (401/403) — a transient network/5xx blip must NOT log the user out.
  useEffect(() => {
    if (token && !user) {
      setIsLoading(true);
      Promise.all([userApi.getUser(), userApi.getBalance()])
        .then(([u, b]) => { setUser(u); setBalance(b); })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
          }
          // transient error → keep token; effect retries on next mount/refresh.
        })
        .finally(() => setIsLoading(false));
    }
  }, [token, user, clearSession]);

  const login = useCallback(async (email: string, password: string, otpCode?: string, captcha?: string) => {
    let res: { token?: string };
    try {
      res = await authApi.login({ email, password, otp_code: otpCode, captcha, long_term: true });
    } catch (err: any) {
      if (isOtpRequired(err)) return { requiresOtp: true };
      throw err;
    }
    if (!res?.token) return {};
    // Configure synchronously so the immediate profile fetch is authenticated
    // (the [token] effect also configures + persists, idempotently).
    configureApi({ token: res.token });
    setToken(res.token);
    try {
      const [u, b] = await Promise.all([userApi.getUser(), userApi.getBalance()]);
      setUser(u);
      setBalance(b);
    } catch {
      // Token is valid; profile fetch failed transiently. Keep the session —
      // the mount effect / page loads will populate user+balance. Do not roll back.
    }
    return {};
  }, []);

  const signup = useCallback(async (email: string, password: string, referral?: string, captcha?: string) => {
    await authApi.signup({ email, password, referral, captcha });
  }, []);

  const logout = useCallback(() => {
    // Best-effort server-side revoke while the bearer is still attached; never block UI.
    authApi.logout().catch(() => {});
    clearSession();
    clearAuth();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    const u = await userApi.getUser();
    setUser(u);
  }, [token]);

  const refreshBalance = useCallback(async () => {
    if (!token) return;
    const b = await userApi.getBalance();
    setBalance(b);
  }, [token]);

  const value = useMemo<AuthState>(() => ({
    isAuthenticated, isLoading, user, balance, token,
    login, signup, logout, refreshUser, refreshBalance,
  }), [isAuthenticated, isLoading, user, balance, token, login, signup, logout, refreshUser, refreshBalance]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
