import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { authHeaders } from '../../utils/auth';
import { einkPollMs } from '../../utils/einkMode';
import { buildThemeUI, withAlpha } from '../../styles/themeUI';
import tokens from '../../styles/tokens';
import TerminalInputPreview from './TerminalInputPreview';
import { readTerminalPromptContext } from './terminalPromptContext';
import useScrollCommandHistory from './useScrollCommandHistory';
import restoreLiveOutput from './restoreLiveOutput';

export const TERMINAL_SCROLLBAR_WIDTH = tokens.space['2'];
export const TERMINAL_SCROLLBAR_HIT_WIDTH = tokens.space['6'];
const EMPTY = { available: false, history: 0, offset: 0, rows: 1 };

// The browser has scrollback for a plain shell. tmux owns its own history, so
// its scrollbar reads and seeks copy-mode through an authenticated endpoint.
export default function TerminalScrollbar({ xtermRef, fitNowRef, sessionId, hostId,
  enabled, active, ready, theme, t, showInputOnScroll = false, inputPreviewRef, historyKey,
  tmuxBacked = true, readOnly = false, scrollLinesRef, finishViewingRef, onHistorySeek }) {
  const viewportId = useId();
  const [state, setState] = useState(EMPTY);
  const stateRef = useRef(state);
  const actions = useRef({});
  const commandHistory = useRef([]);
  const drag = useRef(null);
  const track = useRef(null);
  const [jumpedOffset, setJumpedOffset] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const themeUi = buildThemeUI(theme);

  useScrollCommandHistory(historyKey, showInputOnScroll && active && ready && state.offset > 0
    && !tmuxBacked, (items) => {
    commandHistory.current = items;
    if (!tmuxBacked) actions.current.refresh?.();
  });

  useLayoutEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.element.id = viewportId;
    term.element.style.paddingRight = '0px';
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
    let requestFrame = null;
    let gestureTimer = null;
    let lastRead = 0;
    let controller = null;
    let mutationInFlight = false;
    let refreshPending = false;
    let gestureUntil = 0;
    let finishRequest = null;
    const finish = (success) => {
      if (!finishRequest) return;
      clearTimeout(finishRequest.timer);
      finishRequest.resolve(success);
      finishRequest = null;
    };
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
      const operation = pending;
      pending = null;
      const offset = operation?.offset ?? null;
      const lines = operation?.lines ?? null;
      const action = operation?.action ?? null;
      const includeInput = operation?.includeInput ?? showInputOnScroll;
      mutationInFlight = operation !== null;
      const ctl = new AbortController();
      controller = ctl;
      const timeout = setTimeout(() => ctl.abort(), 6000);
      let restored = false;
      try {
        const res = await fetch(`/api/terminal-scroll?${params}`, {
          method: operation === null ? 'GET' : 'POST',
          cache: 'no-store',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          signal: ctl.signal,
          ...(operation === null ? {} : { body: JSON.stringify({
            session_id: sessionId, host_id: hostId || null, include_input: includeInput,
            ...(action === 'bottom' ? { action } : lines === null ? { offset } : { lines, col: operation.col, row: operation.row }),
          }) }),
        });
        if (!res.ok) throw new Error('Scroll request failed');
        const next = await res.json();
        restored = next.available === true && next.offset === 0;
        if (!usesTmux()) localState();
        else if (pending === null) publish(next.available ? next : EMPTY);
      } catch {
        // An aborted read yields to a seek waiting in `pending`; keep the
        // optimistic offset instead of flashing the "no history" fallback.
        if (!disposed && !ctl.signal.aborted) publish(EMPTY);
      } finally {
        clearTimeout(timeout);
        controller = null;
        mutationInFlight = false;
        busy = false;
        lastRead = Date.now();
        if ((offset === 0 || action === 'bottom') && pending === null) { finish(restored); }
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
    const scrollLocalToLine = (line) => {
      const duration = term.options?.smoothScrollDuration;
      if (!duration) { term.scrollToLine(line); return; }
      term.options.smoothScrollDuration = 0;
      try { term.scrollToLine(line); } finally { term.options.smoothScrollDuration = duration; }
    };
    const scheduleRequest = (defer) => {
      if (!defer || busy) {
        if (requestFrame !== null) {
          cancelAnimationFrame(requestFrame);
          requestFrame = null;
        }
        request();
        return;
      }
      if (requestFrame !== null) return;
      requestFrame = requestAnimationFrame(() => {
        requestFrame = null;
        request();
      });
    };
    const seek = (offset, { includeInput = showInputOnScroll, defer = false, action = null } = {}) => {
      const history = stateRef.current.history;
      const bounded = Math.max(0, Math.min(history, Math.round(offset)));
      if (bounded > 0) onHistorySeek?.();
      if (!usesTmux()) {
        scrollLocalToLine(history - bounded);
        localState();
      } else {
        pending = action === 'bottom' ? { action, includeInput } : { offset: bounded, includeInput };
        // A drag is a gesture: poll fast afterwards. A read-only refresh can
        // yield immediately, but a seek must finish before the latest target
        // starts because aborting HTTP does not cancel the server-side tmux command.
        gestureUntil = Date.now() + 1000;
        publish({ ...stateRef.current, offset: bounded, input_context: null });
        if (busy && !mutationInFlight) controller?.abort();
        scheduleRequest(defer);
      }
    };
    const settleGesture = () => {
      if (!showInputOnScroll || !usesTmux() || stateRef.current.target === 'application') { return; }
      clearTimeout(gestureTimer);
      gestureTimer = setTimeout(() => {
        gestureTimer = null;
        refresh();
      }, 120);
    };
    actions.current = { seek, refresh, settleGesture };
    if (scrollLinesRef) {
      scrollLinesRef.current = (lines, { col = 1, row = 1 } = {}) => {
        if (!Number.isFinite(lines) || lines === 0 || finishRequest) { return; }
        if (!usesTmux()) {
          seek(stateRef.current.offset - lines);
          return;
        }
        const movement = Math.max(-48, Math.min(48, Math.trunc((pending?.lines || 0) + lines)));
        pending = movement ? { lines: movement, col, row, includeInput: false } : null;
        onHistorySeek?.();
        gestureUntil = Date.now() + 1000;
        if (stateRef.current.target !== 'application') {
          publish({ ...stateRef.current, offset: Math.max(0, Math.min(stateRef.current.history,
            stateRef.current.offset - lines)), input_context: null });
        }
        if (busy && !mutationInFlight) { controller?.abort(); }
        scheduleRequest(true);
        settleGesture();
      };
    }
    if (finishViewingRef) { finishViewingRef.current = ({ toBottom = false } = {}) => {
      if (!usesTmux()) { term.scrollToBottom(); return Promise.resolve(true); }
      // Serialize the return behind any seek already running on the server.
      clearTimeout(gestureTimer);
      if (finishRequest) return finishRequest.promise;
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      finishRequest = { resolve, promise, timer: setTimeout(() => finish(false), 6500) };
      seek(0, { action: toBottom ? 'bottom' : null, includeInput: false });
      return promise;
    }; }
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
      if (scrollLinesRef) scrollLinesRef.current = null;
      finish(false);
      if (finishViewingRef) { finishViewingRef.current = (options) => usesTmux()
        ? restoreLiveOutput(sessionId, hostId, options) : true; }
      clearTimeout(timer);
      clearTimeout(gestureTimer);
      if (requestFrame !== null) cancelAnimationFrame(requestFrame);
      controller?.abort();
      subscriptions.forEach((subscription) => subscription.dispose());
      document.removeEventListener('visibilitychange', refresh);
      gestureRoot.removeEventListener('wheel', onGesture);
      gestureRoot.removeEventListener('touchmove', onGesture);
    };
  }, [enabled, showInputOnScroll, active, ready, sessionId, hostId, xtermRef, tmuxBacked, scrollLinesRef, finishViewingRef, onHistorySeek]);

  if (!enabled && !showInputOnScroll) return null;
  const scrollable = ready && state.available && (!readOnly || state.target !== 'application') && state.history > 0;
  const fraction = Math.min(1, Math.max(0.08, state.rows / (state.history + state.rows)));
  const progress = state.history ? 1 - state.offset / state.history : 1;
  const seekAt = (clientY, grab = fraction / 2, options) => {
    const rect = track.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, ((clientY - rect.top) / rect.height - grab) / (1 - fraction)));
    actions.current.seek?.((1 - ratio) * state.history, options);
  };
  const finishDrag = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    setDragging(false);
    if (moved && tmuxBacked && showInputOnScroll) {
      actions.current.seek?.(stateRef.current.offset, { includeInput: true });
    }
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
    {enabled && scrollable && <div
      ref={track}
      role="scrollbar"
      aria-label={t('showTerminalScrollbar')}
      aria-controls={viewportId}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={state.history}
      aria-valuenow={Math.max(0, state.history - state.offset)}
      tabIndex={0}
      title={t('showTerminalScrollbarHint')}
      onPointerEnter={() => { setHovered(true); actions.current.refresh?.(); }}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(event) => {
        if (!scrollable || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const y = (event.clientY - rect.top) / rect.height;
        const top = progress * (1 - fraction);
        const grabbedThumb = y >= top && y <= top + fraction;
        drag.current = { grab: grabbedThumb ? y - top : fraction / 2, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        if (!grabbedThumb) seekAt(event.clientY, drag.current.grab);
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        drag.current.moved = true;
        seekAt(event.clientY, drag.current.grab, { includeInput: false, defer: true });
      }}
      onPointerUp={(event) => {
        finishDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={finishDrag}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        if (!scrollable || event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const magnitude = Math.abs(event.deltaY);
        const rows = event.deltaMode === 2
          ? state.rows
          : event.deltaMode === 1
            ? Math.max(1, Math.round(magnitude))
            : Math.max(1, Math.round(magnitude / 16));
        const distance = Math.min(state.rows, rows);
        actions.current.seek?.(stateRef.current.offset + (event.deltaY < 0 ? distance : -distance),
          { includeInput: false, defer: true });
        actions.current.settleGesture?.();
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
        cursor: dragging ? 'grabbing' : 'grab' }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, bottom: 0,
        width: TERMINAL_SCROLLBAR_WIDTH, pointerEvents: 'none' }}>
        <div className="tl-scrollbar-thumb" style={{ position: 'absolute', left: tokens.space['0.5'], right: tokens.space['0.5'],
          top: `${progress * (1 - fraction) * 100}%`, height: `${fraction * 100}%`,
          borderRadius: tokens.radius.full, transformOrigin: 'center',
          transform: `scaleX(${dragging ? 2 : hovered ? 1.5 : 1})`,
          transition: `transform ${tokens.motion.fast}, background-color ${tokens.motion.fast}`,
          background: withAlpha(themeUi.text, dragging ? 0.8 : hovered ? 0.55 : scrollable ? 0.35 : 0.15) }} />
      </div>
    </div>}
    </>
  );
}
