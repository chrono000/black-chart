import { useState } from 'react';
import { AsciiChart } from './AsciiChart';
import { ChartSkeleton } from './ChartSkeleton';
import { chipProps } from '../lib/ui';
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

// Wallet value over time — values current holdings against historical prices.
export function PortfolioPerformance({ balance }: { balance: Record<string, number> | null }) {
  const [win, setWin] = useState<PerfWindow>('7d');
  const { values, times, loading, error } = usePortfolioHistory(balance, win);

  const data = values.slice(-120);
  const t = times.slice(-120);
  const width = Math.max(24, data.length);

  const first = data[0] ?? 0;
  const last = data[data.length - 1] ?? 0;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

  const xLabels = (() => {
    if (t.length === 0) return [];
    const idx = [...new Set([0, Math.floor(t.length / 2), t.length - 1])].filter((i) => i >= 0 && i < t.length);
    return idx.map((i) => fmtDate(t[i]));
  })();

  return (
    <div style={{ marginTop: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <span className="text-sec">:: performance <span className="text-ter">(current holdings · usdt)</span></span>
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
        <ChartSkeleton height={10} width={width} message="loading performance..." pulseMessage />
      ) : error || data.length < 2 ? (
        <ChartSkeleton height={10} width={Math.max(24, width)} message="no performance data for this period" />
      ) : (
        <AsciiChart
          data={data}
          height={10}
          width={width}
          xLabels={xLabels}
          currentPrice={last}
          format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        />
      )}
    </div>
  );
}
