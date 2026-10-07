import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { vi, it, expect, beforeEach } from 'vitest';
import TerminalScrollbar from './TerminalScrollbar';
import TerminalInputPreview from './TerminalInputPreview';
import { buildThemeUI } from '../../styles/themeUI';
import themes from '../../styles/themes';

beforeEach(() => { fetch.mockReset(); });
const setup = (type = 'normal', enabled = true, showInputOnScroll = false, historyKey, tmuxBacked = false) => {
  const listeners = {};
  const sub = (name) => (fn) => { listeners[name] = fn; return { dispose: vi.fn() }; };
  const term = { element: document.createElement('div'), rows: 20,
    buffer: { active: { type, baseY: 100, viewportY: 100, cursorY: 0, cursorX: 2, length: 101,
      getLine: (row) => ({ translateToString: (_, start = 0) => ({ 10: '› 질문 A', 11: '', 40: '› 질문 B', 41: '', 70: '› 질문 C', 71: '', 100: '› ' }[row] ?? 'answer').slice(start) }),
    }, onBufferChange: sub('buffer') },
    scrollToLine: vi.fn((line) => { term.buffer.active.viewportY = line; }),
    onData: sub('data'), onScroll: sub('scroll'), onWriteParsed: sub('write'), onResize: sub('resize') };
  const props = { xtermRef: { current: term }, fitNowRef: { current: vi.fn() },
    scrollLinesRef: { current: null },
    finishViewingRef: { current: null },
    sessionId: 'session', hostId: null, enabled, showInputOnScroll, historyKey, tmuxBacked,
    inputPreviewRef: { current: null }, active: true, ready: true, readOnly: true,
    theme: { background: '#111111', foreground: '#eeeeee', blue: '#123456' }, t: (key) => key };
  const view = render(<TerminalScrollbar {...props} />);
  return { ...view, term, props, listeners };
};

it('view gestures seek tmux history through the API and release their handler on unmount', async () => {
  let offset = 0;
  fetch.mockImplementation(async (_url, options = {}) => ({ ok: true,
    json: async () => ({ available: true, history: 100, rows: 20,
      offset: options.body ? (offset -= JSON.parse(options.body).lines) : offset }) }));
  const { props, unmount } = setup('alternate', true, false, undefined, true);
  await waitFor(() => expect(screen.getByRole('scrollbar')).toBeTruthy());
  act(() => props.scrollLinesRef.current(-12));
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) =>
    options.method === 'POST' && JSON.parse(options.body).lines === -12)).toBe(true));
  act(() => props.scrollLinesRef.current(4));
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) =>
    options.method === 'POST' && JSON.parse(options.body).lines === 4)).toBe(true));
  await waitFor(() => expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuenow', '92'));
  unmount();
  expect(props.scrollLinesRef.current).toBeNull();
});

it('finishes an in-flight seek before returning to live output for input mode', async () => {
  let resolveSeek;
  fetch.mockImplementation(async (_url, options = {}) => {
    const operation = options.body ? JSON.parse(options.body) : {};
    const offset = operation.lines ? -operation.lines : operation.offset || 0;
    if (offset > 0) await new Promise(resolve => { resolveSeek = resolve; });
    return { ok: true, json: async () => ({ available: true, history: 100, rows: 20, offset }) };
  });
  const { props } = setup('alternate', true, false, undefined, true);
  await waitFor(() => expect(screen.getByRole('scrollbar')).toBeTruthy());
  act(() => props.scrollLinesRef.current(-12));
  await waitFor(() => expect(resolveSeek).toBeTypeOf('function'));
  let finished;
  act(() => { finished = props.finishViewingRef.current(); });
  expect(props.finishViewingRef.current()).toBe(finished);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  await act(async () => { resolveSeek(); expect(await finished).toBe(true); });
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')
    .map(([, options]) => { const body = JSON.parse(options.body); return body.lines ?? body.offset; })).toEqual([-12, 0]);
});

it('moves application-owned history without clamping to tmux history or inventing a scrollbar', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({
    available: true, target: 'application', history: 2, offset: 0, rows: 20,
  }) });
  const { props, rerender } = setup('alternate', true, true, undefined, true);
  await act(async () => {});
  expect(screen.queryByRole('scrollbar')).toBeNull();
  act(() => props.scrollLinesRef.current(-12, { col: 7, row: 8 }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    session_id: 'session', host_id: null, lines: -12, col: 7, row: 8, include_input: false,
  });
  expect(screen.queryByRole('scrollbar')).toBeNull();
  rerender(<TerminalScrollbar {...props} readOnly={false} />);
  expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuemax', '2');
});

it('bounds queued relative gestures and serializes them before returning to input mode', async () => {
  const next = { available: true, target: 'application', history: 0, offset: 0, rows: 20 };
  fetch.mockResolvedValue({ ok: true, json: async () => next });
  const { props } = setup('alternate', true, false, undefined, true);
  await act(async () => {});
  let release;
  fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  act(() => props.scrollLinesRef.current(-12));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  for (let i = 0; i < 20; i++) {
    act(() => props.scrollLinesRef.current(-12, { col: 9, row: 10 }));
  }
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
  await act(async () => release({ ok: true, json: async () => next }));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ lines: -48, col: 9, row: 10 });
  await act(async () => expect(await props.finishViewingRef.current()).toBe(true));
  expect(JSON.parse(fetch.mock.calls[3][1].body).offset).toBe(0);
});

it('reports a failed return to live output so the caller can keep input locked', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, history: 100, rows: 20, offset: 12 }) });
  const { props } = setup('alternate', true, false, undefined, true);
  await waitFor(() => expect(screen.getByRole('scrollbar')).toBeTruthy());
  fetch.mockResolvedValue({ ok: false });
  await act(async () => { expect(await props.finishViewingRef.current()).toBe(false); });
});

it('serializes and deduplicates an explicit bottom operation behind application scrolling', async () => {
  const next = { available: true, target: 'application', history: 0, offset: 0, rows: 20 };
  fetch.mockResolvedValue({ ok: true, json: async () => next });
  const { props } = setup('alternate', true, false, undefined, true);
  await act(async () => {});
  let release;
  fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  act(() => props.scrollLinesRef.current(-12));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  let finished;
  act(() => { finished = props.finishViewingRef.current({ toBottom: true }); });
  expect(props.finishViewingRef.current({ toBottom: true })).toBe(finished);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  await act(async () => { release({ ok: true, json: async () => next }); expect(await finished).toBe(true); });
  const bodies = fetch.mock.calls.filter(([, options]) => options.method === 'POST')
    .map(([, options]) => JSON.parse(options.body));
  expect(bodies[0].lines).toBe(-12);
  expect(bodies[1]).toEqual({ session_id: 'session', host_id: null, include_input: false, action: 'bottom' });
  expect(bodies).toHaveLength(2);
});

const luminance = (hex) => {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
};

const contrast = (first, second) => {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

it('scrolls local history with keys without sending terminal input or fetching', () => {
  const { term } = setup();
  fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'PageUp' });
  expect(term.scrollToLine).toHaveBeenCalledWith(80);
  expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuenow', '80');
  fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'End' });
  expect(term.scrollToLine).toHaveBeenLastCalledWith(100);
  expect(fetch).not.toHaveBeenCalled();
});

it('bypasses xterm smooth scrolling while the custom scrollbar seeks directly', () => {
  const { term } = setup();
  term.options = { smoothScrollDuration: 100 };
  const durations = [];
  term.scrollToLine.mockImplementation((line) => {
    durations.push(term.options.smoothScrollDuration);
    term.buffer.active.viewportY = line;
  });

  fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'PageUp' });

  expect(durations).toEqual([0]);
  expect(term.options.smoothScrollDuration).toBe(100);
});

it('hides immediately and restores terminal width when the setting is off', () => {
  const { rerender, props, term } = setup();
  expect(term.element.style.paddingRight).toBe('0px');
  rerender(<TerminalScrollbar {...props} enabled={false} />);
  expect(screen.queryByRole('scrollbar')).toBeNull();
  expect(term.element.style.paddingRight).toBe('0px');
  expect(props.fitNowRef.current).toHaveBeenCalledTimes(2);
});

it('floats a translucent themed thumb over the terminal inside a mobile-sized pointer target', () => {
  const { rerender, props, term, listeners } = setup('normal', true, true);
  const scrollbar = screen.getByRole('scrollbar');
  const rail = scrollbar.querySelector('[aria-hidden="true"]');
  const thumb = rail.firstElementChild;
  expect(scrollbar).toHaveStyle({ width: '24px' });
  expect(rail).toHaveStyle({ width: '8px' });
  expect(rail.style.background).toBe('');
  expect(rail.style.boxShadow).toBe('');
  expect(thumb).toHaveStyle({ left: '2px', right: '2px', background: 'rgba(244, 244, 244, 0.35)' });
  expect(scrollbar).toHaveStyle({ cursor: 'grab' });

  fireEvent.pointerEnter(scrollbar);
  expect(thumb).toHaveStyle({ transform: 'scaleX(1.5)', background: 'rgba(244, 244, 244, 0.55)' });
  fireEvent.pointerLeave(scrollbar);
  expect(thumb).toHaveStyle({ transform: 'scaleX(1)', background: 'rgba(244, 244, 244, 0.35)' });

  rerender(<TerminalScrollbar {...props}
    theme={{ background: '#ffffff', foreground: '#111111', blue: '#abcdef' }} />);
  expect(screen.getByRole('scrollbar')).toBe(scrollbar);
  expect(rail.style.background).toBe('');
  expect(thumb).toHaveStyle({ background: 'rgba(17, 17, 17, 0.35)' });

  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  const region = screen.getByRole('region');
  const dismiss = screen.getByRole('button', { name: 'terminalInputDismiss' });
  expect(region).toHaveStyle({ left: '0px', right: '0px', zIndex: '30' });
  expect(scrollbar).toHaveStyle({ zIndex: '31' });
  expect(dismiss).toHaveStyle({ right: 'calc(28px)' });
  expect(dismiss).toHaveStyle({ minWidth: '24px', minHeight: '24px' });
  fireEvent.focus(dismiss);
  expect(dismiss.style.boxShadow).not.toBe('none');
});

it('scales wheel seeks with the gesture distance instead of moving a fixed three rows', () => {
  const { term } = setup();
  const scrollbar = screen.getByRole('scrollbar');

  fireEvent.wheel(scrollbar, { deltaY: -16, deltaMode: 0 });
  expect(term.scrollToLine).toHaveBeenLastCalledWith(99);

  fireEvent.wheel(scrollbar, { deltaY: -160, deltaMode: 0 });
  expect(term.scrollToLine).toHaveBeenLastCalledWith(89);
});

it('does not send a no-op seek when a drag starts inside the thumb', () => {
  const { term } = setup();
  const scrollbar = screen.getByRole('scrollbar');
  scrollbar.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 24,
    width: 24, height: 100, x: 0, y: 0, toJSON: () => ({}) });
  scrollbar.setPointerCapture = vi.fn();

  fireEvent.pointerDown(scrollbar, { button: 0, clientY: 90, pointerId: 1 });

  expect(term.scrollToLine).not.toHaveBeenCalled();
});

it('keeps the dragged thumb visible across every built-in theme', () => {
  const channelsOf = (hex) => hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16));
  const blend = (front, back, alpha) => channelsOf(front).map((channel, index) => Math.round(
    channel * alpha + channelsOf(back)[index] * (1 - alpha)));
  const toHex = (channels) => `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  for (const [name, theme] of Object.entries(themes)) {
    const themeUi = buildThemeUI(theme);
    const idle = toHex(blend(themeUi.text, theme.background, 0.35));
    const dragged = toHex(blend(themeUi.text, theme.background, 0.75));
    expect(contrast(dragged, theme.background), name).toBeGreaterThanOrEqual(2.5);
    expect(contrast(dragged, idle), name).toBeGreaterThan(1.1);
  }
});

it('does not query tmux when disabled or in an inactive pane', () => {
  const { rerender, props } = setup('alternate', false, false, undefined, true);
  rerender(<TerminalScrollbar {...props} enabled active={false} />);
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps a plain-shell alternate screen local and draws no scrollbar without history', () => {
  const { term, listeners } = setup('alternate', true, true, undefined, false);
  term.buffer.active.baseY = 0;
  term.buffer.active.viewportY = 0;

  act(() => listeners.write());

  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('scrollbar')).toBeNull();
});

it('uses retained tmux history in a normal buffer and serializes rapid seeks', async () => {
  let release;
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, history: 200, offset: 0, rows: 20 }) });
  fetch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20 }) });
  setup('normal', true, false, undefined, true);
  await waitFor(() => expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuemax', '200'));
  const bar = screen.getByRole('scrollbar');
  fireEvent.keyDown(bar, { key: 'PageUp' });
  const firstSeekSignal = fetch.mock.calls[1][1].signal;
  fireEvent.keyDown(bar, { key: 'PageUp' });
  fireEvent.keyDown(bar, { key: 'PageUp' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(firstSeekSignal.aborted).toBe(false);
  await act(async () => release({ ok: true, json: async () => ({ available: true, history: 200, offset: 20, rows: 20 }) }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[2][1].body).offset).toBe(60);
});

it('keeps prompt capture out of drag seeks and restores it for the final offset', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
    available: true, history: 200, offset: 0, rows: 20, input_context: null,
  }) });
  setup('alternate', true, true, undefined, true);
  const bar = await screen.findByRole('scrollbar');
  bar.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 24,
    width: 24, height: 100, x: 0, y: 0, toJSON: () => ({}) });
  bar.setPointerCapture = vi.fn();
  bar.hasPointerCapture = vi.fn(() => true);
  bar.releasePointerCapture = vi.fn();
  let release;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  fetch.mockResolvedValue({ ok: true, json: async () => ({
    available: true, history: 200, offset: 100, rows: 20, input_context: { text: '질문 B' },
  }) });

  fireEvent.pointerDown(bar, { button: 0, clientY: 95, pointerId: 1 });
  fireEvent.pointerMove(bar, { clientY: 50, pointerId: 1 });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const dragBody = JSON.parse(fetch.mock.calls[1][1].body);
  expect(dragBody.include_input).toBe(false);
  fireEvent.lostPointerCapture(bar, { pointerId: 1 });
  await act(async () => release({ ok: true, json: async () => ({
    available: true, history: 200, offset: 100, rows: 20,
  }) }));

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  const finalBody = JSON.parse(fetch.mock.calls[2][1].body);
  expect(finalBody.include_input).toBe(true);
  expect(finalBody.offset).toBe(dragBody.offset);
});

it('coalesces drag moves in one frame to the latest tmux offset', async () => {
  const frames = [];
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancelRaf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  try {
    fetch.mockResolvedValue({ ok: true, json: async () => ({
      available: true, history: 200, offset: 0, rows: 20,
    }) });
    setup('alternate', true, false, undefined, true);
    const bar = await screen.findByRole('scrollbar');
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 24,
      width: 24, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    bar.setPointerCapture = vi.fn();

    fireEvent.pointerDown(bar, { button: 0, clientY: 95, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 40, pointerId: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);

    await act(async () => frames.shift()(performance.now()));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).offset).toBe(121);
  } finally {
    raf.mockRestore();
    cancelRaf.mockRestore();
  }
});

it('hides the scrollbar after an endpoint failure', async () => {
  fetch.mockResolvedValue({ ok: false });
  setup('alternate', true, false, undefined, true);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('scrollbar')).toBeNull();
});

it('selects the question at the viewport top, independently of new input and the scrollbar', () => {
  const { term, props, listeners, rerender } = setup('normal', false, true);
  act(() => { listeners.data('한글 질문'); listeners.data('\r'); });
  expect(screen.queryByRole('region')).toBeNull();
  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  expect(screen.getByRole('region')).toHaveTextContent('질문 B');
  expect(screen.queryByRole('scrollbar')).toBeNull();
  expect(term.element.style.paddingRight).toBe('0px');
  act(() => { term.buffer.active.viewportY = 25; listeners.scroll(); });
  expect(screen.getByRole('region')).toHaveTextContent('질문 A');
  act(() => { term.buffer.active.viewportY = 80; listeners.scroll(); });
  expect(screen.getByRole('region')).toHaveTextContent('질문 C');
  act(() => { term.buffer.active.viewportY = 5; listeners.scroll(); });
  expect(screen.queryByRole('region')).toBeNull();
  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  act(() => { term.buffer.active.viewportY = 100; listeners.scroll(); });
  expect(screen.queryByRole('region')).toBeNull();
  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  rerender(<TerminalScrollbar {...props} showInputOnScroll={false} />);
  expect(screen.queryByRole('region')).toBeNull();
  expect(props.inputPreviewRef.current).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('uses the same tmux request for the preview and scrollbar, and keeps panes isolated', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20, input_context: { text: '질문 B' } }) });
  const { props, rerender } = setup('alternate', true, true, undefined, true);
  act(() => props.inputPreviewRef.current('빠른 입력\r', '빠른 입력'));
  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('질문 B'));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('include_input=true');
  expect(fetch.mock.calls[0][1].cache).toBe('no-store');
  rerender(<TerminalScrollbar {...props} sessionId="another-session" />);
  expect(screen.queryByRole('region')).toBeNull();
});

it('does not keep the preview visible while a pane is inactive or reconnecting', () => {
  const { term, props, listeners, rerender } = setup('normal', true, true);
  act(() => {
    props.inputPreviewRef.current('질문\r', '질문');
    term.buffer.active.viewportY = 50;
    listeners.scroll();
  });
  expect(screen.getByRole('region')).toHaveTextContent('질문 B');
  rerender(<TerminalScrollbar {...props} active={false} />);
  expect(screen.queryByRole('region')).toBeNull();
  rerender(<TerminalScrollbar {...props} ready={false} />);
  expect(screen.queryByRole('region')).toBeNull();
  expect(props.inputPreviewRef.current).toBeNull();
});

it('changes tmux questions as seeks complete and hides the old question while moving', async () => {
  const state = { available: true, history: 200, offset: 30, rows: 20 };
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...state, input_context: { text: '질문 C' } }) });
  const { props, rerender } = setup('alternate', true, true, undefined, true);
  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('질문 C'));
  let release;
  fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'PageUp' });
  expect(screen.queryByRole('region')).toBeNull();
  expect(JSON.parse(fetch.mock.calls[1][1].body).include_input).toBe(true);
  await act(async () => release({ ok: true, json: async () => ({ ...state, offset: 50, input_context: { text: '질문 B' } }) }));
  expect(screen.getByRole('region')).toHaveTextContent('질문 B');
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...state, offset: 0, input_context: null }) });
  fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'End' });
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  rerender(<TerminalScrollbar {...props} showInputOnScroll={false} />);
  expect(props.inputPreviewRef.current).toBeNull();
});

it('rechecks tmux when the last scroll update arrived during an in-flight read', async () => {
  let release;
  fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20,
    input_context: { text: '질문 B' } }) });
  const { listeners } = setup('alternate', false, true, undefined, true);
  act(() => listeners.write());
  await act(async () => release({ ok: true, json: async () => ({ available: true, history: 200, offset: 30, rows: 20,
    input_context: { text: '질문 C' } }) }));
  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('질문 B'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('never persists raw terminal submissions while the preview is enabled', () => {
  const { listeners } = setup('normal', false, true, 'browser-session-private');

  act(() => { listeners.data('hunter2'); listeners.data('\r'); });

  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem('iterm:commandHistory:local:v1:browser-session-private')).toBeNull();
});

it('loads Recent commands once while browsing local history', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ text: '첫 줄\n    둘째 줄', ts: 100 }], hasMore: false }) });
  const { term, listeners, props } = setup('normal', false, true, 'browser-session');
  term.buffer.active.getLine = (row) => ({
    translateToString: () => ({ 10: '› 첫 줄', 11: '  둘째 줄', 12: '', 100: '› ' }[row] ?? 'answer'),
  });
  act(() => { term.buffer.active.viewportY = 30; listeners.scroll(); });
  await waitFor(() => expect(screen.getByRole('region').textContent).toContain('첫 줄\n    둘째 줄'));
  for (const top of [31, 32, 33, 34]) act(() => { term.buffer.active.viewportY = top; listeners.scroll(); });
  const reads = fetch.mock.calls.filter(([, options]) => options.method !== 'POST');
  expect(reads).toHaveLength(1);
  expect(reads[0][0]).toContain('terminal=browser-session');
  expect(props.inputPreviewRef.current).toBeTypeOf('function');
});

it('keeps a slow recurring tmux refresh active in e-ink mode', async () => {
  vi.useFakeTimers();
  document.documentElement.setAttribute('data-eink', '1');
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20,
    input_context: { text: '질문 B' } }) });
  try {
    setup('alternate', false, true, undefined, true);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(7999));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    document.documentElement.removeAttribute('data-eink');
    vi.useRealTimers();
  }
});

it('does not read or write Recent commands through the tmux preview', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20,
    input_context: { text: 'tmux 질문' } }) });
  const { listeners } = setup('alternate', true, true, 'browser-session-tmux', true);
  act(() => { listeners.data('새 질문'); listeners.data('\r'); });
  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('tmux 질문'));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('/api/terminal-scroll?');
  expect(localStorage.getItem('iterm:commandHistory:local:v1:browser-session-tmux')).toBeNull();
});

it('jumps to the visible question with the scrollbar hidden', () => {
  const { term, listeners } = setup('normal', false, true);
  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  fireEvent.click(screen.getByRole('button', { name: /terminalContextInput\s*질문 B/ }));
  expect(term.scrollToLine).toHaveBeenCalledTimes(1);
  expect(term.scrollToLine).toHaveBeenLastCalledWith(40);
  expect(screen.queryByRole('region')).toBeNull();
  act(() => { term.buffer.active.viewportY = 80; listeners.scroll(); });
  expect(screen.getByRole('region')).toHaveTextContent('질문 C');
  expect(fetch).not.toHaveBeenCalled();
});

it('jumps to the physical tmux question offset through the scroll endpoint', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20,
    input_context: { text: '질문 B', offset: 85 } }) });
  setup('alternate', false, true, undefined, true);
  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('질문 B'));
  fireEvent.click(screen.getByRole('button', { name: /terminalContextInput\s*질문 B/ }));
  expect(JSON.parse(fetch.mock.calls[1][1].body).offset).toBe(85);
  await act(async () => {});
});

it('draws an opaque full-width bar that expands independently, dismisses, and resets when the prompt returns', () => {
  const { term, listeners } = setup('normal', false, true);
  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  const region = screen.getByRole('region');
  expect(region).toHaveTextContent('질문 B');
  expect(region).toHaveStyle({ top: '0px', left: '0px', right: '0px' });
  expect(region.style.maxWidth).toBe('');
  expect(region).toHaveStyle({ background: 'rgb(41, 41, 41)' });
  expect(region.style.backdropFilter).toBe('');
  expect(term.element.style.clipPath).toBe('inset(0px 0 0 0)');

  const expand = screen.getByRole('button', { name: 'terminalInputExpand' });
  fireEvent.click(expand);
  expect(expand).toHaveAttribute('aria-expanded', 'true');
  expect(term.scrollToLine).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'terminalInputCollapse' }));

  fireEvent.click(screen.getByRole('button', { name: 'terminalInputDismiss' }));
  expect(screen.queryByRole('region')).toBeNull();

  act(() => { term.buffer.active.viewportY = 80; listeners.scroll(); });
  expect(screen.getByRole('region')).toHaveTextContent('질문 C');

  act(() => { term.buffer.active.viewportY = 100; listeners.scroll(); });
  expect(screen.queryByRole('region')).toBeNull();
  expect(term.element.style.clipPath).toBe('');

  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  expect(screen.getByRole('region')).toHaveTextContent('질문 B');
});

it('shows the same prompt again when its physical offset changes after dismissal', async () => {
  fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, history: 200, offset: 60, rows: 20,
      input_context: { text: '반복 질문', offset: 100 } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, history: 200, offset: 80, rows: 20,
      input_context: { text: '반복 질문', offset: 120 } }) });
  setup('alternate', true, true, undefined, true);
  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('반복 질문'));
  fireEvent.click(screen.getByRole('button', { name: 'terminalInputDismiss' }));
  expect(screen.queryByRole('region')).toBeNull();

  fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'PageUp' });

  await waitFor(() => expect(screen.getByRole('region')).toHaveTextContent('반복 질문'));
});

it('keys dismissal by prompt offset even when the prompt text is identical', () => {
  const term = {
    buffer: { active: { baseY: 0, cursorY: 0, cursorX: 0 } },
    onData: () => ({ dispose: vi.fn() }),
  };
  const props = {
    xtermRef: { current: term }, inputPreviewRef: { current: null }, ready: true,
    active: true, scrolled: true, scrollbar: false,
    theme: { background: '#111111', foreground: '#eeeeee' }, t: (key) => key,
    sessionId: 'session', onJump: vi.fn(),
  };
  const view = render(<TerminalInputPreview {...props}
    context={{ text: '반복 질문', offset: 100 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'terminalInputDismiss' }));
  expect(screen.queryByRole('region')).toBeNull();

  view.rerender(<TerminalInputPreview {...props}
    context={{ text: '반복 질문', offset: 120 }} />);

  expect(screen.getByRole('region')).toHaveTextContent('반복 질문');
});
