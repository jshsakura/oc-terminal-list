import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useViewport from './useViewport';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 하단 빈 띠 · 화면이 위로 들리는 병 — 둘 다 폰에서만 보인다.
 *
 * 규칙 두 개가 이 파일의 전부다:
 *   1. `#root` 는 `position: fixed; inset: 0` 이다. iOS 에서 fixed 상자는 **보이는 영역**에
 *      붙는다. 정적 배치로 바꿨더니(2026-09-02) 최초 로딩에 페이지가 상단 크롬 뒤로 깔릴 때
 *      앱이 통째로 딸려 올라가 탭바가 화면 밖으로 나갔다.
 *   2. 앱은 그 상자를 `height: 100%` 로 **꽉 채운다.** `--vvh` 로 줄이면 그 값이 한 프레임만
 *      낡아도 차이가 하단의 빈 띠가 된다. `--vvh` 는 **키보드일 때만** 건다.
 *
 * 데스크탑에선 `isMobile` 이 false 라 이 값을 안 쓰고, jsdom 은 visualViewport 가 없다 —
 * 사람이 폰을 들기 전엔 아무도 모른다. 그게 이 파일이 있는 이유다.
 */

const vvh = () => document.documentElement.style.getPropertyValue('--vvh');

/** 가시 영역을 바꾼다. `layout` 을 크게 주면 키보드가 올라온 상태를 뜻한다. */
const setViewport = (height, offsetTop = 0, layout = height) => {
  window.visualViewport.height = height;
  window.visualViewport.offsetTop = offsetTop;
  Object.defineProperty(window, 'innerHeight', { value: layout, configurable: true, writable: true });
};

const fireVV = (type) => {
  const fn = window.visualViewport._listeners[type];
  if (fn) act(() => { fn(); });
};

describe('useViewport — 가시 영역 추적', () => {
  let rafQueue;

  beforeEach(() => {
    rafQueue = [];
    /* ⚠️ setTimeout 만 가짜로 만든다. `useFakeTimers()` 를 통째로 켜면 rAF 까지 가로채
       아래 스텁을 덮어쓰고, 그러면 이벤트가 한 번도 안 도는데 테스트는 "값이 안 바뀐다"
       라고만 말해 원인이 훅에 있는 것처럼 보인다. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // rAF 는 손으로 돌린다 — 이 훅은 rAF 로 이벤트를 합친다.
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafQueue.push(cb); return rafQueue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const listeners = {};
    vi.stubGlobal('visualViewport', {
      height: 800,
      offsetTop: 0,
      _listeners: listeners,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type) => { delete listeners[type]; },
    });
    document.documentElement.style.removeProperty('--vvh');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const flushRaf = () => act(() => { rafQueue.splice(0).forEach((cb) => cb()); });

  /* ⚠️ **평소에는 아무것도 걸지 않는다.** 한때 "가시 영역을 언제나 건다" 였고, 그때 값이
     한 프레임 낡는 순간이 그대로 하단 빈 띠였다(iOS 는 주소창 접힘 애니메이션 중간값으로
     마지막 resize 를 쏘고 끝내기도 한다). 상자(`#root`)가 fixed 라 이미 보이는 영역이므로
     잴 이유가 없다 — 재지 않으면 낡을 수도 없다. */
  it('평소에는 --vvh 를 걸지 않는다 — 상자를 꽉 채운다', () => {
    renderHook(() => useViewport());
    expect(vvh()).toBe('');
  });

  it('주소창이 접히고 펴져도 걸지 않는다 — 그건 상자가 이미 안다', () => {
    renderHook(() => useViewport());
    setViewport(700, 0, 800);          // 크롬만큼의 차이(87.5%)
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('');
  });

  it('키보드가 올라오면 그만큼 줄어든다', () => {
    renderHook(() => useViewport());
    setViewport(400, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('400px');
  });

  it('키보드가 내려가면 도로 걷힌다', () => {
    renderHook(() => useViewport());
    setViewport(400, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('400px');
    setViewport(800, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('');            // 값이 남으면 그게 하단 빈 띠다
  });

  /* 실측에서 나온 경계 — 키보드가 올라왔는데 `innerHeight` 도 함께 줄어(507) 비율이
     0.718 로 보였다. 그래서 기준은 **지금까지 본 가장 큰 레이아웃 뷰포트**(800)다.
     현재 innerHeight 로 재면 이 케이스에서 키보드를 놓쳐 입력창이 가린다. */
  it('전환 중 innerHeight 가 줄어 보여도 키보드를 놓치지 않는다', () => {
    renderHook(() => useViewport());
    setViewport(364, 158, 507);        // 실측값
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('364px');
  });

  /* ── 하단 빈틈의 진짜 뿌리 ──────────────────────────────────────────────────
   * iOS Safari 는 `position: fixed` 상자를 레이아웃 뷰포트가 아니라 **큰 뷰포트(ICB)**
   * 로 잡는다. 실측: `vv=556 inner=556` 인데 `#root`(fixed; inset:0)는 665 였고, 그
   * 상자의 **위** 109px 이 화면 밖이었다 — 탭바가 들려 잘리고 아래에 빈 띠가 남았다.
   *
   * 한때 그 차이를 `--vvb` 로 재서 아래를 밀었는데, 내용은 여전히 상자 맨 위에서
   * 시작하므로 아무것도 안 고쳐졌다. 해답은 보정이 아니라 **정적 배치**(= 레이아웃
   * 뷰포트 = 보이는 영역)다. 그래서 이 훅은 이제 그 값을 아예 만들지 않는다. */
  it('--vvb 를 만들지 않는다 — 아래로 미는 보정은 틀린 방향이었다', () => {
    const root = document.createElement('div');
    root.id = 'root';
    root.getBoundingClientRect = () => ({ height: 665 });
    document.body.appendChild(root);
    try {
      renderHook(() => useViewport());
      setViewport(556, 0, 556);
      fireVV('resize');
      flushRaf();
      expect(document.documentElement.style.getPropertyValue('--vvb')).toBe('');
    } finally {
      root.remove();
    }
  });

  /* 진짜 상자는 App.jsx 가 그린다 — 그런데 App.jsx 에는 렌더 테스트가 없다(CLAUDE.md).
     그래서 소스를 훑어 되돌림만 막는다. 이 두 줄이 이 병의 전부였다. */
  it('#root 는 두 곳 모두 fixed 다 — 한쪽만 고치면 첫 페인트가 어긋난다', () => {
    const rootRule = (src) => src.slice(src.indexOf('#root {'), src.indexOf('#root {') + 200);
    const app = readFileSync(resolve(__dirname, '..', 'App.jsx'), 'utf8');
    const html = readFileSync(resolve(__dirname, '..', '..', 'index.html'), 'utf8');
    expect(rootRule(app)).toMatch(/position:\s*fixed/);
    expect(rootRule(html)).toMatch(/position:\s*fixed/);
    // 상자를 채우지 않고 밀거나 줄이던 옛 판들 — 되돌아오면 다시 빈 띠다.
    expect(app).not.toMatch(/paddingBottom:[^\n]*--vvb/);
  });

  it('말이 안 되는 높이는 무시한다 — 접히면 하단바가 사라진다', () => {
    renderHook(() => useViewport());
    setViewport(420, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('420px');

    setViewport(0, 0, 800);            // 숨겨지는 순간의 찌꺼기
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('420px');       // 직전 값을 지킨다
  });

  it('숨겨질 때는 읽지 않는다', () => {
    /* ⚠️ 그 순간의 visualViewport 는 0 이거나 직전 프레임의 찌꺼기다. 그걸 쓰면 컨테이너가
       접혀 **하단 툴바가 통째로 사라진다.** 직전 값을 그대로 지켜야 한다. */
    renderHook(() => useViewport());
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      setViewport(420, 0, 800);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      flushRaf();
      expect(vvh()).toBe('');            // 숨겨지는 순간의 값으로 상자를 줄이지 않는다
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });

  it('앱 전환에서 돌아오면 다시 읽는다 (resize 없이 바뀐다)', () => {
    renderHook(() => useViewport());
    setViewport(420, 0, 800);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    flushRaf();
    expect(vvh()).toBe('420px');
  });

  it('bfcache 복원(pageshow)에서도 다시 읽는다', () => {
    renderHook(() => useViewport());
    setViewport(420, 0, 800);
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    flushRaf();
    expect(vvh()).toBe('420px');
  });

  it('window resize 도 갱신한다 — isMobile 만 보던 자리', () => {
    renderHook(() => useViewport());
    setViewport(420, 0, 800);
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushRaf();
    expect(vvh()).toBe('420px');
  });

  it('settle 이 애니메이션 중간값을 고쳐 쓴다', () => {
    renderHook(() => useViewport());
    setViewport(300, 0, 800);          // 37% = 키보드
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('300px');

    setViewport(420, 0, 800);          // 이벤트 없이 실제 값만 자리잡음
    act(() => { vi.advanceTimersByTime(300); });
    expect(vvh()).toBe('420px');
  });

  it('offsetTop 은 언제나 노출한다 — 키보드가 페이지를 밀어 올린 경우', () => {
    renderHook(() => useViewport());
    setViewport(400, 120, 800);
    fireVV('resize');
    flushRaf();
    expect(document.documentElement.style.getPropertyValue('--vvt')).toBe('120px');
  });


  it('언마운트하면 리스너를 전부 뗀다', () => {
    const { unmount } = renderHook(() => useViewport());
    const before = vvh();
    unmount();
    setViewport(400, 0, 800);
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushRaf();
    expect(vvh()).toBe(before);   // 리스너를 뗐으니 값이 안 따라간다
  });

  it('visualViewport 가 없어도 던지지 않는다', () => {
    vi.stubGlobal('visualViewport', undefined);
    expect(() => {
      const { unmount } = renderHook(() => useViewport());
      act(() => { window.dispatchEvent(new Event('resize')); });
      flushRaf();
      unmount();
    }).not.toThrow();
  });
});
