import { useCallback, useEffect, useRef } from 'react';
import { ChevronDown, Maximize, Minus, MousePointer2, Plus, Lock } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import {
  clampCursor, classifyTwoFinger, isTapGesture, keepCursorVisible, moveCursor,
  scrollDeltaFor, touchDistance, clampZoom,
} from '../../utils/vncPointer';
import {
  BUTTON_LEFT, BUTTON_RIGHT,
  findVncCanvas, sendClick, sendPointerDown, sendPointerMove, sendPointerUp, sendWheel,
} from '../../utils/vncSyntheticInput';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/** 커서를 화면 안에 유지할 때 남기는 여백. */
const CURSOR_MARGIN = 48;

/**
 * 모바일 VNC 조작 바 — 노트북 트랙패드를 화면 아래에 놓는다.
 *
 * 왜: noVNC 의 터치는 전부 **절대 좌표 탭**이라, 1920px 데스크탑이 폭 400px 로 줄어든
 * 화면에서는 손가락 하나가 원격 25px 을 덮는다. 창 닫기 버튼을 누를 수가 없다.
 * 여기서는 **손가락의 이동량**으로 커서를 옮기므로 정확도가 배율에서 풀려난다.
 *
 * 자리값도 공짜다 — 폰은 세로로 길고 데스크탑은 16:9 라, 맞춤 보기에서 위아래는 어차피
 * 빈 공간이다. 그 빈 곳에 조작을 넣는다.
 *
 * ⚠️ 이 패널은 **자기 DOM 안에서만** 터치를 받는다. 캔버스 위 직접 터치는 noVNC 의 기존
 * 제스처(탭=클릭, 두 손가락=스크롤)가 그대로 처리한다 — 둘은 겹치지 않는다.
 */
const VncTouchpad = ({
  getContainer,
  zoom = 1,
  canZoom = true,
  onZoomStep,          // 버튼 — 단계로 오르내린다
  onZoomSet,           // 핀치 — 연속 배율
  onZoomReset,
  onCollapse,
  t,
}) => {
  const padRef = useRef(null);
  // 커서는 **캔버스 요소 좌표**로 산다. 배율·뷰포트 변환은 noVNC 가 한다(vncSyntheticInput).
  const cursorRef = useRef({ x: 0, y: 0 });
  const dotRef = useRef(null);
  // 눌린 채 유지되는 버튼 마스크 — 드래그 잠금.
  const heldRef = useRef(0);
  const lockBtnRef = useRef(null);
  // 진행 중인 터치들. pointerId → 마지막 좌표.
  const pointersRef = useRef(new Map());
  const gestureRef = useRef({ startedAt: 0, distance: 0, pinchBase: 0, pinchZoom: 1, mode: 'none' });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const canvasOf = useCallback(() => findVncCanvas(getContainer?.()), [getContainer]);

  /** 화면의 점을 커서 자리로 옮긴다. React 상태를 쓰지 않는다 — 이동마다 리렌더는 사치다. */
  const paintCursor = useCallback((canvas) => {
    const dot = dotRef.current;
    if (!dot || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = cursorRef.current;
    dot.style.transform = `translate3d(${rect.left + x}px, ${rect.top + y}px, 0)`;
    dot.style.opacity = '1';
  }, []);

  /** 확대된 화면에서 커서가 밖으로 나가면 따라 스크롤한다 — 안 보이는 커서는 못 쓴다. */
  const followCursor = useCallback((canvas) => {
    const container = getContainer?.();
    const view = container?.parentElement;             // 스크롤을 가진 래퍼
    if (!view || !canvas) return;
    if (view.scrollWidth <= view.clientWidth && view.scrollHeight <= view.clientHeight) return;
    const canvasRect = canvas.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    const next = keepCursorVisible({
      cursor: cursorRef.current,
      canvasOffset: {
        x: canvasRect.left - viewRect.left + view.scrollLeft,
        y: canvasRect.top - viewRect.top + view.scrollTop,
      },
      view: { width: view.clientWidth, height: view.clientHeight },
      content: { width: view.scrollWidth, height: view.scrollHeight },
      scroll: { left: view.scrollLeft, top: view.scrollTop },
      margin: CURSOR_MARGIN,
    });
    if (next.left !== view.scrollLeft) view.scrollLeft = next.left;
    if (next.top !== view.scrollTop) view.scrollTop = next.top;
  }, [getContainer]);

  /** 첫 사용 시 커서를 화면 한가운데에 둔다 — 어디에 있는지 모르는 커서가 제일 나쁘다. */
  useEffect(() => {
    const canvas = canvasOf();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    cursorRef.current = clampCursor(
      { x: rect.width / 2, y: rect.height / 2 },
      { width: rect.width, height: rect.height },
    );
    paintCursor(canvas);
  }, [canvasOf, paintCursor]);

  const moveBy = useCallback((dx, dy) => {
    const canvas = canvasOf();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    cursorRef.current = moveCursor(cursorRef.current, { dx, dy }, {
      bounds: { width: rect.width, height: rect.height },
    });
    sendPointerMove(canvas, { ...cursorRef.current, buttons: heldRef.current });
    paintCursor(canvas);
    followCursor(canvas);
  }, [canvasOf, paintCursor, followCursor]);

  const clickAtCursor = useCallback((buttons) => {
    const canvas = canvasOf();
    if (!canvas) return;
    sendClick(canvas, { ...cursorRef.current, buttons });
  }, [canvasOf]);

  /** 드래그 잠금 — 버튼을 누른 상태로 두고 커서만 옮긴다(창 끌기·선택). */
  const toggleLock = useCallback(() => {
    const canvas = canvasOf();
    if (!canvas) return;
    if (heldRef.current) {
      sendPointerUp(canvas, { ...cursorRef.current, buttons: 0 });
      heldRef.current = 0;
    } else {
      sendPointerDown(canvas, { ...cursorRef.current, buttons: BUTTON_LEFT });
      heldRef.current = BUTTON_LEFT;
    }
    // 상태 표시는 DOM 을 직접 만진다 — 이 토글 하나로 pane 전체를 리렌더할 이유가 없다.
    if (lockBtnRef.current) {
      lockBtnRef.current.dataset.on = heldRef.current ? '1' : '';
      lockBtnRef.current.style.color = heldRef.current ? color.accent : color.subtext;
      lockBtnRef.current.style.borderColor = heldRef.current ? color.accent : color.border;
    }
  }, [canvasOf]);

  // 언마운트 때 눌린 버튼을 반드시 뗀다 — 남으면 원격에서 마우스가 눌린 채로 굳는다.
  useEffect(() => () => {
    if (!heldRef.current) return;
    const canvas = findVncCanvas(getContainer?.());
    if (canvas) sendPointerUp(canvas, { ...cursorRef.current, buttons: 0 });
    heldRef.current = 0;
  }, [getContainer]);

  const twoPointerCenter = () => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return null;
    return {
      a: points[0],
      b: points[1],
      mid: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
    };
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    padRef.current?.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      gestureRef.current = {
        startedAt: Date.now(), distance: 0, pinchBase: 0, pinchZoom: zoomRef.current, mode: 'move',
      };
    } else if (pointersRef.current.size === 2) {
      const pair = twoPointerCenter();
      gestureRef.current = {
        startedAt: Date.now(),
        distance: 0,
        pinchBase: pair ? touchDistance(pair.a, pair.b) : 0,
        pinchZoom: zoomRef.current,
        mode: 'two',
        midTravel: 0,
        lastMid: pair?.mid || null,
      };
    }
  };

  const onPointerMove = (e) => {
    const tracked = pointersRef.current.get(e.pointerId);
    if (!tracked) return;
    e.preventDefault();
    const dx = e.clientX - tracked.x;
    const dy = e.clientY - tracked.y;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gesture = gestureRef.current;
    gesture.distance += Math.hypot(dx, dy);

    if (pointersRef.current.size === 1 && gesture.mode === 'move') {
      moveBy(dx, dy);
      return;
    }
    if (pointersRef.current.size !== 2) return;

    const pair = twoPointerCenter();
    if (!pair) return;
    const spread = touchDistance(pair.a, pair.b);
    const base = gesture.pinchBase || spread;
    const midDy = gesture.lastMid ? pair.mid.y - gesture.lastMid.y : 0;
    const midDx = gesture.lastMid ? pair.mid.x - gesture.lastMid.x : 0;
    gesture.midTravel = (gesture.midTravel || 0) + Math.hypot(midDx, midDy);
    gesture.lastMid = pair.mid;

    /* 확대냐 스크롤이냐는 **한 제스처에 한 번만** 정한다. 매 이벤트마다 다시 판정하면
       손가락이 순차로 도착하는 동안 둘 사이를 오가며 화면이 떨린다. */
    if (gesture.mode === 'two') {
      gesture.mode = classifyTwoFinger({ spread, base, midTravel: gesture.midTravel });
      if (gesture.mode === 'pinch' && !canZoom) gesture.mode = 'scroll';
    }

    if (gesture.mode === 'pinch') {
      onZoomSet?.(clampZoom(gesture.pinchZoom * (base > 0 ? spread / base : 1)));
      return;
    }
    const canvas = canvasOf();
    if (canvas && (midDy || midDx)) {
      sendWheel(canvas, {
        ...cursorRef.current,
        // 손가락을 위로 밀면 내용이 위로 = 휠 아래. 방향을 뒤집지 않는다(네이티브 스크롤과 같게).
        deltaY: -scrollDeltaFor(midDy),
        deltaX: -scrollDeltaFor(midDx),
      });
    }
  };

  const endPointer = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    e.preventDefault();
    const gesture = gestureRef.current;
    const wasTwo = pointersRef.current.size === 2;
    pointersRef.current.delete(e.pointerId);
    padRef.current?.releasePointerCapture?.(e.pointerId);

    const elapsedMs = Date.now() - gesture.startedAt;
    const tapped = isTapGesture({ distance: gesture.distance, elapsedMs });
    if (pointersRef.current.size > 0) return;      // 아직 손가락이 남았다 — 판정은 마지막에

    if (gesture.mode === 'pinch') return;
    if (!tapped) return;
    // 두 손가락 탭 = 오른쪽 클릭, 한 손가락 탭 = 왼쪽 클릭. 드래그 잠금 중에는 클릭을 보내지
    // 않는다 — 이미 버튼이 눌린 상태이고, 거기에 클릭을 얹으면 더블클릭이 된다.
    if (heldRef.current) return;
    clickAtCursor(wasTwo || gesture.mode === 'two' ? BUTTON_RIGHT : BUTTON_LEFT);
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  return (
    <>
      {/* 커서 표식 — position:fixed 라 스크롤·오프셋 계산이 필요 없다(캔버스 화면 좌표 그대로). */}
      <div
        ref={dotRef}
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '18px',
          height: '18px',
          marginLeft: '-9px',
          marginTop: '-9px',
          borderRadius: '50%',
          border: `2px solid ${color.accent}`,
          background: `color-mix(in srgb, ${color.accent} 22%, transparent)`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
          opacity: 0,
          zIndex: 30,
          transition: 'opacity 160ms',
        }}
      />

      <div style={S.bar}>
        <div style={S.controls}>
          <button type="button" style={S.iconBtn} onClick={() => onZoomStep?.(-1)}
            title={t?.('vncZoomOut') || 'Zoom out'} aria-label={t?.('vncZoomOut') || 'Zoom out'}
            disabled={!canZoom}>
            <Minus size={14} strokeWidth={2} />
          </button>
          <span style={S.zoomLabel}>{zoomLabel}</span>
          <button type="button" style={S.iconBtn} onClick={() => onZoomStep?.(1)}
            title={t?.('vncZoomIn') || 'Zoom in'} aria-label={t?.('vncZoomIn') || 'Zoom in'}
            disabled={!canZoom}>
            <Plus size={14} strokeWidth={2} />
          </button>
          <button type="button" style={S.iconBtn} onClick={() => onZoomReset?.()}
            title={t?.('vncZoomFit') || 'Fit to screen'} aria-label={t?.('vncZoomFit') || 'Fit to screen'}
            disabled={!canZoom}>
            <Maximize size={13} strokeWidth={2} />
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={S.iconBtn} onClick={() => onCollapse?.()}
            title={t?.('vncHideTouchpad') || 'Hide touchpad'}
            aria-label={t?.('vncHideTouchpad') || 'Hide touchpad'}>
            <ChevronDown size={14} strokeWidth={2} />
          </button>
        </div>

        <div
          ref={padRef}
          style={S.pad}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          role="application"
          aria-label={t?.('vncTouchpad') || 'Touchpad'}
        >
          <MousePointer2 size={15} strokeWidth={1.8} style={{ color: color.faint }} />
          <span style={S.padHint}>{t?.('vncTouchpadHint') || 'Slide to move · tap to click'}</span>
        </div>

        <div style={S.buttons}>
          <button type="button" style={S.actionBtn} onClick={() => clickAtCursor(BUTTON_LEFT)}>
            {t?.('vncLeftClick') || 'Left'}
          </button>
          <button
            type="button"
            ref={lockBtnRef}
            style={{ ...S.actionBtn, gap: '5px' }}
            onClick={toggleLock}
            title={t?.('vncDragLockHint') || 'Hold the button down so you can drag'}
          >
            <Lock size={12} strokeWidth={2} />
            {t?.('vncDragLock') || 'Drag'}
          </button>
          <button type="button" style={S.actionBtn} onClick={() => clickAtCursor(BUTTON_RIGHT)}>
            {t?.('vncRightClick') || 'Right'}
          </button>
        </div>
      </div>
    </>
  );
};

const S = {
  bar: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
    padding: space['2'],
    background: color.surface0,
    borderTop: `1px solid ${color.border}`,
    // 터치 조작 영역이므로 브라우저 기본 제스처(스크롤·더블탭 확대)를 넘기지 않는다.
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
  },
  zoomLabel: {
    minWidth: '44px',
    textAlign: 'center',
    fontFamily: font.mono,
    fontSize: fontSize['11'],
    color: color.subtext,
  },
  iconBtn: {
    width: '30px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: color.subtext,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    padding: 0,
  },
  pad: {
    flex: 1,
    minHeight: '96px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    background: `color-mix(in srgb, ${color.surface1} 45%, transparent)`,
    border: `1px dashed ${color.border}`,
    borderRadius: radius.md,
    touchAction: 'none',
    cursor: 'grab',
  },
  padHint: {
    fontFamily: font.sans,
    fontSize: fontSize['10'],
    color: color.faint,
    pointerEvents: 'none',
  },
  buttons: {
    display: 'flex',
    gap: space['1.5'],
  },
  actionBtn: {
    flex: 1,
    height: '34px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface1,
    color: color.subtext,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontFamily: font.sans,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    cursor: 'pointer',
  },
};

export default VncTouchpad;
