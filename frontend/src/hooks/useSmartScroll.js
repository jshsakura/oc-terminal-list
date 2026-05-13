/**
 * useSmartScroll hook
 * xterm.js buffer-aware smart scroll management
 *
 * Uses xterm buffer API (viewportY, length, rows) instead of DOM scrollTop
 * to correctly detect scroll position within the terminal viewport.
 *
 * Modes:
 * - 'always': scrollToBottom on every new data write
 * - 'smart':  xterm's native behavior (stays at bottom if at bottom,
 *             doesn't force-scroll if user scrolled up)
 * - 'never':  never auto-scroll
 *
 * Why not DOM scrollTop:
 *   The outer container div has overflow:hidden. Actual scrolling lives inside
 *   xterm's viewport/buffer. Reading containerRef.scrollTop always returns 0,
 *   so the old DOM-based isNearBottom() always returned true, causing every
 *   new-data callback to force scrollToBottom — snapping users back down.
 */
import { useRef, useCallback } from 'react';

export const useSmartScroll = (xtermRef, options = {}) => {
  const {
    autoScroll = 'smart', // 'always' | 'smart' | 'never'
  } = options;

  const userScrolledUpRef = useRef(false);

  // Check whether the xterm viewport is at/near the bottom of the buffer.
  // Uses xterm buffer API: viewportY is the row index of the first visible line.
  // At bottom: viewportY >= length - rows
  const isNearBottom = useCallback(() => {
    const term = xtermRef?.current;
    if (!term) return true;
    const buf = term.buffer?.active;
    if (!buf) return true;
    const maxY = Math.max(0, buf.length - term.rows);
    return buf.viewportY >= maxY;
  }, []);

  // Called from term.onScroll(). Tracks whether user has scrolled up
  // so that handleNewData can decide whether to force-scroll to bottom.
  const handleUserScroll = useCallback(() => {
    userScrolledUpRef.current = !isNearBottom();
  }, [isNearBottom]);

  // Called after term.write() completes. For 'always' mode, forces
  // scrollToBottom. For 'smart' and 'never', xterm handles natively
  // (stays at bottom if already there, doesn't force-scroll if user
  // scrolled up).
  const handleNewData = useCallback(() => {
    if (autoScroll === 'always') {
      xtermRef?.current?.scrollToBottom();
    }
    // 'smart' and 'never': no forced scrollToBottom — xterm handles natively
  }, [autoScroll, xtermRef]);

  // Force scroll to bottom and re-enable auto-scroll
  const forceScrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    xtermRef?.current?.scrollToBottom();
  }, [xtermRef]);

  return {
    handleUserScroll,
    handleNewData,
    forceScrollToBottom,
    isNearBottom,
    userScrolledUpRef,
  };
};

export default useSmartScroll;
