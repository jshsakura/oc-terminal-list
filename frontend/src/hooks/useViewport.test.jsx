import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useViewport from './useViewport';

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

  it('평소에는 --vvh 를 걸지 않는다 — CSS 100dvh 가 재게 둔다', () => {
    /* 이게 하단 빈틈의 뿌리였다. JS 로 잰 값은 반드시 언젠가 낡고, 낡은 값이 실제보다
       작으면 그 차이가 그대로 검은 띠가 된다. 브라우저가 매 프레임 재는 값은 안 낡는다. */
    renderHook(() => useViewport());
    expect(vvh()).toBe('');
  });

  it('키보드가 올라오면 그때만 --vvh 를 건다 (dvh 는 키보드를 모른다)', () => {
    renderHook(() => useViewport());
    setViewport(420, 0, 800);          // 380px 만큼 줄었다 = 키보드
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('420px');
  });

  it('키보드가 내려가면 변수를 도로 지운다', () => {
    renderHook(() => useViewport());
    setViewport(420, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('420px');

    setViewport(800, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('');            // 남아 있으면 그 값이 곧 빈틈이다
  });

  it('브라우저 크롬만큼의 차이는 키보드가 아니다', () => {
    /* iOS 하단 툴바는 60px 안팎이다. 이걸 키보드로 읽으면 평소에도 변수가 걸려
       낡을 기회가 생긴다 — 그게 원래 병이었다. */
    renderHook(() => useViewport());
    setViewport(740, 0, 800);
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('');
  });

  it('첫 진입의 펼쳐진 주소창을 키보드로 읽지 않는다', () => {
    /* ⚠️ 회귀 방지 — "150px 이상 벌어지면 키보드" 로 재던 시절, iOS 첫 화면이 정확히
       여기 걸려서 **처음엔 띠가 보이고 스크롤하면 사라지는** 증상이 났다. 큰 기기일수록
       크롬의 절대 픽셀도 커지므로 픽셀로 재면 안 된다. */
    renderHook(() => useViewport());
    setViewport(716, 0, 900);          // 184px 차이 = 펼쳐진 상하 크롬
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('');
  });

  it('큰 기기에서도 비율로 판정한다', () => {
    renderHook(() => useViewport());
    setViewport(1100, 0, 1300);        // 200px 차이지만 85% 라 크롬이다
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('');

    setViewport(700, 0, 1300);         // 54% 라 키보드다
    fireVV('resize');
    flushRaf();
    expect(vvh()).toBe('700px');
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
    renderHook(() => useViewport());
    setViewport(420, 0, 800);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    flushRaf();
    expect(vvh()).toBe('');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
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
    unmount();
    setViewport(400, 0, 800);
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushRaf();
    expect(vvh()).toBe('');
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
