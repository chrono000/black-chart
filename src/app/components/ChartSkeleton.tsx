// Low-tech terminal skeleton that occupies the SAME vertical space as <AsciiChart>
// (height grid rows + axis row + labels row), so swapping skeleton → chart on load
// causes no layout shift.
interface Props {
  height?: number;
  width?: number;
  message?: string;
  pulseMessage?: boolean;
}

const GUTTER = 8; // approx y-axis gutter width in ch (horizontal only; height is unaffected)

export function ChartSkeleton({ height = 16, width = 60, message, pulseMessage }: Props) {
  const mid = Math.floor(height / 2);
  return (
    <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 'inherit', lineHeight: '1', letterSpacing: '0px', position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: height }).map((_, r) => (
          <div key={r} style={{ display: 'flex', height: '1em' }}>
            <div style={{ width: `${GUTTER}ch`, marginRight: '10px', textAlign: 'right', color: 'var(--text-ter)' }}>{r === mid ? '┤' : '│'}</div>
            <span style={{ color: 'var(--text-ter)', opacity: r === mid ? 0.5 : 0.16 }}>{(r === mid ? '─' : '·').repeat(width)}</span>
          </div>
        ))}
      </div>
      {/* axis line (mirrors AsciiChart) */}
      <div style={{ display: 'flex', marginTop: '4px' }}>
        <span style={{ width: `${GUTTER}ch`, marginRight: '10px', textAlign: 'right', color: 'var(--text-ter)' }}>└</span>
        <span style={{ color: 'var(--text-ter)', opacity: 0.4 }}>{'─'.repeat(width)}</span>
      </div>
      {/* x-labels row (reserve height) */}
      <div style={{ display: 'flex', marginTop: '4px', height: '1em' }}>
        <span style={{ width: `${GUTTER}ch`, marginRight: '10px' }}> </span>
        <span style={{ color: 'var(--text-ter)', opacity: 0.3 }}> </span>
      </div>
      {message && (
        <div className={pulseMessage ? 'pulse' : ''} style={{ position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {message}
        </div>
      )}
    </pre>
  );
}
