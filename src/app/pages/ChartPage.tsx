import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { AsciiChart } from '../components/AsciiChart';
import { useDisplayPairs, useAllPairOptions } from '../lib/useDisplayPairs';
import { chipProps } from '../lib/ui';
import { SearchSelect } from '../components/SearchSelect';
import {
  getCandles, getOrderbook, getRecentTrades, getMarketTicker,
  RESOLUTION, RES_MS, RES_LADDER,
  type Candle, type OrderbookSide, type PublicTrade,
} from '../../api/market';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export function ChartPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(searchParams.get('pair') || 'btc-usdt');
  const initialTf = searchParams.get('tf') || '1d';
  const [timeframe, setTimeframe] = useState(TIMEFRAMES.includes(initialTf) ? initialTf : '1d');

  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [chartData, setChartData] = useState<Candle[] | null>(null);
  const [liveTicker, setLiveTicker] = useState<{ last: number; changePct: number } | null>(null);
  const [zoomStack, setZoomStack] = useState<{ t1: number; t2: number }[]>([]);
  const zoomBounds = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : null;
  const [zoomError, setZoomError] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const hasInitialData = React.useRef(false);
  const [orderbook, setOrderbook] = useState<OrderbookSide | null>(null);
  const [recentTrades, setRecentTrades] = useState<PublicTrade[]>([]);
  const [showMarketData, setShowMarketData] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  const displayPairs = useDisplayPairs(symbol);
  const allPairs = useAllPairOptions();
  const selectPair = (p: string) => { setSymbol(p); setZoomStack([]); setSearchParams({ pair: p, tf: timeframe }); };

  // 1. Calculate optimal terminal matrix bounds
  useEffect(() => {
    const updateDims = () => {
      const chWidth = 7.8;
      const chHeight = 13.0;
      const availableWidth = window.innerWidth - 250;
      const volExtra = showVolume ? 65 : 0;
      const availableHeight = window.innerHeight - (showMarketData ? 420 : 150) - volExtra;
      const cols = Math.min(1000, Math.max(40, Math.floor(availableWidth / chWidth)));
      const rows = Math.max(10, Math.floor(availableHeight / chHeight));
      setDimensions({ width: cols, height: rows });
    };
    updateDims();
    window.addEventListener('resize', updateDims);
    return () => window.removeEventListener('resize', updateDims);
  }, [showMarketData, showVolume]);

  // Keyboard navigation & Esc exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomStack([]);
      if (e.key === 'm' || e.key === 'M') setShowMarketData((p) => !p);
      if (e.key === 'v' || e.key === 'V') setShowVolume((p) => !p);
      if (zoomBounds && e.key === 'ArrowLeft') {
        const dur = zoomBounds.t2 - zoomBounds.t1;
        setZoomStack((prev) => { const s = [...prev]; s[s.length - 1] = { t1: zoomBounds.t1 - dur * 0.5, t2: zoomBounds.t2 - dur * 0.5 }; return s; });
      }
      if (zoomBounds && e.key === 'ArrowRight') {
        const dur = zoomBounds.t2 - zoomBounds.t1;
        const shift = dur * 0.5;
        if (zoomBounds.t2 + shift <= Date.now()) {
          setZoomStack((prev) => { const s = [...prev]; s[s.length - 1] = { t1: zoomBounds.t1 + shift, t2: zoomBounds.t2 + shift }; return s; });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomBounds]);

  // 2. Fetch market data from HollaEx, sized to the matrix column width
  useEffect(() => {
    if (!dimensions) return;
    let cancelled = false;
    setOrderbook(null);
    setRecentTrades([]);

    let resolution = RESOLUTION[timeframe] || '1D';
    let fromSec: number;
    let toSec: number;

    if (zoomBounds) {
      const targetMs = (zoomBounds.t2 - zoomBounds.t1) / dimensions.width;
      let best = RES_LADDER[0];
      for (const r of RES_LADDER) { if (r.ms <= targetMs) best = r; }
      resolution = best.res;
      fromSec = Math.floor(zoomBounds.t1 / 1000);
      toSec = Math.ceil(zoomBounds.t2 / 1000);
    } else {
      const durSec = (RES_MS[resolution] || 86_400_000) / 1000;
      toSec = Math.floor(Date.now() / 1000);
      fromSec = toSec - Math.floor(durSec * (dimensions.width + 2));
    }

    const processData = (parsedAll: Candle[]) => {
      let parsed = parsedAll;
      if (zoomBounds && parsed.length > 0) {
        // Resample to `width` columns via a single advancing pointer (data is sorted asc).
        const resampled: Candle[] = [];
        const duration = zoomBounds.t2 - zoomBounds.t1;
        let j = 0;
        for (let i = 0; i < dimensions.width; i++) {
          const targetT = Math.floor(zoomBounds.t1 + (i / dimensions.width) * duration);
          while (j + 1 < parsed.length && parsed[j + 1].t <= targetT) j++;
          let closest = parsed[j];
          if (j + 1 < parsed.length && Math.abs(parsed[j + 1].t - targetT) < Math.abs(parsed[j].t - targetT)) {
            closest = parsed[j + 1];
          }
          resampled.push({ ...closest, t: targetT });
        }
        parsed = resampled;
      } else {
        parsed = parsed.slice(-dimensions.width);
      }
      if (!cancelled) setChartData(parsed);
    };

    const fetchChart = () => {
      if (hasInitialData.current) setIsFetching(true);
      getCandles(symbol, resolution, fromSec, toSec)
        .then((data) => {
          if (cancelled) return;
          processData(data);
          setIsFetching(false);
          hasInitialData.current = true;
        })
        .catch(() => { if (!cancelled) { setChartData([]); setIsFetching(false); } });
    };

    const fetchTicker = () => {
      getMarketTicker(symbol)
        .then((t) => {
          if (cancelled) return;
          const change = t.open > 0 ? ((t.last - t.open) / t.open) * 100 : 0;
          setLiveTicker({ last: t.last, changePct: change });
        })
        .catch(() => {});
    };

    fetchChart();
    if (!zoomBounds) fetchTicker();

    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (!zoomBounds) {
      // 1W barely changes and returns a large payload — don't re-fetch it on a timer.
      intervalId = setInterval(() => { if (resolution !== '1W') fetchChart(); fetchTicker(); }, 5000);
    }

    const fetchOb = () => { getOrderbook(symbol).then((ob) => { if (!cancelled) setOrderbook(ob); }).catch(() => {}); };
    const fetchTrades = () => { getRecentTrades(symbol).then((t) => { if (!cancelled) setRecentTrades(t); }).catch(() => {}); };
    fetchOb();
    fetchTrades();
    const obInterval = setInterval(() => { fetchOb(); fetchTrades(); }, 5000);

    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); clearInterval(obInterval); };
  }, [symbol, timeframe, dimensions?.width, zoomBounds]);

  const lastPrice = chartData?.[chartData.length - 1]?.c || 0;
  const displayLast = liveTicker?.last || lastPrice;
  // Headline is always the ticker's 24h change (not change-since-first-visible-candle).
  const displayChange = liveTicker ? liveTicker.changePct : 0;

  const fullTimeLabels = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    const isShort = timeframe === '1h' || timeframe === '4h' || timeframe.includes('m') || zoomBounds !== null;
    return chartData.map((c) => {
      const d = new Date(c.t);
      return isShort
        ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
  }, [chartData, timeframe, zoomBounds]);

  const xLabels = useMemo(() => {
    if (fullTimeLabels.length === 0) return [];
    const len = fullTimeLabels.length;
    const idx = Array.from(new Set([0, Math.floor(len * 0.2), Math.floor(len * 0.4), Math.floor(len * 0.6), Math.floor(len * 0.8), len - 1])).sort((a, b) => a - b);
    return idx.map((i) => fullTimeLabels[i]);
  }, [fullTimeLabels]);

  const chartClosePrices = useMemo(() => (chartData ? chartData.map((c) => c.c) : []), [chartData]);
  const chartVolumes = useMemo(() => (chartData ? chartData.map((c) => c.v || 0) : []), [chartData]);
  const chartDirections = useMemo(() => (chartData ? chartData.map((c) => (c.c >= c.o ? 'up' : 'down')) : []), [chartData]);
  // Compute the depth-bar scale once per book update (not per row).
  const obMaxSize = useMemo(() => (orderbook ? Math.max(...orderbook.asks.map((a) => a[1]), ...orderbook.bids.map((b) => b[1]), 1) : 1), [orderbook]);

  // Pan-right is allowed only until the window's right edge reaches ~now (one candle margin).
  const zoomDur = zoomBounds ? zoomBounds.t2 - zoomBounds.t1 : 0;
  const panMargin = zoomBounds && dimensions ? zoomDur / dimensions.width : 0;
  const canPanRight = !!zoomBounds && (zoomBounds.t2 + zoomDur * 0.5 <= Date.now() + panMargin);
  const panRight = () => {
    if (!zoomBounds || !canPanRight) return;
    const shift = zoomDur * 0.5;
    setZoomStack((prev) => { const s = [...prev]; s[s.length - 1] = { t1: zoomBounds.t1 + shift, t2: zoomBounds.t2 + shift }; return s; });
  };
  const panLeft = () => {
    if (!zoomBounds) return;
    const shift = zoomDur * 0.5;
    setZoomStack((prev) => { const s = [...prev]; s[s.length - 1] = { t1: zoomBounds.t1 - shift, t2: zoomBounds.t2 - shift }; return s; });
  };

  return (
    <div style={{ padding: '10px 20px', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span className="text-sec">
          <span className="text-ter">black chart</span>
          <span className="text-ter" style={{ margin: '0 8px' }}>·</span>
          <span className="text-ter">hollaex/v2</span>
          <span className="text-ter" style={{ margin: '0 8px' }}>·</span>
          :: terminal_max_{symbol}_{timeframe}
          {zoomBounds && <span style={{ color: 'var(--text-primary)', marginLeft: '10px' }}>[ZOOM_LOCK]</span>}
          {zoomError && <span className="text-down" style={{ marginLeft: '10px', fontWeight: 'bold' }}>[ERR: MAX ZOOM]</span>}
          {isFetching && <span style={{ marginLeft: '10px', color: 'var(--text-primary)', animation: 'termPulse 0.6s ease-in-out infinite' }}>[FETCHING...]</span>}
          <span className="interact" {...chipProps(() => setShowMarketData((p) => !p))} style={{ marginLeft: '10px', color: showMarketData ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            [{showMarketData ? 'M: MARKET ON' : 'M: MARKET OFF'}]
          </span>
          <span className="interact" {...chipProps(() => setShowVolume((p) => !p))} style={{ marginLeft: '10px', color: showVolume ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            [{showVolume ? 'V: VOL ON' : 'V: VOL OFF'}]
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {zoomBounds && (
            <>
              <span className="interact" {...chipProps(panLeft)} style={{ marginRight: '10px', color: 'var(--text-ter)' }}>[ {'<'} PAN ]</span>
              <span
                {...chipProps(panRight)}
                className={canPanRight ? 'interact' : ''}
                style={{ marginRight: '20px', color: canPanRight ? 'var(--text-ter)' : 'var(--bg-secondary)', cursor: canPanRight ? 'pointer' : 'default' }}
              >[ PAN {'>'} ]</span>
              <span className="interact" {...chipProps(() => setZoomStack((prev) => prev.slice(0, -1)))} style={{ marginRight: '10px', color: 'var(--text-ter)' }}>[ - ZOOM OUT ]</span>
              <span className="interact" {...chipProps(() => setZoomStack([]))} style={{ marginRight: '20px', color: 'var(--bg-primary)', backgroundColor: 'var(--text-secondary)', padding: '2px 8px', fontWeight: 'bold' }}>[ × EXIT ALL ZOOM (ESC) ]</span>
            </>
          )}
          {displayLast > 0 && (
            <span>
              {displayLast.toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
              <span className={displayChange >= 0 ? 'text-up' : 'text-down'}>
                {displayChange >= 0 ? '▲' : '▼'} {Math.abs(displayChange).toFixed(2)}% {!zoomBounds && <span className="text-ter">24h</span>}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Pair Selector */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="text-ter" style={{ marginRight: '4px' }}>pair:</span>
        <SearchSelect value={symbol} options={allPairs} onChange={selectPair} placeholder="search market" style={{ flex: '0 0 150px' }} />
        <span className="text-ter" style={{ fontSize: '11px' }}>quick:</span>
        {displayPairs.map((p) => {
          const isActive = symbol === p;
          return (
            <span key={p} className="interact" {...chipProps(() => selectPair(p))} style={{ cursor: 'pointer', padding: '0 2px', color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)', backgroundColor: isActive ? 'var(--text-primary)' : 'transparent', fontWeight: isActive ? 'bold' : 'normal' }}>
              {isActive ? ` ${p.toUpperCase()} ` : `[${p.toUpperCase()}]`}
            </span>
          );
        })}
      </div>

      {/* Timeframe Selector */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <span className="text-ter" style={{ marginRight: '4px' }}>  tf:</span>
        {TIMEFRAMES.map((tf) => {
          const isActive = timeframe === tf;
          return (
            <span key={tf} className="interact" {...chipProps(() => { setTimeframe(tf); setZoomStack([]); setSearchParams({ pair: symbol, tf }); })} style={{ cursor: 'pointer', padding: '0 2px', color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)', backgroundColor: isActive ? 'var(--text-primary)' : 'transparent', fontWeight: isActive ? 'bold' : 'normal' }}>
              {isActive ? ` ${tf.toUpperCase()} ` : `[${tf.toUpperCase()}]`}
            </span>
          );
        })}
      </div>

      <style>{`@keyframes termPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: isFetching ? 0.4 : 1, transition: 'opacity 0.15s ease' }}>
        {!dimensions ? (
          <div className="text-ter">measuring viewport...</div>
        ) : chartData ? (
          chartData.length > 0 ? (
            <AsciiChart
              data={chartClosePrices}
              height={dimensions.height}
              width={dimensions.width}
              xLabels={xLabels}
              currentPrice={zoomBounds ? undefined : displayLast}
              timeLabels={fullTimeLabels}
              volumeData={showVolume ? chartVolumes : undefined}
              volumeDirections={showVolume ? chartDirections : undefined}
              onZoom={(s, e) => {
                if (!chartData || s >= chartData.length || e >= chartData.length) return;
                const t1 = Math.floor(chartData[s].t);
                const t2 = Math.floor(chartData[e].t);
                const curResMs = zoomBounds ? (zoomBounds.t2 - zoomBounds.t1) / dimensions.width : (RES_MS[RESOLUTION[timeframe] || '1D'] || 86_400_000);
                if (t2 - t1 < curResMs * 3) { setZoomError(true); setTimeout(() => setZoomError(false), 2000); return; }
                setZoomError(false);
                setZoomStack((prev) => [...prev, { t1, t2 }]);
              }}
            />
          ) : (
            <div className="text-ter">no chart data available for this period.</div>
          )
        ) : (
          <div className="text-ter">initializing deep matrix projection...</div>
        )}
      </div>

      {/* Orderbook + Trades — toggleable via M key */}
      {showMarketData && (
        <div style={{ display: 'flex', gap: '40px', marginTop: '10px', overflow: 'hidden', maxHeight: '280px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sec" style={{ marginBottom: '6px' }}>[ orderbook_depth ]</div>
            {orderbook ? (
              <table style={{ fontSize: '12px', width: '100%' }}>
                <thead>
                  <tr><th>price</th><th>size</th><th style={{ textAlign: 'left', paddingLeft: '10px' }}>depth</th></tr>
                </thead>
                <tbody>
                  {orderbook.asks.slice(0, 10).reverse().map((ask, i) => {
                    const barW = Math.max(1, Math.round((ask[1] / obMaxSize) * 20));
                    return (
                      <tr key={`a${i}`} className="text-down">
                        <td>{ask[0].toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                        <td>{ask[1]}</td>
                        <td style={{ paddingLeft: '10px' }}>{'█'.repeat(barW)}</td>
                      </tr>
                    );
                  })}
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: '4px 0' }} className="text-ter">--- spread ---</td></tr>
                  {orderbook.bids.slice(0, 10).map((bid, i) => {
                    const barW = Math.max(1, Math.round((bid[1] / obMaxSize) * 20));
                    return (
                      <tr key={`b${i}`} className="text-up">
                        <td>{bid[0].toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                        <td>{bid[1]}</td>
                        <td style={{ paddingLeft: '10px' }}>{'█'.repeat(barW)}</td>
                      </tr>
                    );
                  })}
                  {orderbook.asks.length === 0 && orderbook.bids.length === 0 && (
                    <tr><td colSpan={3} className="text-ter">no open orders on book</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div className="text-ter">loading orderbook...</div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sec" style={{ marginBottom: '6px' }}>[ recent_trades ]</div>
            {recentTrades.length > 0 ? (
              <table style={{ fontSize: '12px', width: '100%' }}>
                <thead>
                  <tr><th>time</th><th>price</th><th>qty</th></tr>
                </thead>
                <tbody>
                  {recentTrades.slice(0, 15).map((t, i) => {
                    const d = new Date(t.timestamp);
                    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                    return (
                      <tr key={`${t.timestamp}-${i}`} className={t.side === 'sell' ? 'text-down' : 'text-up'}>
                        <td>{timeStr}</td>
                        <td>{t.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                        <td>{t.size}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-ter">loading trades...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
