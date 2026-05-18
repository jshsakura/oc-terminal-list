/**
 * useEdgeAutoScroll — 가로 스크롤 컨테이너의 좌/우 가장자리에 포인터가 들어오면
 * 자동으로 scrollLeft 를 증감시켜 드래그 중에도 화면 밖 항목 위로 이동할 수 있게 한다.
 *
 * 사용:
 *   const edgeScroll = useEdgeAutoScroll({ containerRef: tabListRef });
 *   // 드래그 이동마다
 *   edgeScroll.update(clientX);
 *   // 드래그 종료/취소 시
 *   edgeScroll.stop();
 *
 * 동작:
 *  - 컨테이너 좌/우 가장자리에서 EDGE_ZONE_PX 안쪽에 들어오면, 거리에 비례한
 *    속도로 매 프레임 scrollLeft 를 보정.
 *  - 스크롤 양 끝(이미 0 또는 max)에 도달하면 해당 방향 자동 스크롤 정지.
 *  - 컨테이너 밖으로 포인터가 나가도 다음 update 호출 전까지는 마지막 속도 유지.
 *    stop() 으로 즉시 정지시키는 책임은 호출자.
 */
import { useCallback, useEffect, useRef } from 'react';

const EDGE_ZONE_PX = 60;
const MAX_SPEED_PX_PER_FRAME = 18;

export const useEdgeAutoScroll = ({
  containerRef,
  edgeZone = EDGE_ZONE_PX,
  maxSpeed = MAX_SPEED_PX_PER_FRAME,
}) => {
  const rafRef = useRef(null);
  const velocityRef = useRef(0);

  const tick = useCallback(() => {
    const container = containerRef?.current;
    const velocity = velocityRef.current;
    if (!container || velocity === 0) {
      rafRef.current = null;
      return;
    }
    const before = container.scrollLeft;
    container.scrollLeft = before + velocity;
    // 양 끝에 닿아 더 이상 이동 못 하면 루프 종료 — 호출자가 다시 update 하면 재시작.
    if (container.scrollLeft === before) {
      velocityRef.current = 0;
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [containerRef]);

  const update = useCallback((clientX) => {
    const container = containerRef?.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const leftDist = clientX - rect.left;
    const rightDist = rect.right - clientX;

    let velocity = 0;
    if (leftDist >= 0 && leftDist < edgeZone) {
      const intensity = 1 - leftDist / edgeZone;
      velocity = -Math.max(1, Math.ceil(intensity * maxSpeed));
    } else if (rightDist >= 0 && rightDist < edgeZone) {
      const intensity = 1 - rightDist / edgeZone;
      velocity = Math.max(1, Math.ceil(intensity * maxSpeed));
    }

    // 스크롤 경계 — 이미 끝에 닿았으면 그 방향 속도는 0.
    if (velocity < 0 && container.scrollLeft <= 0) velocity = 0;
    if (velocity > 0 && container.scrollLeft + container.clientWidth >= container.scrollWidth - 1) velocity = 0;

    velocityRef.current = velocity;
    if (velocity !== 0 && rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [containerRef, edgeZone, maxSpeed, tick]);

  const stop = useCallback(() => {
    velocityRef.current = 0;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { update, stop };
};

export default useEdgeAutoScroll;
