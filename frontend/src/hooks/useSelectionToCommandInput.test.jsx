import { useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useSelectionToCommandInput, { SELECTION_TO_COMMAND_INPUT_EVENT } from './useSelectionToCommandInput';

afterEach(cleanup);
const selected = { text: '  선택한 원문\n두 번째 줄  ', tabId: 'tab-2', paneId: 'pane-2', sessionId: 'session-2' };
const dispatch = (detail = selected) => window.dispatchEvent(new CustomEvent(SELECTION_TO_COMMAND_INPUT_EVENT, { detail }));
const setup = (initial = '', overrides = {}) => {
  const callbacks = { enableMobileInput: vi.fn(async () => true),
    isSourceAvailable: vi.fn(() => true), onActivateSource: vi.fn(), ...overrides };
  const hook = renderHook((props) => {
    const [text, setText] = useState(initial);
    const [open, setOpen] = useState(false);
    useSelectionToCommandInput({ isMobile: true, mobileViewOnly: true, ...callbacks, ...props,
      setCommandText: setText, setCommandInputOpen: setOpen });
    return { text, open };
  });
  return { ...hook, ...callbacks };
};

it('opens quick input with the exact selection after restoring input mode', async () => {
  const test = setup();
  await act(async () => { dispatch(); });
  expect(test.enableMobileInput).toHaveBeenCalledOnce();
  expect(test.onActivateSource).toHaveBeenCalledWith(selected);
  expect(test.result.current).toEqual({ text: selected.text, open: true });
});

it('preserves an existing draft and appends the selection on a new line', async () => {
  const test = setup('기존 명령');
  await act(async () => { dispatch(); });
  expect(test.result.current.text).toBe('기존 명령\n' + selected.text);
});

it('keeps an existing trailing newline without adding another separator', async () => {
  const test = setup('기존 명령\n');
  await act(async () => { dispatch(); });
  expect(test.result.current.text).toBe('기존 명령\n' + selected.text);
});

it('keeps the draft and composer closed when input mode restoration fails, then allows retry', async () => {
  const enableMobileInput = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const test = setup('기존 명령', { enableMobileInput });
  await act(async () => { dispatch(); });
  expect(test.result.current).toEqual({ text: '기존 명령', open: false });
  expect(test.onActivateSource).not.toHaveBeenCalled();
  await act(async () => { dispatch(); });
  expect(test.result.current.text).toBe('기존 명령\n' + selected.text);
  expect(test.result.current.open).toBe(true);
});

it('handles only one selection while restoration is pending', async () => {
  let resolve;
  const enableMobileInput = vi.fn(() => new Promise(done => { resolve = done; }));
  const test = setup('초안', { enableMobileInput });
  act(() => { dispatch(); dispatch(); });
  expect(enableMobileInput).toHaveBeenCalledOnce();
  expect(test.result.current).toEqual({ text: '초안', open: false });
  await act(async () => { resolve(true); });
  expect(test.result.current.text).toBe('초안\n' + selected.text);
  expect(test.onActivateSource).toHaveBeenCalledOnce();
});

it('ignores empty or missing text and a source pane that no longer exists', async () => {
  const test = setup('초안', { isSourceAvailable: vi.fn(() => false) });
  await act(async () => { dispatch(null); dispatch({ text: '  ' }); dispatch(); });
  expect(test.enableMobileInput).not.toHaveBeenCalled();
  expect(test.result.current).toEqual({ text: '초안', open: false });
});

it('does not open a composer for a source removed while restoration was pending', async () => {
  let resolve;
  const test = setup('초안', {
    enableMobileInput: vi.fn(() => new Promise(done => { resolve = done; })),
    isSourceAvailable: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
  });
  act(() => { dispatch(); });
  await act(async () => { resolve(true); });
  expect(test.result.current).toEqual({ text: '초안', open: false });
  expect(test.onActivateSource).not.toHaveBeenCalled();
});

it('uses the latest input mode and stops listening after unmount', async () => {
  const test = setup();
  test.rerender({ mobileViewOnly: false });
  await act(async () => { dispatch(); });
  expect(test.enableMobileInput).not.toHaveBeenCalled();
  expect(test.result.current.open).toBe(true);
  test.unmount();
  await act(async () => { dispatch(); });
  expect(test.onActivateSource).toHaveBeenCalledOnce();
});

it('does not activate a pane after unmount during restoration', async () => {
  let resolve;
  const test = setup('', { enableMobileInput: vi.fn(() => new Promise(done => { resolve = done; })) });
  act(() => { dispatch(); });
  test.unmount();
  await act(async () => { resolve(true); });
  expect(test.onActivateSource).not.toHaveBeenCalled();
});
