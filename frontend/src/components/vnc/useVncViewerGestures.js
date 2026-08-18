import { useEffect, useRef } from 'react';
import { clampZoom, touchDistance } from '../../utils/vncPointer';

/**
 * 화면(캔버스) 위 **두 손가락 = 뷰어 조작** — 핀치로 확대, 밀어서 이동.
 *
 * 왜 가로채야 하나: noVNC 는 핀치를 **원격에 Ctrl+휠로 전달**한다(rfb.js 의 `case 'pinch'`).
 * 원격 앱이 Ctrl+휠 확대를 지원할 때나 의미가 있고, 데스크탑 화면 자체는 꿈쩍도 안 한다 —
 * 폰에서 "확대가 안 된다" 의 정체가 이것이다. 그래서 손가락 두 개짜리 터치는 캔버스에
 * 닿기 전에 **캡처 단계**에서 우리가 가져간다.
 *
 * ⚠️ 가져갈 때 noVNC 에 `touchcancel` 을 만들어 보낸다. 첫 손가락은 이미 캔버스에 도착해
 * 제스처 추적이 시작된 상태라, 그냥 삼키면 noVNC 쪽에 추적이 남아 **원격에 엉뚱한 드래그**가
 * 나가거나 다음 터치가 무시된다(GestureHandler 의 `_waitingRelease`). touchcancel 은
 * `_touchEnd` 로 들어가 상태를 깨끗이 접는다.
 *
 * 역할 분담이 이 화면의 규칙이 된다:
 *   화면 위 두 손가락 → **보는 방식**(확대·이동)
 *   터치패드 위 두 손가락 → **원격 조작**(스크롤)
 */

/** 손가락 두 개가 이만큼은 벌어져야 배율을 건드린다 — 미세한 떨림으로 화면이 튀지 않게. */
const PINCH_DEADZONE = 0.04;

const touchPoints = (event) => Array.from(event?.touches || []).map((touch) => ({
  x: touch.clientX,
  y: touch.clientY,
  id: touch.identifier,
}));

const midpointOf = (points) => ({
  x: (points[0].x + points[1].x) / 2,
  y: (points[0].y + points[1].y) / 2,
});

/**
 * @param {object} refs
 * @param {{current: HTMLElement}} refs.viewportRef - 스크롤을 가진 래퍼(캡처 리스너를 다는 곳)
 * @param {() => HTMLElement|null} refs.getCanvas   - noVNC 캔버스(취소 이벤트를 보낼 대상)
 * @param {() => number} refs.getZoom               - 현재 배율
 * @param {(zoom: number) => void} refs.onZoom      - 새 배율 요청
 * @param {boolean} refs.enabled                    - 작은 pane(모바일)에서만 켠다
 */
const useVncViewerGestures = ({ viewportRef, getCanvas, getZoom, onZoom, enabled = true }) => {
  const stateRef = useRef({ active: false, swallow: false, baseSpread: 0, baseZoom: 1, lastMid: null });

  useEffect(() => {
    const view = viewportRef?.current;
    if (!view || !enabled) return undefined;

    /** noVNC 가 이미 잡고 있던 터치를 접는다 — 안 하면 원격에 드래그가 새어 나간다. */
    const cancelNovncGesture = (event) => {
      const canvas = getCanvas?.();
      if (!canvas || typeof TouchEvent !== 'function') return;
      try {
        canvas.dispatchEvent(new TouchEvent('touchcancel', {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: Array.from(event.touches || []),
        }));
      } catch {
        /* TouchEvent 를 못 만드는 환경(데스크탑 브라우저·jsdom)에서는 애초에 이 경로가
           돌 일이 없다 — 조용히 넘어간다. */
      }
    };

    const onTouchStart = (event) => {
      const points = touchPoints(event);
      // 아직 뷰어 제스처가 끝나지 않았으면(손가락이 남아 있으면) 새 손가락도 삼킨다.
      if (points.length < 2 && !stateRef.current.swallow) return;
      event.stopPropagation();
      event.preventDefault();
      if (points.length < 2) return;
      if (!stateRef.current.active) cancelNovncGesture(event);
      stateRef.current = {
        active: true,
        swallow: true,
        baseSpread: touchDistance(points[0], points[1]),
        baseZoom: getZoom?.() || 1,
        lastMid: midpointOf(points),
      };
    };

    const onTouchMove = (event) => {
      const state = stateRef.current;
      if (!state.active && !state.swallow) return;
      event.stopPropagation();
      event.preventDefault();
      const points = touchPoints(event);
      /* 손가락이 하나만 남은 상태 — 배율도 이동도 계산하지 않지만 **삼키기는 한다.**
         남은 손가락의 움직임이 캔버스로 새면 확대를 마친 직후 원격이 드래그된다. */
      if (points.length < 2 || !state.active) return;

      // 이동 — 두 손가락 중점이 움직인 만큼 화면을 민다(네이티브 스크롤과 같은 방향).
      const mid = midpointOf(points);
      if (state.lastMid) {
        view.scrollLeft -= mid.x - state.lastMid.x;
        view.scrollTop -= mid.y - state.lastMid.y;
      }
      state.lastMid = mid;

      // 확대 — 벌어진 비율 그대로. 배율이 바뀌면 컨테이너가 커지고 noVNC 가 다시 autoscale 한다.
      const spread = touchDistance(points[0], points[1]);
      if (!state.baseSpread) return;
      const ratio = spread / state.baseSpread;
      if (Math.abs(ratio - 1) < PINCH_DEADZONE) return;
      onZoom?.(clampZoom(state.baseZoom * ratio));
    };

    const onTouchEnd = (event) => {
      const state = stateRef.current;
      if (!state.active && !state.swallow) return;
      event.stopPropagation();
      event.preventDefault();
      const remaining = (event.touches || []).length;
      if (remaining >= 2) {
        // 손가락 하나가 빠졌지만 아직 둘 이상 — 기준을 다시 잡는다(안 그러면 배율이 튄다).
        const points = touchPoints(event);
        stateRef.current = {
          ...state,
          baseSpread: touchDistance(points[0], points[1]),
          baseZoom: getZoom?.() || 1,
          lastMid: midpointOf(points),
        };
        return;
      }
      // 마지막 손가락이 떨어질 때까지 계속 삼킨다 — 남은 손가락이 떼어지며 원격에 클릭이
      // 되면 확대하려다 뭔가를 눌러버린 꼴이 된다.
      stateRef.current = { ...state, active: false, lastMid: null, swallow: remaining > 0 };
    };

    // 캡처 단계 — 캔버스(noVNC)보다 **먼저** 받아야 가로챌 수 있다.
    const opts = { capture: true, passive: false };
    view.addEventListener('touchstart', onTouchStart, opts);
    view.addEventListener('touchmove', onTouchMove, opts);
    view.addEventListener('touchend', onTouchEnd, opts);
    view.addEventListener('touchcancel', onTouchEnd, opts);
    return () => {
      view.removeEventListener('touchstart', onTouchStart, opts);
      view.removeEventListener('touchmove', onTouchMove, opts);
      view.removeEventListener('touchend', onTouchEnd, opts);
      view.removeEventListener('touchcancel', onTouchEnd, opts);
    };
  }, [viewportRef, getCanvas, getZoom, onZoom, enabled]);
};

export default useVncViewerGestures;
