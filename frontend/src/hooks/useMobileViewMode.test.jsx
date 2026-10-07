import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import useMobileViewMode from './useMobileViewMode';

afterEach(() => { cleanup(); localStorage.removeItem('iterm:mobileViewOnly'); });

it('starts in view mode and restores this device choice after remount', () => {
  const first = renderHook(useMobileViewMode);
  expect(first.result.current[0]).toBe(true);
  act(() => first.result.current[1](false));
  first.unmount();
  const next = renderHook(useMobileViewMode);
  expect(next.result.current[0]).toBe(false);
  act(() => next.result.current[1](true));
  next.unmount();
  expect(renderHook(useMobileViewMode).result.current[0]).toBe(true);
});
