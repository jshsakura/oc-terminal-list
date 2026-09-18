import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import useScrollCommandHistory from './useScrollCommandHistory';
import { COMMAND_HISTORY_EVENT, pushLocalCommand } from '../../utils/commandHistory';

beforeEach(() => { fetch.mockReset(); });

it('reads the same local recovery entries when the history server is offline', async () => {
  pushLocalCommand('local-session', '첫 줄\n  둘째 줄');
  fetch.mockRejectedValue(new Error('offline'));
  const change = vi.fn();
  renderHook(() => useScrollCommandHistory('local-session', true, change));
  await waitFor(() => expect(change).toHaveBeenLastCalledWith([
    expect.objectContaining({ text: '첫 줄\n  둘째 줄', source: 'local' }),
  ]));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('terminal=local-session');
});

it('does not refetch on rerenders or unrelated history updates', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [], hasMore: false }) });
  const change = vi.fn();
  const { rerender } = renderHook(() => useScrollCommandHistory('pane-a', true, change));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  rerender();
  act(() => window.dispatchEvent(new CustomEvent(COMMAND_HISTORY_EVENT, { detail: { terminalKey: 'pane-b' } })));
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => {
    window.dispatchEvent(new CustomEvent(COMMAND_HISTORY_EVENT, { detail: { terminalKey: 'pane-a' } }));
    window.dispatchEvent(new CustomEvent(COMMAND_HISTORY_EVENT, { detail: { terminalKey: 'pane-a' } }));
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

it('aborts and ignores the old pane request after changing panes or disabling', async () => {
  let release;
  fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ text: 'pane B question', ts: 10 }] }) });
  const change = vi.fn();
  const { rerender } = renderHook(({ terminalKey, enabled }) => useScrollCommandHistory(terminalKey, enabled, change),
    { initialProps: { terminalKey: 'pane-a', enabled: true } });
  const signal = fetch.mock.calls[0][1].signal;
  rerender({ terminalKey: 'pane-b', enabled: true });
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(change).toHaveBeenLastCalledWith([{ text: 'pane B question', ts: 10, source: undefined }]));
  await act(async () => release({ ok: true, json: async () => ({ items: [{ text: 'pane A question', ts: 20 }] }) }));
  expect(change).toHaveBeenLastCalledWith([{ text: 'pane B question', ts: 10, source: undefined }]);
  rerender({ terminalKey: 'pane-b', enabled: false });
  expect(change).toHaveBeenLastCalledWith([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not load history when disabled', () => {
  renderHook(() => useScrollCommandHistory('pane-a', false, vi.fn()));
  expect(fetch).not.toHaveBeenCalled();
});
