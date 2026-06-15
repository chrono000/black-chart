// ═══════════════════════════════════════════════════════════
// AuthContext — Authentication state management
// ═══════════════════════════════════════════════════════════
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { configureApi, clearAuth } from '../../api/client';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [isLoading, setIsLoading] = useState(!!localStorage.getItem(TOKEN_KEY));

  const isAuthenticated = !!token && !!user;

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

  // Load user data on mount if token exists
  useEffect(() => {
    if (token && !user) {
      setIsLoading(true);
      Promise.all([userApi.getUser(), userApi.getBalance()])
        .then(([u, b]) => { setUser(u); setBalance(b); })
        .catch(() => { setToken(null); setUser(null); setBalance(null); })
        .finally(() => setIsLoading(false));
    }
  }, [token, user]);

  const login = useCallback(async (email: string, password: string, otpCode?: string, captcha?: string) => {
    try {
      const res = await authApi.login({ email, password, otp_code: otpCode, captcha, long_term: true });
      if (res.token) {
        setToken(res.token);
        configureApi({ token: res.token });
        const [u, b] = await Promise.all([userApi.getUser(), userApi.getBalance()]);
        setUser(u);
        setBalance(b);
        return {};
      }
      return {};
    } catch (err: any) {
      // If OTP required, the API returns a specific error
      if (err?.data?.message?.includes('otp') || err?.data?.message?.includes('OTP')) {
        return { requiresOtp: true };
      }
      throw err;
    }
  }, []);

  const signup = useCallback(async (email: string, password: string, referral?: string, captcha?: string) => {
    await authApi.signup({ email, password, referral, captcha });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setBalance(null);
    clearAuth();
  }, []);

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
