import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useEvent from './useEvent';

describe('useEvent', () => {
  it('returns a stable callback reference across re-renders', () => {
    const { result, rerender } = renderHook(({ fn }) => useEvent(fn), {
      initialProps: { fn: () => 'a' },
    });
    const first = result.current;
    rerender({ fn: () => 'b' });
    rerender({ fn: () => 'c' });
    // 매 render 마다 새 fn 을 줘도 useEvent 가 돌려준 함수 identity 는 동일해야 한다.
    expect(result.current).toBe(first);
  });

  it('always invokes the latest closure', () => {
    let captured = 'initial';
    const { result, rerender } = renderHook(({ fn }) => useEvent(fn), {
      initialProps: { fn: () => { captured = 'first'; } },
    });
    // 첫 render 의 closure 한 번 실행
    act(() => { result.current(); });
    expect(captured).toBe('first');
    // 새 closure 로 rerender
    rerender({ fn: () => { captured = 'second'; } });
    act(() => { result.current(); });
    expect(captured).toBe('second');
  });

  it('forwards arguments to the latest closure', () => {
    const spy = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useEvent(fn), {
      initialProps: { fn: spy },
    });
    act(() => { result.current('hello', 42, { k: 'v' }); });
    expect(spy).toHaveBeenCalledWith('hello', 42, { k: 'v' });

    const spy2 = vi.fn();
    rerender({ fn: spy2 });
    act(() => { result.current('world'); });
    expect(spy2).toHaveBeenCalledWith('world');
    // 이전 spy 는 두 번째 호출 안 받음
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns whatever the latest closure returns', () => {
    const { result, rerender } = renderHook(({ fn }) => useEvent(fn), {
      initialProps: { fn: () => 1 },
    });
    expect(result.current()).toBe(1);
    rerender({ fn: () => 2 });
    expect(result.current()).toBe(2);
  });

  it('is safe to call when initial fn is null/undefined', () => {
    const { result } = renderHook(() => useEvent(undefined));
    // 호출해도 throw 하지 않고 undefined 반환
    expect(() => result.current('arg')).not.toThrow();
    expect(result.current('arg')).toBeUndefined();
  });
});
