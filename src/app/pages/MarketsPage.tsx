import { useState } from 'react';
import { useExchange } from '../lib/ExchangeContext';
import { num } from '../../api/market';
import { Link } from 'react-router';
import { WatchStar } from '../components/WatchStar';

type SortKey = 'pair' | 'price' | 'change' | 'volume';

export function MarketsPage() {
  const { tickers, constants } = useExchange();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDesc, setSortDesc] = useState(true);

  const pairs = Object.values(constants?.pairs || {}).filter(p => p.active);

  const filtered = pairs.filter(p => p.name.includes(search.toLowerCase()));

  filtered.sort((a, b) => {
    const tA = tickers[a.name];
    const tB = tickers[b.name];
    if (!tA || !tB) return 0;

    let valA = 0, valB = 0;
    if (sortKey === 'pair') {
      return sortDesc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
    } else if (sortKey === 'price') {
      valA = num(tA.last); valB = num(tB.last);
    } else if (sortKey === 'change') {
      valA = num(tA.open) > 0 ? (num(tA.close) - num(tA.open)) / num(tA.open) : 0;
      valB = num(tB.open) > 0 ? (num(tB.close) - num(tB.open)) / num(tB.open) : 0;
    } else {
      valA = num(tA.volume); valB = num(tB.volume);
    }

    return sortDesc ? valB - valA : valA - valB;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
  };

  const sortInd = (key: SortKey) => sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : '';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-sec">:: markets_directory <span className="text-ter" style={{ fontSize: '11px' }}>(trading pairs)</span></span>
        <input
          type="text"
          placeholder="[search market]"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '150px' }}
        />
      </div>
      <div className="divider" />

      <table>
        <thead>
          <tr>
            <th aria-label="watch" style={{ width: '24px' }}></th>
            <th onClick={() => toggleSort('pair')} style={{ cursor: 'pointer' }}>pair{sortInd('pair')}</th>
            <th onClick={() => toggleSort('price')} style={{ cursor: 'pointer' }}>price{sortInd('price')}</th>
            <th onClick={() => toggleSort('change')} style={{ cursor: 'pointer' }}>change{sortInd('change')}</th>
            <th onClick={() => toggleSort('volume')} style={{ cursor: 'pointer' }}>volume{sortInd('volume')}</th>
            <th>action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(pair => {
            const ticker = tickers[pair.name];
            if (!ticker) return null;

            const last = num(ticker.last);
            const open = num(ticker.open);
            const close = num(ticker.close);
            const hasChange = open > 0;
            const isUp = close >= open;
            const changePct = hasChange ? ((close - open) / open) * 100 : 0;
            const changeStr = `${isUp ? '+' : ''}${changePct.toFixed(2)}%`;
            const colorClass = isUp ? 'text-up' : 'text-down';

            return (
              <tr key={pair.name}>
                <td style={{ textAlign: 'center' }}><WatchStar pair={pair.name} /></td>
                <td><Link to={`/coin/${pair.pair_base}`} className="text-primary">{pair.name.toUpperCase()}</Link></td>
                <td>{last.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                <td className={hasChange ? colorClass : 'text-ter'}>
                  {hasChange ? changeStr : '—'}
                </td>
                <td className="text-sec">{num(ticker.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td>
                  <Link to={`/trade?pair=${pair.name}`} className="text-primary">[trade]</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
