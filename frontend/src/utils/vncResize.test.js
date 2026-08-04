import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeVncResize, createResizeScheduler, computeVncGeometry,
  computeCreateGeometry, DESKTOP_DEFAULT_GEOMETRY,
  applyVncViewMode, vncViewModeFlags, normalizeVncViewMode, VNC_VIEW_FIT, VNC_VIEW_PAN,
} from './vncResize';

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

// computeVncGeometry: pane/뷰포트 실측 → 'WxH' 문자열.
// 이게 틀리면 데스크탑이 처음에 엉뚱한 비율로 떴다가 리사이즈되거나,
// 비정상적으로 큰/작은 값이 백엔드로 전송된다.
describe('computeVncGeometry — 초기 해상도 계산', () => {
  it('정상 크기를 WxH 문자열로 반환한다', () => {
    expect(computeVncGeometry(1920, 1080)).toBe('1920x1080');
    expect(computeVncGeometry(1280, 800)).toBe('1280x800');
  });

  it('홀수 크기를 짝수로 반올림한다', () => {
    expect(computeVncGeometry(1921, 1081)).toBe('1922x1082');
    expect(computeVncGeometry(999, 601)).toBe('1000x602');
  });

  it('소수점을 반올림한다', () => {
    expect(computeVncGeometry(1920.4, 1080.3)).toBe('1920x1080');
    expect(computeVncGeometry(1023.6, 767.6)).toBe('1024x768');
  });

  it('하한(640x480) 미만을 클램프한다', () => {
    expect(computeVncGeometry(100, 100)).toBe('640x480');
    expect(computeVncGeometry(300, 200)).toBe('640x480');
  });

  it('상한(3840x2160) 초과를 클램프한다', () => {
    expect(computeVncGeometry(5000, 3000)).toBe('3840x2160');
    expect(computeVncGeometry(7680, 4320)).toBe('3840x2160');
  });

  it('무효/0/음수 → 1280x800 폴백', () => {
    expect(computeVncGeometry(null, 800)).toBe('1280x800');
    expect(computeVncGeometry(1920, null)).toBe('1280x800');
    expect(computeVncGeometry(undefined, undefined)).toBe('1280x800');
    expect(computeVncGeometry(0, 0)).toBe('1280x800');
    expect(computeVncGeometry(-100, 800)).toBe('1280x800');
    expect(computeVncGeometry(NaN, 800)).toBe('1280x800');
  });

  it('하한 경계값은 그대로 통과한다', () => {
    expect(computeVncGeometry(640, 480)).toBe('640x480');
  });

  it('상한 경계값은 그대로 통과한다', () => {
    expect(computeVncGeometry(3840, 2160)).toBe('3840x2160');
  });
});

// computeCreateGeometry: "폰이 데스크탑 해상도를 정하지 못하게" 하는 규칙.
// 이게 틀리면 폰에서 만든 데스크탑이 폰 크기로 떠서 창이 잘리고, 그 해상도가
// 세션에 남아 나중에 PC 로 봐도 잘린 채다.
describe('computeCreateGeometry — 폰은 데스크탑 크기를 정하지 않는다', () => {
  it('폰이면 실측을 무시하고 데스크탑 기본값을 쓴다', () => {
    expect(computeCreateGeometry({ width: 390, height: 720, isPhone: true }))
      .toBe(DESKTOP_DEFAULT_GEOMETRY);
    // 가로 모드로 돌려도 마찬가지 — 폰이라는 사실이 판단 기준이다.
    expect(computeCreateGeometry({ width: 844, height: 390, isPhone: true }))
      .toBe(DESKTOP_DEFAULT_GEOMETRY);
  });

  it('폰이 아니면 기존 실측 계산 그대로다', () => {
    expect(computeCreateGeometry({ width: 1920, height: 1080 })).toBe('1920x1080');
    expect(computeCreateGeometry({ width: 1600, height: 900, isPhone: false })).toBe('1600x900');
  });

  it('인자가 없어도 폴백으로 안전하게 동작한다', () => {
    expect(computeCreateGeometry()).toBe('1280x800');
  });
});

// 보기 모드: fit(통째로 축소) / pan(1:1 + 끌어서 이동).
// 순서 규칙이 핵심 — noVNC 는 scaleViewport 가 켜져 있는 동안 clipViewport=true 를
// 무시한다("Scaling trumps clipping"). 순서가 뒤집히면 pan 모드가 조용히 안 먹는다.
describe('vncViewModeFlags / applyVncViewMode', () => {
  it('fit → scale 켜고 clip/drag 끈다', () => {
    expect(vncViewModeFlags(VNC_VIEW_FIT))
      .toEqual({ scaleViewport: true, clipViewport: false, dragViewport: false });
  });

  it('pan → scale 끄고 clip/drag 켠다', () => {
    expect(vncViewModeFlags(VNC_VIEW_PAN))
      .toEqual({ scaleViewport: false, clipViewport: true, dragViewport: true });
  });

  it('모르는 값은 fit 으로 정규화한다', () => {
    expect(normalizeVncViewMode(undefined)).toBe(VNC_VIEW_FIT);
    expect(normalizeVncViewMode('zoom')).toBe(VNC_VIEW_FIT);
    expect(vncViewModeFlags('zoom')).toEqual(vncViewModeFlags(VNC_VIEW_FIT));
  });

  it('pan 적용 시 scaleViewport 를 clipViewport 보다 먼저 끈다', () => {
    const order = [];
    const rfb = {
      set scaleViewport(v) { order.push(['scaleViewport', v]); },
      set clipViewport(v) { order.push(['clipViewport', v]); },
      set dragViewport(v) { order.push(['dragViewport', v]); },
    };
    applyVncViewMode(rfb, VNC_VIEW_PAN);
    expect(order).toEqual([
      ['scaleViewport', false],
      ['clipViewport', true],
      ['dragViewport', true],
    ]);
  });

  it('fit 적용 시 clipViewport 를 scaleViewport 보다 먼저 끈다', () => {
    const order = [];
    const rfb = {
      set scaleViewport(v) { order.push(['scaleViewport', v]); },
      set clipViewport(v) { order.push(['clipViewport', v]); },
      set dragViewport(v) { order.push(['dragViewport', v]); },
    };
    applyVncViewMode(rfb, VNC_VIEW_FIT);
    expect(order).toEqual([
      ['clipViewport', false],
      ['scaleViewport', true],
      ['dragViewport', false],
    ]);
  });

  it('rfb 가 없으면 아무것도 안 하고 null 을 준다 — 연결 전 호출 방어', () => {
    expect(applyVncViewMode(null, VNC_VIEW_PAN)).toBe(null);
    expect(applyVncViewMode(undefined, VNC_VIEW_FIT)).toBe(null);
  });
});
