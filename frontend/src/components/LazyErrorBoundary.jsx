import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, radius, space } = tokens;

class LazyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    const msg = error?.message || '';
    if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('Loading chunk')) {
      console.warn('[LazyErrorBoundary] stale chunk detected, reloading...');
      setTimeout(() => {
        if (typeof window !== 'undefined') window.location.reload();
      }, 800);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space['2'],
          padding: space['4'],
          fontFamily: font.sans,
        }}>
          <AlertTriangle size={16} strokeWidth={1.5} style={{ color: color.peach || '#fab387' }} />
          <span style={{ fontSize: fontSize['11'], color: color.muted }}>Reloading…</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export default LazyErrorBoundary;
