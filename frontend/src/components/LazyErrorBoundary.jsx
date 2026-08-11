import { Component } from 'react';
import { claimChunkReload } from '../utils/chunkReload';

/**
 * Boundary for lazy modals.
 *
 * **One failure must not kill it forever.** The previous version rendered `null` for
 * good once `hasError` was set — and since every modal shares this one boundary, a
 * single 404'd chunk meant that for the rest of the session neither settings nor any
 * confirm dialog would ever appear again (the "clicking settings does nothing" bug).
 * The next open has to try again: changing `resetKey` (i.e. what is open) clears it.
 *
 * A chunk deleted by a deploy is fixed by reloading — the when/whether of that lives
 * in `utils/chunkReload` and is shared with `PaneErrorBoundary`.
 */
class LazyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    if (typeof window === 'undefined') return;
    if (claimChunkReload(error)) window.location.reload();
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    if (prevProps.resetKey === this.props.resetKey) return;
    // Start the next attempt clean so one failure does not set permanently.
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default LazyErrorBoundary;
