import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeVncResize, createResizeScheduler } from './vncResize';

// vncResize: "드래그 중엔 안 보내고, 안정화 뒤에 1회만 보낸다" 는 판정.
// 이게 틀리면 분할 테두리를 드래그할 때마다 Xvnc framebuffer 가 쓸데없이
// 수십 번 리사이즈되며 화면이 흔들린다.

describe('computeVncResize — 전송 판정', () => {
  const lastSent = { width: 800, height: 600 };

  it('proposed 가 null/undefined 면 측정 실패로 본다', () => {
    expect(computeVncResize({ proposed: null, connected: true, lastSent }))
      .toEqual({ measured: false, resize: null });
    expect(computeVncResize({ proposed: undefined, connected: true, lastSent }))
      .toEqual({ measured: false, resize: null });
  });

  it('치수가 0/음수면 측정 실패 — 컨테이너가 아직 0px 일 때', () => {
    expect(computeVncResize({ proposed: { width: 0, height: 600 }, connected: true, lastSent }))
      .toEqual({ measured: false, resize: null });
    expect(computeVncResize({ proposed: { width: 800, height: 0 }, connected: true, lastSent }))
      .toEqual({ measured: false, resize: null });
    expect(computeVncResize({ proposed: { width: -5, height: 600 }, connected: true, lastSent }))
      .toEqual({ measured: false, resize: null });
  });

  it('연결이 안 됐으면 측정은 했지만 전송은 안 한다', () => {
    const r = computeVncResize({ proposed: { width: 1024, height: 768 }, connected: false, lastSent });
    expect(r).toEqual({ measured: true, resize: null });
  });

  it('치수가 직전과 같으면 전송하지 않는다 — 중복 SetDesktopSize 방지', () => {
    const r = computeVncResize({ proposed: { width: 800, height: 600 }, connected: true, lastSent });
    expect(r).toEqual({ measured: true, resize: null });
  });

  it('치수가 바뀌었으면 새 치수를 전송한다', () => {
    const r = computeVncResize({ proposed: { width: 1024, height: 768 }, connected: true, lastSent });
    expect(r).toEqual({ measured: true, resize: { width: 1024, height: 768 } });
  });

  it('한 축만 바뀌어도 전송한다 — width 만 변한 경우', () => {
    const r = computeVncResize({ proposed: { width: 1000, height: 600 }, connected: true, lastSent });
    expect(r).toEqual({ measured: true, resize: { width: 1000, height: 600 } });
  });

  it('lastSent 가 null 이면 첫 유효 측정값을 무조건 전송한다 — 최초 1회', () => {
    const r = computeVncResize({ proposed: { width: 800, height: 600 }, connected: true, lastSent: null });
    expect(r).toEqual({ measured: true, resize: { width: 800, height: 600 } });
  });

  it('소수를 반올림한다 — 100.4→100, 99.6→100 (픽셀은 정수)', () => {
    const r1 = computeVncResize({ proposed: { width: 100.4, height: 99.6 }, connected: true, lastSent: null });
    expect(r1.resize).toEqual({ width: 100, height: 100 });

    // 같은 정수로 수렴하면 변화 없음으로 취급 — 미세 드래그 중 불필요한 전송 차단.
    const r2 = computeVncResize({
      proposed: { width: 100.3, height: 99.7 },
      connected: true,
      lastSent: { width: 100, height: 100 },
    });
    expect(r2.resize).toBe(null);
  });

  it('반올림 경계(0.5)에서는 위로 — framebuffer 픽셀 누락 방지', () => {
    const r = computeVncResize({ proposed: { width: 100.5, height: 100.5 }, connected: true, lastSent: null });
    expect(r.resize).toEqual({ width: 101, height: 101 });
  });
});

describe('createResizeScheduler — 디바운스', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('기본 250ms 뒤 onApply 를 1회 호출한다', () => {
    const onApply = vi.fn();
    const { schedule } = createResizeScheduler({ onApply });
    schedule();
    expect(onApply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(onApply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('빠르게 여러 번 schedule 해도 onApply 는 마지막 기준 1회만 실행 — trailing', () => {
    const onApply = vi.fn();
    const { schedule } = createResizeScheduler({ onApply });
    schedule();             // t=0
    vi.advanceTimersByTime(100);
    schedule();             // t=100 — 타이머 리셋
    vi.advanceTimersByTime(200);
    schedule();             // t=300 — 다시 리셋
    vi.advanceTimersByTime(249);
    expect(onApply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // t=550 (300+250) — 드디어 발화
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('커스텀 debounceMs 를 존중한다', () => {
    const onApply = vi.fn();
    const { schedule } = createResizeScheduler({ onApply, debounceMs: 100 });
    schedule();
    vi.advanceTimersByTime(99);
    expect(onApply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('flush() 는 대기 타이머를 즉시 실행한다 — 언마운트 정리', () => {
    const onApply = vi.fn();
    const { schedule, flush } = createResizeScheduler({ onApply });
    schedule();
    expect(onApply).not.toHaveBeenCalled();
    flush();
    expect(onApply).toHaveBeenCalledTimes(1);
    // flush 후 더 시간이 흘러도 재발화하지 않는다.
    vi.advanceTimersByTime(500);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('flush() 는 대기 중이 아니면 아무것도 안 한다', () => {
    const onApply = vi.fn();
    const { flush } = createResizeScheduler({ onApply });
    flush();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('cancel() 은 예약된 호출을 취소한다', () => {
    const onApply = vi.fn();
    const { schedule, cancel } = createResizeScheduler({ onApply });
    schedule();
    cancel();
    vi.advanceTimersByTime(1000);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('cancel() 후 다시 schedule 하면 정상 동작한다', () => {
    const onApply = vi.fn();
    const { schedule, cancel } = createResizeScheduler({ onApply });
    schedule();
    cancel();
    schedule();
    vi.advanceTimersByTime(250);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
