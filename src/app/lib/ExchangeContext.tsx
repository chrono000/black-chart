// ═══════════════════════════════════════════════════════════
// ExchangeContext — Exchange config, tickers, theme
// ═══════════════════════════════════════════════════════════
import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { publicApi } from '../../api/endpoints/public';
import { safeStorage } from './storage';
import type { ExchangeConstants, KitConfig, Ticker } from '../../api/types';

type ThemeMode = 'light' | 'dark';

interface ExchangeState {
  constants: ExchangeConstants | null;
  kit: KitConfig | null;
  tickers: Record<string, Ticker>;
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
  displayCurrency: string;
  setDisplayCurrency: (ccy: string) => void;
  watchlist: string[];
  isWatched: (pair: string) => boolean;
  toggleWatch: (pair: string) => void;
  isLoading: boolean;
  refreshTickers: () => Promise<void>;
}

const ExchangeContext = createContext<ExchangeState | null>(null);

const THEME_KEY = 'hollaex_lite_theme';
const DISPLAY_CCY_KEY = 'black_chart_display_ccy';
const WATCHLIST_KEY = 'black_chart_watchlist';

export function ExchangeProvider({ children }: { children: ReactNode }) {
  const [constants, setConstants] = useState<ExchangeConstants | null>(null);
  const [kit, setKit] = useState<KitConfig | null>(null);
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = safeStorage.get(THEME_KEY) as ThemeMode | null;
    if (saved) return saved;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'dark'; }
  });

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    safeStorage.set(THEME_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const [displayCurrency, setDisplayCurrencyState] = useState<string>(() => safeStorage.get(DISPLAY_CCY_KEY) || 'usdt');
  const setDisplayCurrency = useCallback((ccy: string) => {
    const c = (ccy || 'usdt').toLowerCase();
    setDisplayCurrencyState(c);
    safeStorage.set(DISPLAY_CCY_KEY, c);
  }, []);

  // Watchlist — starred markets (pair names), persisted locally so it works in
  // viewer / paper / live alike. Surfaced on the Home dashboard.
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { const raw = safeStorage.get(WATCHLIST_KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr.map(String) : []; } catch { return []; }
  });
  const isWatched = useCallback((pair: string) => watchlist.includes(pair.toLowerCase()), [watchlist]);
  const toggleWatch = useCallback((pair: string) => {
    const p = pair.toLowerCase();
    setWatchlist((prev) => {
      const next = prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p];
      safeStorage.set(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Load exchange config on mount
  useEffect(() => {
    Promise.all([
      publicApi.getConstants().catch(() => null),
      publicApi.getKit().catch(() => null),
      publicApi.getAllTickers().catch(() => ({})),
    ]).then(([c, k, t]) => {
      if (c) setConstants(c);
      if (k) setKit(k);
      setTickers(t as Record<string, Ticker>);
    }).finally(() => setIsLoading(false));
  }, []);

  // Auto-refresh tickers every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      publicApi.getAllTickers().then(setTickers).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const refreshTickers = useCallback(async () => {
    const t = await publicApi.getAllTickers();
    setTickers(t);
  }, []);

  const value = useMemo<ExchangeState>(() => ({
    constants, kit, tickers, theme, toggleTheme, setTheme, displayCurrency, setDisplayCurrency,
    watchlist, isWatched, toggleWatch, isLoading, refreshTickers,
  }), [constants, kit, tickers, theme, toggleTheme, setTheme, displayCurrency, setDisplayCurrency, watchlist, isWatched, toggleWatch, isLoading, refreshTickers]);

  return <ExchangeContext.Provider value={value}>{children}</ExchangeContext.Provider>;
}

export function useExchange(): ExchangeState {
  const ctx = useContext(ExchangeContext);
  if (!ctx) throw new Error('useExchange must be used within ExchangeProvider');
  return ctx;
}
