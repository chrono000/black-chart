import React, { useState, useRef } from 'react';

interface AsciiChartProps {
  data: number[];
  height?: number;
  width?: number;
  format?: (n: number) => string;
  xLabels?: string[];
  startPrice?: number;
  currentPrice?: number;
  onZoom?: (startIndex: number, endIndex: number) => void;
  timeLabels?: string[];
  volumeData?: number[];
  volumeDirections?: string[];
}

export const AsciiChart = React.memo(function AsciiChart({ 
  data, 
  height = 16, 
  width = 60,
  format = (n) => n.toFixed(2),
  xLabels,
  startPrice,
  currentPrice,
  onZoom,
  timeLabels,
  volumeData,
  volumeDirections
}: AsciiChartProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartCol, setDragStartCol] = useState(0);
  const [dragCurrentCol, setDragCurrentCol] = useState(0);
  const hoverState = useRef<{ col: number, row: number }>({ col: -1, row: -1 });
  const containerRef = useRef<HTMLDivElement>(null);
  if (!data || data.length === 0) {
    return <div className="text-sec">no chart data</div>;
  }

  const validData = data.filter(d => typeof d === 'number' && !isNaN(d));
  if (validData.length === 0) {
    return <div className="text-sec">no valid chart data</div>;
  }

  const actualStartPrice = startPrice !== undefined ? startPrice : validData[0];
  const actualCurrentPrice = currentPrice !== undefined ? currentPrice : validData[validData.length - 1];

  let rawMax = Math.max(...validData, actualStartPrice, actualCurrentPrice);
  let rawMin = Math.min(...validData, actualStartPrice, actualCurrentPrice);
  const diff = rawMax - rawMin;
  
  // Apply a 10% vertical breathing padding so the chart naturally centers itself
  const max = diff > 0 ? rawMax + (diff * 0.1) : rawMax * 1.01;
  const min = diff > 0 ? rawMin - (diff * 0.1) : rawMin * 0.99;
  
  const range = max - min;

  const getY = (val: number) => {
    if (range === 0) return Math.floor(height / 2);
    return Math.floor(((max - val) / range) * (height - 1));
  };

  const startRow = getY(actualStartPrice);
  const currentRow = getY(actualCurrentPrice);

  const yLabels = Array.from({ length: height }).map((_, i) => {
    if (i === startRow) return format(actualStartPrice);
    const val = max - (i * range) / (height - 1);
    return format(val);
  });
  
  const maxLabelLen = Math.max(...yLabels.map(l => l.length));

  type Cell = { char: string; colorClass?: string };
  const grid: Cell[][] = Array.from({ length: height }, () => Array(width).fill({ char: ' ' }));

  const startX = Math.max(0, width - validData.length);

  const extractPos = (e: React.MouseEvent<HTMLDivElement>) => {
    let target = e.target as HTMLElement;
    while (target && !target.hasAttribute('data-col') && target.parentElement) {
      target = target.parentElement;
    }
    const c = target?.getAttribute('data-col');
    const r = target?.getAttribute('data-row');
    if (c !== null && c !== undefined && r !== null && r !== undefined) {
      return { col: parseInt(c, 10), row: parseInt(r, 10), isValid: true };
    }
    return { col: 0, row: 0, isValid: false };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onZoom) return;
    const pos = extractPos(e);
    if (!pos.isValid) return;
    setIsDragging(true);
    setDragStartCol(pos.col);
    setDragCurrentCol(pos.col);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const pos = extractPos(e);
    
    if (isDragging) {
      setDragCurrentCol(pos.col);
    }
    
    if (!containerRef.current) return;
    
    const prev = hoverState.current;
    
    // Scrub last highlights
    if (prev.col !== -1 && (prev.col !== pos.col || !pos.isValid || isDragging)) {
      containerRef.current.querySelectorAll(`span[data-col="${prev.col}"]`).forEach((el: any) => (el as HTMLElement).style.backgroundColor = 'transparent');
      const xTip = containerRef.current.querySelector('#x-axis-tooltip') as HTMLElement;
      if (xTip) xTip.style.display = 'none';
      hoverState.current.col = -1;
    }
    if (prev.row !== -1 && (prev.row !== pos.row || !pos.isValid || isDragging)) {
      containerRef.current.querySelectorAll(`span[data-row="${prev.row}"]`).forEach((el: any) => (el as HTMLElement).style.backgroundColor = 'transparent');
      const yAxis = containerRef.current.querySelector(`#y-axis-${prev.row}`) as HTMLElement;
      if (yAxis) {
        yAxis.style.backgroundColor = 'transparent';
        yAxis.style.color = yAxis.getAttribute('data-ogcolor') || 'inherit';
        yAxis.innerText = yAxis.getAttribute('data-raw') || '';
      }
      hoverState.current.row = -1;
    }

    if (pos.isValid && !isDragging) {
      if (pos.col !== hoverState.current.col) {
        containerRef.current.querySelectorAll(`span[data-col="${pos.col}"]`).forEach((el: any) => (el as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.12)');
        
        const xTip = containerRef.current.querySelector('#x-axis-tooltip') as HTMLElement;
        if (xTip) {
          xTip.style.display = 'block';
          xTip.style.left = `calc(${pos.col}ch)`;
          const idx = Math.max(0, data.length - width) + Math.max(0, pos.col - startX);
          xTip.innerText = timeLabels ? (timeLabels[idx] || '') : `${pos.col}x${pos.row}`;
        }
        hoverState.current.col = pos.col;
      }
      if (pos.row !== hoverState.current.row) {
        containerRef.current.querySelectorAll(`span[data-row="${pos.row}"]`).forEach((el: any) => (el as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.12)');
        
        const yAxis = containerRef.current.querySelector(`#y-axis-${pos.row}`) as HTMLElement;
        if (yAxis) {
          yAxis.style.backgroundColor = 'var(--text-primary)';
          yAxis.style.color = 'var(--bg-primary)';
          yAxis.innerText = yAxis.getAttribute('data-hover') || '';
        }
        hoverState.current.row = pos.row;
      }
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverState.current.col !== -1) {
      containerRef.current?.querySelectorAll(`span[data-col="${hoverState.current.col}"]`).forEach((el: any) => (el as HTMLElement).style.backgroundColor = 'transparent');
      const xTip = containerRef.current?.querySelector('#x-axis-tooltip') as HTMLElement;
      if (xTip) xTip.style.display = 'none';
      hoverState.current.col = -1;
    }
    if (hoverState.current.row !== -1) {
      containerRef.current?.querySelectorAll(`span[data-row="${hoverState.current.row}"]`).forEach((el: any) => (el as HTMLElement).style.backgroundColor = 'transparent');
      const yAxis = containerRef.current?.querySelector(`#y-axis-${hoverState.current.row}`) as HTMLElement;
      if (yAxis) {
        yAxis.style.backgroundColor = 'transparent';
        yAxis.style.color = yAxis.getAttribute('data-ogcolor') || 'inherit';
        yAxis.innerText = yAxis.getAttribute('data-raw') || '';
      }
      hoverState.current.row = -1;
    }
    
    if (isDragging) {
      handleMouseUp(e);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      const pos = extractPos(e);
      let col = dragCurrentCol;
      if (pos.isValid) col = pos.col;
      const startCol = Math.min(dragStartCol, col);
      const endCol = Math.max(dragStartCol, col);
      
      if (endCol - startCol >= 2 && onZoom) {
        // Map grid cols to absolute array index
        const validDataStartIndex = Math.max(0, data.length - width);
        const absoluteStartIndex = validDataStartIndex + Math.max(0, startCol - startX);
        const absoluteEndIndex = validDataStartIndex + Math.max(0, Math.min(validData.length - 1, endCol - startX));
        
        onZoom(absoluteStartIndex, absoluteEndIndex);
      }
      
      // Reset visual state
      setTimeout(() => {
        setDragStartCol(0);
        setDragCurrentCol(0);
      }, 50);
    }
  };

  validData.forEach((val, i) => {
    const x = startX + i;
    if (x >= width) return;

    const currR = getY(val);
    const prevVal = i > 0 ? validData[i - 1] : validData[0];

    let colorClass = 'text-sec';
    if (val < prevVal) {
      colorClass = 'text-down';
    } else if (val > prevVal) {
      colorClass = 'text-up';
    }

    for (let r = 0; r < height; r++) {
      if (r > currR) {
        grid[r][x] = { char: '░', colorClass: 'text-ter' };
      } else if (r === currR) {
        grid[r][x] = { char: '█', colorClass };
      }
    }
  });

  return (
    <pre className="ascii-chart" style={{ margin: 0, fontFamily: 'inherit', lineHeight: '1', letterSpacing: '0px' }}>
      <div 
        ref={containerRef}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative', cursor: onZoom ? 'crosshair' : 'default', userSelect: 'none' }}
        onMouseDown={onZoom ? handleMouseDown : undefined}
        onMouseMove={onZoom ? handleMouseMove : undefined}
        onMouseUp={onZoom ? handleMouseUp : undefined}
        onMouseLeave={onZoom ? handleMouseLeave : undefined}
      >
        {/* Coordinate Tooltip is managed natively via getElementById */}
        
        {isDragging && onZoom && (
          <>
            <div style={{
              position: 'absolute',
              left: `calc(${maxLabelLen + 2}ch + 10px + ${Math.min(dragStartCol, dragCurrentCol)}ch)`,
              width: `${Math.max(dragStartCol, dragCurrentCol) - Math.min(dragStartCol, dragCurrentCol) + 1}ch`,
              top: 0,
              bottom: 0,
              backgroundColor: 'var(--text-ter)',
              opacity: 0.5,
              pointerEvents: 'none',
              zIndex: 10
            }} />
            <div style={{
              position: 'absolute',
              left: `calc(${maxLabelLen + 2}ch + 10px + ${Math.min(dragStartCol, dragCurrentCol)}ch)`,
              width: `${Math.max(dragStartCol, dragCurrentCol) - Math.min(dragStartCol, dragCurrentCol) + 1}ch`,
              top: 0,
              bottom: 0,
              borderLeft: '1px solid var(--text-primary)',
              borderRight: '1px solid var(--text-primary)',
              pointerEvents: 'none',
              zIndex: 11
            }} />
            <div style={{
              position: 'absolute',
              left: `calc(${maxLabelLen + 2}ch + 10px + ${Math.max(dragStartCol, dragCurrentCol)}ch + 1ch)`,
              top: '50%',
              color: 'var(--bg-primary)',
              backgroundColor: 'var(--text-primary)',
              padding: '2px 8px',
              fontWeight: 'bold',
              pointerEvents: 'none',
              zIndex: 12,
              transform: 'translateY(-50%)'
            }}>
              [zoom_target]
            </div>
          </>
        )}
        {grid.map((row, r) => {
          const label = yLabels[r];
          return (
            <div key={r} style={{ display: 'flex', height: '1em' }}>
              <div style={{ width: `${maxLabelLen + 2}ch`, display: 'flex', justifyContent: 'flex-end', marginRight: '10px', color: 'var(--text-ter)' }}>
                 <span 
                   id={`y-axis-${r}`}
                   data-raw={label}
                   data-hover={format(max - (r * range) / (height - 1))}
                   data-ogcolor={r === startRow ? 'var(--bg-primary)' : r === currentRow ? 'var(--text-primary)' : 'var(--text-ter)'}
                   style={{ 
                    color: r === startRow ? 'var(--bg-primary)' : r === currentRow ? 'var(--text-primary)' : 'inherit',
                    backgroundColor: r === startRow ? 'var(--text-secondary)' : r === currentRow ? 'var(--text-ter)' : 'transparent',
                    padding: '0 2px'
                  }}>
                    {label}
                  </span>
                 <span style={{ marginLeft: '1ch' }}>┤</span>
              </div>
              <span style={{ display: 'flex' }}>
                {row.map((cell, c) => {
                  return (
                    <span 
                      key={c}
                      data-col={c}
                      data-row={r}
                      className={cell.colorClass || 'text-sec'} 
                      style={{ 
                        display: 'inline-block', 
                        width: '1ch', 
                        textAlign: 'center',
                        backgroundColor: 'transparent'
                      }}
                    >
                      {cell.char}
                    </span>
                  );
                })}
              </span>
              {r === currentRow && (
                 <span style={{ 
                   marginLeft: '10px', 
                   color: 'var(--bg-primary)', 
                   backgroundColor: 'var(--text-primary)',
                   padding: '0 4px',
                   display: 'inline-flex',
                   alignItems: 'center'
                 }}>
                   <span style={{ marginRight: '4px' }}>{actualCurrentPrice >= actualStartPrice ? '▲' : '▼'}</span>
                   {format(actualCurrentPrice)}
                 </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Volume Histogram */}
      {volumeData && volumeData.length > 0 && (() => {
        const VOL_HEIGHT = 4;
        const volSlice = volumeData.slice(Math.max(0, volumeData.length - width));
        const dirSlice = volumeDirections ? volumeDirections.slice(Math.max(0, volumeDirections.length - width)) : [];
        const maxVol = Math.max(...volSlice, 1);
        const volStartX = Math.max(0, width - volSlice.length);
        return (
          <div className="vol-panel" style={{ marginTop: '2px', opacity: 0.2, transition: 'opacity 0.15s ease' }}>
            <style>{`.vol-panel:hover { opacity: 1 !important; }`}</style>
            {Array.from({ length: VOL_HEIGHT }).map((_, vr) => (
              <div key={`vol-${vr}`} style={{ display: 'flex', height: '1em' }}>
                <div style={{ width: `${maxLabelLen + 2}ch`, marginRight: '10px', textAlign: 'right' }} className="text-ter">
                  {vr === 0 ? 'vol' : ''}
                  <span style={{ marginLeft: '1ch' }}>{vr === 0 ? '┤' : '│'}</span>
                </div>
                <span style={{ display: 'flex' }}>
                  {Array.from({ length: width }).map((_, vc) => {
                    const dataIdx = vc - volStartX;
                    if (dataIdx < 0 || dataIdx >= volSlice.length) {
                      return <span key={vc} style={{ display: 'inline-block', width: '1ch' }}> </span>;
                    }
                    const vol = volSlice[dataIdx];
                    const barHeight = Math.ceil((vol / maxVol) * VOL_HEIGHT);
                    const threshold = VOL_HEIGHT - vr;
                    const dir = dirSlice[dataIdx] || 'up';
                    const volLabel = vol >= 1e6 ? `${(vol/1e6).toFixed(1)}M` : vol >= 1e3 ? `${(vol/1e3).toFixed(1)}K` : vol.toFixed(1);
                    return (
                      <span 
                        key={vc}
                        className={dir === 'up' ? 'text-up' : 'text-down'}
                        style={{ display: 'inline-block', width: '1ch', textAlign: 'center', cursor: 'default' }}
                        title={`vol: ${volLabel}`}
                      >
                        {barHeight >= threshold ? '█' : ' '}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        );
      })()}
      <div style={{ display: 'flex', marginTop: '4px' }}>
        <span style={{ color: 'transparent', marginRight: '10px' }}>
          {' '.repeat(maxLabelLen)} └
        </span>
        <span style={{ display: 'flex' }}>
          {Array.from({ length: width }).map((_, c) => (
            <span 
              key={`ax-${c}`} 
              className="text-ter" 
              style={{ display: 'inline-block', width: '1ch', textAlign: 'center' }}
            >
              {c === width - 1 ? '┘' : '─'}
            </span>
          ))}
        </span>
      </div>
      {xLabels && xLabels.length > 0 && (
        <div style={{ position: 'relative', display: 'flex', marginTop: '4px' }}>
          <span style={{ color: 'transparent', marginRight: '10px' }}>
            {' '.repeat(maxLabelLen)} └
          </span>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: `${width}ch`, color: 'var(--text-ter)' }}>
             {xLabels.map((lbl, i) => (
               <span key={i}>{lbl}</span>
             ))}
          </div>
          {onZoom && (
            <div 
              id="x-axis-tooltip"
              style={{
                position: 'absolute',
                bottom: 0,
                transform: 'translateX(-50%)',
                backgroundColor: 'var(--text-primary)',
                color: 'var(--bg-primary)',
                padding: '0 8px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                zIndex: 50,
                display: 'none'
              }}
            />
          )}
        </div>
      )}
    </pre>
  );
});
