/**
 * useTouchDragReorder — 모바일 터치 기반 reorder 훅.
 *
 * UX:
 *  - 손가락 꾹 눌렀다가(longPressMs=250ms) 움직이면 → 드래그 모드 진입.
 *  - 진입 후엔 컨테이너 touch-action 을 none 으로 잠가 가로 스크롤 안 끼어듦.
 *  - 빠른 스와이프(타이머 발화 전 이동) → primed 안 되고 스크롤 그대로.
 *  - 손가락 떼면 그 위치 아래 element 의 data-* 속성을 읽어 onReorder(fromId, toId).
 *
 * HTML5 drag-and-drop 은 iOS Safari/Android 에서 들쭉날쭉하니 터치 이벤트 직접 구현.
 *
 * 사용:
 *   const reorder = useTouchDragReorder({
 *     dataAttr: 'data-tab-id',
 *     scrollContainerRef,
 *     onReorder: (fromId, toId) => { ... },
 *   });
 *
 *   <div ref={scrollContainerRef}>
 *     {items.map((it) => (
 *       <div key={it.id} {...reorder.getItemProps(it.id)}>...</div>
 *     ))}
 *   </div>
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEdgeAutoScroll } from './useEdgeAutoScroll';

const DEFAULT_LONG_PRESS_MS = 250;
const MOVE_THRESHOLD_PX = 6;

export const useTouchDragReorder = ({
  dataAttr = 'data-id',
  scrollContainerRef = null,
  onReorder = null,
  longPressMs = DEFAULT_LONG_PRESS_MS,
}) => {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // 드래그 중 컨테이너 가장자리에 손가락이 들어오면 가로 스크롤을 자동으로 흘려준다 —
  // touch-action: none 으로 OS 스크롤은 막혔지만 우리는 scrollLeft 를 직접 갱신.
  const edgeAutoScroll = useEdgeAutoScroll({ containerRef: scrollContainerRef });

  const primedRef = useRef(false);
  const dragModeRef = useRef(false);
  const startXYRef = useRef(null);
  const currentIdRef = useRef(null);
  const primedTimerRef = useRef(null);
  const dragOverIdRef = useRef(null);
  const savedTouchActionRef = useRef(null);

  // dragOverId state 와 ref 동기 — touchend 시점에 최신 값 즉시 쓰기 위함.
  useEffect(() => { dragOverIdRef.current = dragOverId; }, [dragOverId]);

  const clearPrimedTimer = () => {
    if (primedTimerRef.current) {
      clearTimeout(primedTimerRef.current);
      primedTimerRef.current = null;
    }
  };

  const restoreTouchAction = () => {
    const container = scrollContainerRef?.current;
    if (container && savedTouchActionRef.current != null) {
      container.style.touchAction = savedTouchActionRef.current;
      savedTouchActionRef.current = null;
    }
  };

  const lockScroll = () => {
    const container = scrollContainerRef?.current;
    if (container) {
      savedTouchActionRef.current = container.style.touchAction || '';
      container.style.touchAction = 'none';
    }
  };

  const cleanup = useCallback(() => {
    primedRef.current = false;
    dragModeRef.current = false;
    currentIdRef.current = null;
    startXYRef.current = null;
    clearPrimedTimer();
    restoreTouchAction();
    edgeAutoScroll.stop();
    setDraggingId(null);
    setDragOverId(null);
  }, [edgeAutoScroll]);

  // 언마운트 시 안전망.
  useEffect(() => cleanup, [cleanup]);

  // 드래그 모드 진입 후엔 OS 의 스크롤이 끼어들지 않게 non-passive 로 preventDefault.
  // React 의 synthetic touchmove 는 기본 passive 라 e.preventDefault() 가 무시되므로
  // 컨테이너에 native 리스너를 따로 부착한다.
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return undefined;
    const handler = (e) => {
      if (dragModeRef.current || primedRef.current) {
        if (e.cancelable) e.preventDefault();
      }
    };
    container.addEventListener('touchmove', handler, { passive: false });
    return () => container.removeEventListener('touchmove', handler);
  }, [scrollContainerRef]);

  const onTouchStart = useCallback((e, id) => {
    if (e.touches.length > 1) {
      // 멀티 터치 (핀치 등) — 드래그 취소.
      cleanup();
      return;
    }
    currentIdRef.current = id;
    const t = e.touches[0];
    startXYRef.current = { x: t.clientX, y: t.clientY };
    primedRef.current = false;
    dragModeRef.current = false;
    clearPrimedTimer();
    primedTimerRef.current = setTimeout(() => {
      primedRef.current = true;
      // 컨테이너 가로 스크롤을 잠가야 손가락 이동이 OS 의 패닝이 아니라 우리 onTouchMove 로만 옴.
      lockScroll();
      // 햅틱 살짝.
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(8); } catch { /* noop */ }
      }
    }, longPressMs);
  }, [cleanup, longPressMs]);

  const onTouchMove = useCallback((e) => {
    const t = e.touches?.[0];
    if (!t || !startXYRef.current) return;
    const dx = t.clientX - startXYRef.current.x;
    const dy = t.clientY - startXYRef.current.y;
    const dist = Math.hypot(dx, dy);

    if (!primedRef.current) {
      // 타이머 발화 전 이동량이 크면 → 사용자가 스크롤 의도. primed 취소, 정상 스크롤 위임.
      if (dist > MOVE_THRESHOLD_PX) clearPrimedTimer();
      return;
    }

    // primed — 이제 이동이 드래그.
    if (!dragModeRef.current) {
      if (dist < MOVE_THRESHOLD_PX) return;
      dragModeRef.current = true;
      setDraggingId(currentIdRef.current);
    }

    // 컨테이너 가장자리 — 자동 가로 스크롤.
    edgeAutoScroll.update(t.clientX);

    // 손가락 아래 element 찾기 → data 속성으로 target id 추출.
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const itemEl = el?.closest(`[${dataAttr}]`);
    const overId = itemEl?.getAttribute(dataAttr) || null;
    if (overId !== dragOverIdRef.current) setDragOverId(overId);
  }, [dataAttr, edgeAutoScroll]);

  const onTouchEnd = useCallback(() => {
    const wasDrag = dragModeRef.current;
    const fromId = currentIdRef.current;
    const toId = dragOverIdRef.current;
    if (wasDrag && fromId && toId && fromId !== toId) {
      onReorder?.(fromId, toId);
    }
    cleanup();
  }, [cleanup, onReorder]);

  const onTouchCancel = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const getItemProps = useCallback((id) => ({
    [dataAttr]: id,
    onTouchStart: (e) => onTouchStart(e, id),
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  }), [dataAttr, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel]);

  return { getItemProps, draggingId, dragOverId, isDragging: !!draggingId };
};

export default useTouchDragReorder;
