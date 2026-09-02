import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useViewport from './useViewport';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 하단 검은 띠 — `--vvh` 가 실제 가시 영역보다 작게 굳는 병.
 *
 * 이 병은 **폰에서만 보인다.** 데스크탑에선 `isMobile` 이 false 라 이 값을 안 쓰고,
 * jsdom 은 visualViewport 가 없어 아무 일도 안 일어난다. 그래서 사람이 폰을 들고
 * 보기 전까지 아무도 모른다 — 그게 이 파일이 있는 이유다.
 *
 * 굳는 길이 셋이었고 셋 다 여기서 막는다:
 *   1. `window.resize` 가 높이를 안 갱신했다(isMobile 만 봤다).
 *   2. settle 타이머가 높이를 **다시 읽지 않았다** — iOS 는 주소창 접힘 애니메이션
 *      중간값으로 마지막 resize 를 쏘고 끝낼 수 있다.
 *   3. 앱 전환/bfcache 복원은 resize 없이 크롬 높이만 바꿔 놓는다.
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

  /* ⚠️ **이 블록을 뒤집지 마라.** 한때 "평소엔 `--vvh` 를 안 걸고 CSS `100dvh` 가 재게
     두자" 였고, 근거는 "JS 로 잰 값은 낡는다" 였다. 그 근거 자체는 맞지만 `dvh` 가 대안이
     못 된다는 것이 **폰 실측으로 드러났다**(iOS Safari):

       vv=556  inner=556  root=665  app=665

     가시 영역이 556 인데 `100dvh` 로 잡힌 앱이 665 였다 — 109px 이 그대로 하단 빈틈이다.
     `visualViewport.height` 는 정의상 사람이 보는 높이라 어긋날 수가 없고, 낡음은 아래의
     재측정(settle·visibilitychange·pageshow·resize) 테스트들이 막는다. */
  it('가시 영역을 언제나 --vvh 에 건다', () => {
    renderHook(() => useViewport());
    expect(vvh()).toBe('800px');
  });

  it('주소창만 접혀도 따라간다 — 키보드인지 구별하지 않는다', () => {
    renderHook(() => useViewport());
    setViewport(700, 0, 800);          // 크롬만큼의 차이
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('700px');
  });

  it('키보드가 올라오면 그만큼 줄어든다', () => {
    renderHook(() => useViewport());
    setViewport(400, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('400px');
  });

  it('키보드가 내려가면 도로 커진다', () => {
    renderHook(() => useViewport());
    setViewport(400, 0, 800);
    fireVV('resize');
    flushRaf();
    setViewport(800, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('800px');
  });

  /* 실측에서 나온 경계 — 키보드가 올라왔는데 `innerHeight` 도 함께 줄어 비율이 0.718 이
     나왔다. 비율로 "키보드냐" 를 가르던 판이었으면 이걸 놓쳐 앱이 실제보다 커진다.
     지금은 가르지 않으므로 그런 경계 자체가 없다. */
  it('비율이 애매한 순간에도 가시 영역을 그대로 쓴다', () => {
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
  it('#root 는 fixed 가 아니고, 앱 상자는 --vvb 로 밀지 않는다', () => {
    const src = readFileSync(resolve(__dirname, '..', 'App.jsx'), 'utf8');
    const rootBlock = src.slice(src.indexOf('#root {'), src.indexOf('#root {') + 200);
    expect(rootBlock).not.toMatch(/position:\s*fixed/);
    expect(src).not.toMatch(/paddingBottom:[^\n]*--vvb/);
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
      expect(vvh()).toBe('800px');       // 마운트 시점 값 그대로
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

  /* ── 실측 보고가 실제로 나가는가 ─────────────────────────────────────────
   * 폰 전용 병은 값을 받는 것 말고 진단할 길이 없는데, **그 통로가 조용히 안 도는 것**이
   * 하필 그 상황에서 가장 알아채기 어렵다. 첫 배선이 정확히 그랬다: 마운트 때 한 번만
   * 재고 그때는 터미널 소켓이 없어서, WS attach 12번에 보고 0건이었다.
   */
  describe('실측 보고', () => {
    let seen;
    const onReport = (e) => seen.push(e.detail);

    beforeEach(() => {
      seen = [];
      // 폰에서만 보낸다 — 게이트를 통과시킨다.
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      window.addEventListener('iterm:client-report', onReport);
    });
    afterEach(() => window.removeEventListener('iterm:client-report', onReport));

    it('소켓이 붙을 시간을 준 뒤에도 다시 보낸다 — 첫 화면 값이 가장 중요하다', () => {
      renderHook(() => useViewport());
      seen.length = 0;                       // 마운트 시점 보고는 받을 곳이 없다
      act(() => { vi.advanceTimersByTime(2000); });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0].scope).toBe('viewport');
    });

    it('보고에 root 와 app 높이가 들어간다 — 그 차이가 곧 하단 띠다', () => {
      renderHook(() => useViewport());
      act(() => { vi.advanceTimersByTime(2000); });
      expect(seen.at(-1).detail).toMatch(/root=/);
      expect(seen.at(-1).detail).toMatch(/app=/);
      expect(seen.at(-1).detail).toMatch(/vv=\d+/);
    });

    it('폰이 아니면 아무것도 안 보낸다', () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      renderHook(() => useViewport());
      act(() => { vi.advanceTimersByTime(2000); });
      expect(seen).toEqual([]);
    });
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
