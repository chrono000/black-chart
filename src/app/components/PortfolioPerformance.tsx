import { useEffect, useMemo, useState } from 'react';
import { AsciiChart } from './AsciiChart';
import { ChartSkeleton } from './ChartSkeleton';
import { chipProps } from '../lib/ui';
import { useExchange } from '../lib/ExchangeContext';
import { publicApi } from '../../api/endpoints/public';
import { num } from '../../api/market';
import { usePortfolioHistory, type PerfWindow } from '../lib/usePortfolioHistory';

const WINDOWS: { key: PerfWindow; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
];

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Chart width in columns — responsive so it fits a phone; series are resampled to it.
const chartWidthFor = (w: number) => (w < 600 ? 44 : w < 900 ? 60 : 78);

function resampleLinear(arr: number[], n: number): number[] {
  if (arr.length === 0) return [];
  if (arr.length === 1) return Array(n).fill(arr[0]);
  if (arr.length === n) return arr.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (arr.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const f = pos - lo;
    out.push(arr[lo] * (1 - f) + arr[hi] * f);
  }
  return out;
}

function resampleNearest(arr: number[], n: number): number[] {
  if (arr.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i / Math.max(1, n - 1)) * (arr.length - 1))]);
  return out;
}

// Wallet value over time — values current holdings against historical prices.
export function PortfolioPerformance({ balance }: { balance: Record<string, number> | null }) {
  const { displayCurrency } = useExchange();
  const [win, setWin] = useState<PerfWindow>('7d');
  const { values, times, loading, error } = usePortfolioHistory(balance, win);

  // Fewer columns on a narrow screen so the chart fits without horizontal scroll.
  const [chartW, setChartW] = useState(() => (typeof window !== 'undefined' ? chartWidthFor(window.innerWidth) : 78));
  useEffect(() => {
    const onResize = () => setChartW(chartWidthFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The history is valued in USDT; scale by the current USDT→display-currency
  // rate so the chart matches the wallet's display-currency totals (no-op for usdt).
  const [fx, setFx] = useState(1);
  useEffect(() => {
    if (displayCurrency === 'usdt') { setFx(1); return; }
    let cancelled = false;
    publicApi.getOraclePrices({ assets: 'usdt', quote: displayCurrency })
      .then((p) => { if (!cancelled) { const r = num(p['usdt']); setFx(r > 0 ? r : 1); } })
      .catch(() => { if (!cancelled) setFx(1); });
    return () => { cancelled = true; };
  }, [displayCurrency]);

  const scaled = useMemo(() => values.map((v) => v * fx), [values, fx]);

  const hasData = scaled.length >= 2;
  const data = hasData ? resampleLinear(scaled, chartW) : [];
  const t = hasData ? resampleNearest(times, chartW) : [];

  const first = scaled[0] ?? 0;
  const last = scaled[scaled.length - 1] ?? 0;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

  const xLabels = (() => {
    if (t.length === 0) return [];
    const idx = [...new Set([0, Math.floor(t.length / 2), t.length - 1])].filter((i) => i >= 0 && i < t.length);
    return idx.map((i) => fmtDate(t[i]));
  })();

  return (
    <div style={{ marginTop: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <span className="text-sec">:: performance <span className="text-ter">(current holdings · {displayCurrency})</span></span>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          {data.length > 1 && (
            <span className={changePct >= 0 ? 'text-up' : 'text-down'}>
              {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
            </span>
          )}
          {WINDOWS.map((w) => {
            const active = win === w.key;
            return (
              <span
                key={w.key}
                className="interact"
                {...chipProps(() => setWin(w.key))}
                style={{
                  cursor: 'pointer', padding: '0 2px',
                  color: active ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  backgroundColor: active ? 'var(--text-primary)' : 'transparent',
                  fontWeight: active ? 'bold' : 'normal',
                }}
              >
                {active ? ` ${w.label} ` : `[${w.label}]`}
              </span>
            );
          })}
        </div>
      </div>
      <div className="divider" />
      {loading ? (
        <ChartSkeleton height={10} width={chartW} message="loading performance..." pulseMessage />
      ) : error || !hasData ? (
        <ChartSkeleton height={10} width={chartW} message="no performance data for this period" />
      ) : (
        <AsciiChart
          data={data}
          height={10}
          width={chartW}
          xLabels={xLabels}
          currentPrice={last}
          format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        />
      )}
    </div>
  );
}
