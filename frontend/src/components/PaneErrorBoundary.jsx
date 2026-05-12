import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, radius, space } = tokens;

class PaneErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (localStorage.getItem('debug_terminal') === '1') {
      console.error('[PaneErrorBoundary]', error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space['2'],
          background: color.base,
          color: color.subtext,
          fontFamily: font.sans,
          padding: space['4'],
        }}>
          <AlertTriangle size={20} strokeWidth={1.5} style={{ color: color.warning || color.peach || '#f9e2af' }} />
          <div style={{ fontSize: fontSize['12'], color: color.text, fontWeight: 600 }}>
            {this.props.fallbackTitle || 'Pane error'}
          </div>
          <div style={{ fontSize: fontSize['11'], color: color.muted, textAlign: 'center', lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected error occurred in this pane.'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: `${space['1']} ${space['2.5']}`,
              background: color.surface0,
              color: color.text,
              border: `1px solid ${color.border}`,
              borderRadius: radius.sm,
              fontSize: fontSize['11'],
              fontFamily: font.sans,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={11} strokeWidth={1.8} />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default PaneErrorBoundary;
