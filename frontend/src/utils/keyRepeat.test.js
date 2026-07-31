import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKeyRepeater, isRepeatableKey } from './keyRepeat';

describe('isRepeatableKey', () => {
  it('여러 번 누르는 게 당연한 키만 연다', () => {
    expect(isRepeatableKey('\x7f')).toBe(true);      // Backspace
    expect(isRepeatableKey('\x1b[D')).toBe(true);    // ←
  });

  it('연타되면 사고인 키는 막는다', () => {
    expect(isRepeatableKey('\r')).toBe(false);       // Enter
    expect(isRepeatableKey('\x1b')).toBe(false);     // ESC
    expect(isRepeatableKey('\x03')).toBe(false);     // ^C
  });
});

describe('createKeyRepeater', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('짧게 누르면 반복하지 않는다 — 최초 1회는 호출부가 쏘므로 여기선 0번', () => {
    const onFire = vi.fn();
    const r = createKeyRepeater({ onFire });
    r.start('\x7f');
    vi.advanceTimersByTime(300);
    r.stop();
    vi.advanceTimersByTime(1000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('계속 누르고 있으면 간격마다 반복한다', () => {
    const onFire = vi.fn();
    const r = createKeyRepeater({ onFire, delay: 400, interval: 80 });
    r.start('\x7f');
    vi.advanceTimersByTime(400 + 80 * 3);
    expect(onFire).toHaveBeenCalledTimes(3);
    expect(onFire).toHaveBeenCalledWith('\x7f');
  });

  it('떼면 즉시 멈춘다', () => {
    const onFire = vi.fn();
    const r = createKeyRepeater({ onFire, delay: 400, interval: 80 });
    r.start('\x7f');
    vi.advanceTimersByTime(400 + 80);
    r.stop();
    vi.advanceTimersByTime(1000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('반복 대상이 아니면 타이머를 아예 걸지 않는다', () => {
    const onFire = vi.fn();
    const r = createKeyRepeater({ onFire });
    expect(r.start('\r')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onFire).not.toHaveBeenCalled();
    expect(r.isRunning()).toBe(false);
  });

  it('다른 키를 누르면 이전 반복은 끊긴다 — 두 키가 동시에 흐르지 않게', () => {
    const onFire = vi.fn();
    const r = createKeyRepeater({ onFire, delay: 400, interval: 80 });
    r.start('\x7f');
    vi.advanceTimersByTime(400 + 80);
    r.start('\x1b[D');
    vi.advanceTimersByTime(400 + 80);
    expect(onFire.mock.calls.map(([p]) => p)).toEqual(['\x7f', '\x1b[D']);
  });
});
