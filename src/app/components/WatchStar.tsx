import { useExchange } from '../lib/ExchangeContext';
import { chipProps } from '../lib/ui';

// A star toggle that adds/removes a market from the local watchlist.
// Stops propagation so starring inside a clickable row doesn't also navigate.
export function WatchStar({ pair, size = '14px' }: { pair: string; size?: string }) {
  const { isWatched, toggleWatch } = useExchange();
  const on = isWatched(pair);
  const props = chipProps(() => toggleWatch(pair));
  return (
    <span
      {...props}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWatch(pair); }}
      title={on ? 'remove from watchlist' : 'add to watchlist'}
      aria-label={on ? `remove ${pair.toUpperCase()} from watchlist` : `add ${pair.toUpperCase()} to watchlist`}
      aria-pressed={on}
      className="interact"
      style={{ color: on ? 'var(--brand-up)' : 'var(--text-tertiary)', fontSize: size, lineHeight: 1, userSelect: 'none' }}
    >
      {on ? '★' : '☆'}
    </span>
  );
}
