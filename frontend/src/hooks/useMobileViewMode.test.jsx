import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useMobileViewMode from './useMobileViewMode';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem('iterm:mobileViewOnly'); });

it('starts ready for direct input and restores explicit viewing mode after remount', () => {
  const first = renderHook(useMobileViewMode);
  expect(first.result.current[0]).toBe(false);
  act(() => first.result.current[1](true));
  first.unmount();
  const next = renderHook(useMobileViewMode);
  expect(next.result.current[0]).toBe(true);
  act(() => next.result.current[1](false));
  next.unmount();
  expect(renderHook(useMobileViewMode).result.current[0]).toBe(false);
});

it('restores viewing mode only when this device explicitly selected it', () => {
  localStorage.setItem('iterm:mobileViewOnly', 'true');
  expect(renderHook(useMobileViewMode).result.current[0]).toBe(true);
});

it('allows direct input when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Unavailable'); });
  expect(renderHook(useMobileViewMode).result.current[0]).toBe(false);
});
