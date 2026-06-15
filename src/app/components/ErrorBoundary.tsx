import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  hasError: boolean;
  message: string;
}

// Terminal-styled error boundary so a single render throw degrades to a
// recoverable panel instead of blanking the whole app (important mid-trade).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[black-chart] render error', err, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '30px 20px', fontFamily: 'var(--font-family)' }}>
          <div className="text-down" style={{ fontWeight: 'bold' }}>
            ! component error{this.props.label ? ` :: ${this.props.label}` : ''}
          </div>
          <div className="text-ter" style={{ margin: '8px 0', wordBreak: 'break-all' }}>{this.state.message}</div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button onClick={() => this.setState({ hasError: false, message: '' })}>[retry]</button>
            <button onClick={() => { window.location.href = '/'; }}>[home]</button>
            <button onClick={() => window.location.reload()}>[reload]</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
