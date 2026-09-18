import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { vi, it, expect, beforeEach } from 'vitest';
import TerminalScrollbar from './TerminalScrollbar';

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
    sessionId: 'session', hostId: null, enabled, showInputOnScroll, historyKey, tmuxBacked,
    inputPreviewRef: { current: null }, active: true, ready: true,
    theme: { background: '#111', foreground: '#eee' }, t: (key) => key };
  const view = render(<TerminalScrollbar {...props} />);
  return { ...view, term, props, listeners };
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

it('hides immediately and restores terminal width when the setting is off', () => {
  const { rerender, props, term } = setup();
  expect(term.element.style.paddingRight).toBe('16px');
  rerender(<TerminalScrollbar {...props} enabled={false} />);
  expect(screen.queryByRole('scrollbar')).toBeNull();
  expect(term.element.style.paddingRight).toBe('0px');
  expect(props.fitNowRef.current).toHaveBeenCalledTimes(2);
});

it('keeps compact visuals inside mobile-sized pointer targets', () => {
  const { term, listeners } = setup('normal', true, true);
  const scrollbar = screen.getByRole('scrollbar');
  expect(scrollbar).toHaveStyle({ width: '24px' });
  expect(scrollbar.querySelector('[aria-hidden="true"]')).toHaveStyle({ width: '16px' });

  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  const toggle = screen.getByRole('button', { name: 'terminalInputExpand' });
  expect(toggle).toHaveStyle({ minWidth: '24px', minHeight: '24px' });
  fireEvent.focus(toggle);
  expect(toggle.style.boxShadow).not.toBe('none');
});

it('does not query tmux when disabled or in an inactive pane', () => {
  const { rerender, props } = setup('alternate', false, false, undefined, true);
  rerender(<TerminalScrollbar {...props} enabled active={false} />);
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps a plain-shell alternate screen local instead of querying tmux', () => {
  const { term, listeners } = setup('alternate', true, true, undefined, false);
  term.buffer.active.baseY = 0;
  term.buffer.active.viewportY = 0;

  act(() => listeners.write());

  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-disabled', 'true');
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
  fireEvent.keyDown(bar, { key: 'PageUp' });
  fireEvent.keyDown(bar, { key: 'PageUp' });
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => release({ ok: true, json: async () => ({ available: true, history: 200, offset: 20, rows: 20 }) }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[2][1].body).offset).toBe(60);
});

it('disables history controls after an endpoint failure', async () => {
  fetch.mockResolvedValue({ ok: false });
  setup('alternate', true, false, undefined, true);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-disabled', 'true');
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
  fireEvent.click(screen.getByRole('button', { name: /terminalInputExpand|terminalInputCollapse/ }));
  expect(screen.getByRole('button', { name: /terminalInputExpand|terminalInputCollapse/ })).toHaveAttribute('aria-expanded', 'true');
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

it('jumps to the visible question with the scrollbar hidden and leaves expansion independent', () => {
  const { term, listeners } = setup('normal', false, true);
  act(() => { term.buffer.active.viewportY = 50; listeners.scroll(); });
  fireEvent.click(screen.getByRole('button', { name: 'terminalInputExpand' }));
  expect(term.scrollToLine).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /terminalContextInput 질문 B/ }));
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
  fireEvent.click(screen.getByRole('button', { name: /terminalContextInput 질문 B/ }));
  expect(JSON.parse(fetch.mock.calls[1][1].body).offset).toBe(85);
  await act(async () => {});
});
