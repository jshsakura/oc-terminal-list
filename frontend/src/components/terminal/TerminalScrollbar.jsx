import { useEffect, useId, useRef, useState } from 'react';
import { authHeaders } from '../../utils/auth';
import { einkPollMs } from '../../utils/einkMode';
import { buildThemeUI } from '../../styles/themeUI';
import tokens from '../../styles/tokens';
import TerminalInputPreview from './TerminalInputPreview';
import { readTerminalPromptContext } from './terminalPromptContext';
import useScrollCommandHistory from './useScrollCommandHistory';

export const TERMINAL_SCROLLBAR_WIDTH = tokens.space['4'];
export const TERMINAL_SCROLLBAR_HIT_WIDTH = tokens.space['6'];
const EMPTY = { available: false, history: 0, offset: 0, rows: 1 };

// The browser has scrollback for a plain shell. tmux owns its own history, so
// its scrollbar reads and seeks copy-mode through an authenticated endpoint.
export default function TerminalScrollbar({ xtermRef, fitNowRef, sessionId, hostId,
  enabled, active, ready, theme, t, showInputOnScroll = false, inputPreviewRef, historyKey,
  tmuxBacked = true }) {
  const viewportId = useId();
  const [state, setState] = useState(EMPTY);
  const stateRef = useRef(state);
  const actions = useRef({});
  const commandHistory = useRef([]);
  const drag = useRef(null);
  const track = useRef(null);
  const [jumpedOffset, setJumpedOffset] = useState(null);
  const [dragging, setDragging] = useState(false);
  const themeUi = buildThemeUI(theme);

  useScrollCommandHistory(historyKey, showInputOnScroll && active && ready && state.offset > 0
    && !tmuxBacked, (items) => {
    commandHistory.current = items;
    if (!tmuxBacked) actions.current.refresh?.();
  });

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.element.id = viewportId;
    term.element.style.paddingRight = enabled ? TERMINAL_SCROLLBAR_WIDTH : '0px';
    term.element.style.boxSizing = 'border-box';
    fitNowRef.current?.();
  }, [enabled, ready, xtermRef, fitNowRef, viewportId]);

  useEffect(() => {
    const term = xtermRef.current;
    stateRef.current = EMPTY;
    setState(EMPTY);
    setJumpedOffset(null);
    if ((!enabled && !showInputOnScroll) || !active || !ready || !term) return;
    let disposed = false;
    let busy = false;
    let pending = null;
    let timer = null;
    let lastRead = 0;
    let controller = null;
    let refreshPending = false;
    let gestureUntil = 0;
    const usesTmux = () => tmuxBacked;
    const params = new URLSearchParams({ session_id: sessionId || '' });
    if (hostId) params.set('host_id', hostId);
    if (showInputOnScroll) params.set('include_input', 'true');
    const publish = (next) => {
      if (disposed) return;
      stateRef.current = next;
      setState(next);
    };
    const localState = () => {
      const buf = term.buffer.active;
      publish({ available: true, history: buf.baseY,
        offset: Math.max(0, buf.baseY - buf.viewportY), rows: term.rows,
        input_context: showInputOnScroll ? readTerminalPromptContext(term, commandHistory.current) : null });
    };
    const request = async () => {
      if (disposed || busy || document.hidden) return;
      if (!usesTmux()) { pending = null; localState(); return; }
      if (!sessionId) { publish(EMPTY); return; }
      busy = true;
      const offset = pending;
      pending = null;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 6000);
      try {
        const res = await fetch(`/api/terminal-scroll?${params}`, {
          method: offset === null ? 'GET' : 'POST',
          cache: 'no-store',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          signal: controller.signal,
          ...(offset === null ? {} : { body: JSON.stringify({
            session_id: sessionId, host_id: hostId || null, offset, include_input: showInputOnScroll,
          }) }),
        });
        if (!res.ok) throw new Error('Scroll request failed');
        const next = await res.json();
        if (!usesTmux()) localState();
        else if (pending === null) publish(next.available ? next : EMPTY);
      } catch {
        if (!disposed) publish(EMPTY);
      } finally {
        clearTimeout(timeout);
        controller = null;
        busy = false;
        lastRead = Date.now();
        // Keep at most one seek in flight. Dragging replaces the queued target
        // rather than accumulating commands behind a slow SSH connection.
        if (!disposed && pending !== null) request();
        else if (!disposed && refreshPending) { refreshPending = false; request(); }
        // A quiet tmux pane can change without emitting an xterm event (for example,
        // while viewing copy-mode history). Keep one slow background read armed.
        else if (!disposed) refresh();
      }
    };
    const refresh = () => {
      if (!usesTmux()) { localState(); return; }
      if (document.hidden || timer) return;
      // The last wheel update may arrive during the read. Schedule a follow-up
      // instead of leaving context stuck at the previous viewport indefinitely.
      if (busy) { refreshPending = true; return; }
      const gestureActive = Date.now() < gestureUntil;
      const baseInterval = gestureActive && showInputOnScroll ? 250 : 2000;
      const interval = gestureActive ? baseInterval : einkPollMs(baseInterval);
      timer = setTimeout(() => { timer = null; request(); }, Math.max(0, interval - (Date.now() - lastRead)));
    };
    const seek = (offset) => {
      const history = stateRef.current.history;
      const bounded = Math.max(0, Math.min(history, Math.round(offset)));
      if (!usesTmux()) {
        term.scrollToLine(history - bounded);
        localState();
      } else {
        pending = bounded;
        publish({ ...stateRef.current, offset: bounded, input_context: null });
        request();
      }
    };
    actions.current = { seek, refresh };
    const subscriptions = [term.onScroll(refresh), term.onWriteParsed(refresh), term.onResize(refresh),
      term.buffer.onBufferChange(refresh)];
    const gestureRoot = term.element.parentElement || term.element;
    const onGesture = () => {
      if (!showInputOnScroll || !usesTmux()) return;
      gestureUntil = Date.now() + 1000;
      clearTimeout(timer);
      timer = null;
      refresh();
    };
    gestureRoot.addEventListener('wheel', onGesture, { passive: true });
    gestureRoot.addEventListener('touchmove', onGesture, { passive: true });
    document.addEventListener('visibilitychange', refresh);
    request();
    return () => {
      disposed = true;
      actions.current = {};
      clearTimeout(timer);
      controller?.abort();
      subscriptions.forEach((subscription) => subscription.dispose());
      document.removeEventListener('visibilitychange', refresh);
      gestureRoot.removeEventListener('wheel', onGesture);
      gestureRoot.removeEventListener('touchmove', onGesture);
    };
  }, [enabled, showInputOnScroll, active, ready, sessionId, hostId, xtermRef, tmuxBacked]);

  if (!enabled && !showInputOnScroll) return null;
  const scrollable = ready && state.available && state.history > 0;
  const fraction = Math.min(1, Math.max(0.08, state.rows / (state.history + state.rows)));
  const progress = state.history ? 1 - state.offset / state.history : 1;
  const seekAt = (clientY, grab = fraction / 2) => {
    const rect = track.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, ((clientY - rect.top) / rect.height - grab) / (1 - fraction)));
    actions.current.seek?.((1 - ratio) * state.history);
  };
  return (
    <>
    {showInputOnScroll && <TerminalInputPreview key={`${hostId || ''}:${sessionId || ''}`}
      xtermRef={xtermRef} inputPreviewRef={inputPreviewRef} ready={ready} active={active}
      sessionId={sessionId} scrolled={state.available && state.offset > 0 && state.offset !== jumpedOffset}
      context={state.input_context}
      onJump={() => {
        const context = !tmuxBacked
          ? readTerminalPromptContext(xtermRef.current, commandHistory.current) : stateRef.current.input_context;
        if (!Number.isFinite(context?.offset)) return;
        setJumpedOffset(context.offset);
        actions.current.seek?.(context.offset);
      }}
      scrollbar={enabled} theme={theme} t={t} />}
    {enabled && <div
      ref={track}
      role="scrollbar"
      aria-label={t('showTerminalScrollbar')}
      aria-controls={viewportId}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={state.history}
      aria-valuenow={Math.max(0, state.history - state.offset)}
      aria-disabled={!scrollable}
      tabIndex={scrollable ? 0 : -1}
      title={state.available ? t('showTerminalScrollbarHint') : t('terminalScrollUnavailable')}
      onPointerEnter={() => actions.current.refresh?.()}
      onPointerDown={(event) => {
        if (!scrollable || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const y = (event.clientY - rect.top) / rect.height;
        const top = progress * (1 - fraction);
        drag.current = y >= top && y <= top + fraction ? y - top : fraction / 2;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekAt(event.clientY, drag.current);
      }}
      onPointerMove={(event) => { if (drag.current !== null) seekAt(event.clientY, drag.current); }}
      onPointerUp={(event) => {
        drag.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        if (!scrollable) return;
        event.stopPropagation();
        actions.current.seek?.(state.offset + (event.deltaY < 0 ? 3 : -3));
      }}
      onKeyDown={(event) => {
        if (!scrollable) return;
        const targets = { ArrowUp: state.offset + 1, ArrowDown: state.offset - 1,
          PageUp: state.offset + state.rows, PageDown: state.offset - state.rows,
          Home: state.history, End: 0 };
        if (!(event.key in targets)) return;
        event.preventDefault();
        event.stopPropagation();
        actions.current.seek?.(targets[event.key]);
      }}
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: TERMINAL_SCROLLBAR_HIT_WIDTH,
        zIndex: tokens.z.terminalScrollbar, background: 'transparent', touchAction: 'none', userSelect: 'none',
        cursor: scrollable ? 'pointer' : 'default' }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, bottom: 0,
        width: TERMINAL_SCROLLBAR_WIDTH, background: theme.background, pointerEvents: 'none',
        borderLeft: `1px solid ${themeUi['border-strong']}` }}>
        <div style={{ position: 'absolute', left: tokens.space['0.5'], right: tokens.space['0.5'],
          top: `${progress * (1 - fraction) * 100}%`, height: `${fraction * 100}%`,
          borderRadius: tokens.radius.full,
          background: dragging ? themeUi.subtext : scrollable ? themeUi.muted : themeUi.faint }} />
      </div>
    </div>}
    </>
  );
}
