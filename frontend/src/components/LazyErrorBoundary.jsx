import { Component } from 'react';
import { tokens } from '../styles/tokens';

const { font, color, fontSize } = tokens;

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
      if (typeof window !== 'undefined') window.location.reload();
      return;
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export default LazyErrorBoundary;
