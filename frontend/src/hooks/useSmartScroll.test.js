import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSmartScroll } from './useSmartScroll';

const createMockTerm = (bufOverrides = {}, termOverrides = {}) => ({
  buffer: {
    active: {
      type: 'normal',
      viewportY: 100,
      length: 124,
      ...bufOverrides,
    },
  },
  rows: 24,
  scrollToBottom: vi.fn(),
  ...termOverrides,
});

describe('useSmartScroll', () => {
  it('isNearBottom returns true when viewport is at bottom', () => {
    const term = createMockTerm({ viewportY: 100, length: 124 });
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    expect(result.current.isNearBottom()).toBe(true);
  });

  it('isNearBottom returns true when viewportY exceeds max', () => {
    const term = createMockTerm({ viewportY: 110, length: 124 });
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    expect(result.current.isNearBottom()).toBe(true);
  });

  it('isNearBottom returns false when user scrolled up', () => {
    const term = createMockTerm({ viewportY: 50, length: 124 });
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    expect(result.current.isNearBottom()).toBe(false);
  });

  it('isNearBottom returns true when buffer is shorter than rows', () => {
    const term = createMockTerm({ viewportY: 0, length: 10 });
    term.rows = 24;
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    expect(result.current.isNearBottom()).toBe(true);
  });

  it('isNearBottom returns true when xtermRef is null', () => {
    const xtermRef = { current: null };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    expect(result.current.isNearBottom()).toBe(true);
  });

  it('isNearBottom returns true when buffer is null', () => {
    const term = { buffer: { active: null }, rows: 24, scrollToBottom: vi.fn() };
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    expect(result.current.isNearBottom()).toBe(true);
  });

  it('handleNewData calls scrollToBottom in always mode', () => {
    const term = createMockTerm();
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef, { autoScroll: 'always' }));
    act(() => { result.current.handleNewData(); });
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('handleNewData does not call scrollToBottom in smart mode', () => {
    const term = createMockTerm();
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef, { autoScroll: 'smart' }));
    act(() => { result.current.handleNewData(); });
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it('handleNewData does not call scrollToBottom in never mode', () => {
    const term = createMockTerm();
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef, { autoScroll: 'never' }));
    act(() => { result.current.handleNewData(); });
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it('handleUserScroll sets userScrolledUpRef to true when scrolled up', () => {
    const term = createMockTerm({ viewportY: 50, length: 124 });
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    act(() => { result.current.handleUserScroll(); });
    expect(result.current.userScrolledUpRef.current).toBe(true);
  });

  it('handleUserScroll sets userScrolledUpRef to false when at bottom', () => {
    const term = createMockTerm({ viewportY: 100, length: 124 });
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));
    act(() => { result.current.handleUserScroll(); });
    expect(result.current.userScrolledUpRef.current).toBe(false);
  });

  it('handleUserScroll updates correctly when viewport moves', () => {
    const buf = { type: 'normal', viewportY: 50, length: 124 };
    const term = { buffer: { active: buf }, rows: 24, scrollToBottom: vi.fn() };
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));

    // Scrolled up
    act(() => { result.current.handleUserScroll(); });
    expect(result.current.userScrolledUpRef.current).toBe(true);

    // Scroll back to bottom
    buf.viewportY = 100;
    act(() => { result.current.handleUserScroll(); });
    expect(result.current.userScrolledUpRef.current).toBe(false);
  });

  it('forceScrollToBottom clears userScrolledUpRef and calls scrollToBottom', () => {
    const term = createMockTerm({ viewportY: 50, length: 124 });
    const xtermRef = { current: term };
    const { result } = renderHook(() => useSmartScroll(xtermRef));

    // First mark as scrolled up
    act(() => { result.current.handleUserScroll(); });
    expect(result.current.userScrolledUpRef.current).toBe(true);

    // Force to bottom
    act(() => { result.current.forceScrollToBottom(); });
    expect(result.current.userScrolledUpRef.current).toBe(false);
    expect(term.scrollToBottom).toHaveBeenCalled();
  });

  it('updates handleNewData behavior when autoScroll changes', () => {
    const term = createMockTerm();
    const xtermRef = { current: term };

    // Start with 'smart'
    const { result, rerender } = renderHook(
      ({ autoScroll }) => useSmartScroll(xtermRef, { autoScroll }),
      { initialProps: { autoScroll: 'smart' } }
    );

    act(() => { result.current.handleNewData(); });
    expect(term.scrollToBottom).not.toHaveBeenCalled();

    // Change to 'always'
    rerender({ autoScroll: 'always' });
    term.scrollToBottom.mockClear();

    act(() => { result.current.handleNewData(); });
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
  });
});
