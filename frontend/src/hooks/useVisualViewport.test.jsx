import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useVisualViewport from './useVisualViewport';

/* `enabled` 로 껐다 켜지는 훅이라, **꺼져 있는 동안의 변화는 아무도 안 알려준다** —
   이벤트는 구독 중일 때만 오고 초기값은 마운트 때 한 번뿐이다.

   그 낡은 값이 실제 버그를 만들었다: 도크가 키보드 내려갈 때 blur 하면서 구독이 끊겨
   **내려가는 중간 높이**가 얼어붙었고, 다시 탭하면 그 값으로 "키보드가 올라와 있다" 고
   판정해 래치가 t=0 에 섰다. 곧이어 진짜 이벤트가 "아직 안 올라왔다" 를 알려주는 순간
   그 래치가 blur 를 불러 **키보드가 올라왔다 곧바로 내려갔다.** 탭할 때마다 반복. */
describe('useVisualViewport', () => {
  /* jsdom 에는 visualViewport 가 없다. EventTarget 로 최소한만 세운다 — 이 훅이 쓰는
     것은 height · offsetTop · resize/scroll 뿐이다. */
  let vv;
  const setVV = (height, offsetTop = 0) => {
    vv.height = height;
    vv.offsetTop = offsetTop;
  };

  beforeEach(() => {
    vv = new EventTarget();
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
    setVV(800, 0);
    /* 훅은 이벤트를 rAF 로 모은다. 그 코얼레싱은 여기서 볼 것이 아니므로 동기로 돌린다
       — 안 그러면 "구독 중 갱신" 단언이 프레임을 기다리다 늘 옛 값을 본다. */
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('구독을 시작할 때 지금 값을 다시 읽는다', () => {
    const { result, rerender } = renderHook(({ on }) => useVisualViewport(on), {
      initialProps: { on: false },
    });

    // 꺼져 있는 동안 실제 뷰포트가 바뀐다 — 이벤트는 안 온다(구독 안 했으니).
    act(() => setVV(400, 120));

    rerender({ on: true });
    expect(result.current.height).toBe(400);
    expect(result.current.offsetTop).toBe(120);
  });

  it('꺼질 때의 값에 얼어붙지 않는다 — 다시 켜면 현재를 본다', () => {
    const { result, rerender } = renderHook(({ on }) => useVisualViewport(on), {
      initialProps: { on: true },
    });

    act(() => {
      setVV(400);                                  // 키보드 올라옴
      vv.dispatchEvent(new Event('resize'));
    });
    expect(result.current.height).toBe(400);

    rerender({ on: false });                        // blur → 구독 끊김
    act(() => setVV(800));                          // 그 뒤 키보드가 마저 내려감
    rerender({ on: true });                         // 다시 탭

    expect(result.current.height).toBe(800);        // 400 이면 래치가 잘못 선다
  });

  it('구독 중에는 이벤트를 따라간다', () => {
    const { result } = renderHook(() => useVisualViewport(true));
    act(() => {
      setVV(300, 40);
      vv.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toEqual({ height: 300, offsetTop: 40 });
  });
});
