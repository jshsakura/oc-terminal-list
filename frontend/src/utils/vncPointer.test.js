import { describe, it, expect } from 'vitest';
import {
  accelerationFor,
  clampCursor,
  classifyTwoFinger,
  clampZoom,
  isTapGesture,
  keepCursorVisible,
  moveCursor,
  nextZoom,
  scrollDeltaFor,
  touchDistance,
  POINTER_SENSITIVITY,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  ZOOM_STEPS,
} from './vncPointer';

const BOUNDS = { width: 800, height: 600 };

describe('clampCursor', () => {
  it('캔버스 밖으로 나가지 않는다 — 나가면 보이는 커서와 눌리는 지점이 어긋난다', () => {
    expect(clampCursor({ x: -50, y: -10 }, BOUNDS)).toEqual({ x: 0, y: 0 });
    expect(clampCursor({ x: 9999, y: 9999 }, BOUNDS)).toEqual({ x: 799, y: 599 });
  });

  it('크기가 0 이어도 죽지 않는다(연결 직후 캔버스가 아직 0×0 이다)', () => {
    expect(clampCursor({ x: 10, y: 10 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('accelerationFor', () => {
  it('느린 이동은 기본 감도 그대로 — 작은 버튼을 맞출 수 있어야 한다', () => {
    expect(accelerationFor(0)).toBeCloseTo(POINTER_SENSITIVITY);
  });

  it('빠를수록 배수가 커지되 상한이 있다 — 무한 가속은 못 쓴다', () => {
    const slow = accelerationFor(2);
    const fast = accelerationFor(40);
    const faster = accelerationFor(4000);
    expect(fast).toBeGreaterThan(slow);
    expect(faster).toBeCloseTo(fast);          // 이미 상한
  });
});

describe('moveCursor', () => {
  it('원본을 고치지 않고 새 위치를 준다', () => {
    const cursor = { x: 100, y: 100 };
    const next = moveCursor(cursor, { dx: 10, dy: 0 }, { bounds: BOUNDS });
    expect(cursor).toEqual({ x: 100, y: 100 });
    expect(next.x).toBeGreaterThan(100);
  });

  it('감도만큼 손가락보다 멀리 간다 — 그게 트랙패드가 작은 화면을 이기는 방법이다', () => {
    const next = moveCursor({ x: 0, y: 0 }, { dx: 10, dy: 0 }, { bounds: BOUNDS });
    expect(next.x).toBeGreaterThan(10);
  });

  it('경계에서 멈춘다', () => {
    const next = moveCursor({ x: 790, y: 0 }, { dx: 100, dy: 0 }, { bounds: BOUNDS });
    expect(next.x).toBe(799);
  });
});

describe('isTapGesture', () => {
  it('짧고 안 움직였으면 클릭', () => {
    expect(isTapGesture({ distance: 3, elapsedMs: 90 })).toBe(true);
  });

  it('길게 눌렀거나 움직였으면 클릭이 아니다 — 이동 끝에 클릭이 딸려 나가면 안 된다', () => {
    expect(isTapGesture({ distance: TAP_SLOP_PX + 1, elapsedMs: 90 })).toBe(false);
    expect(isTapGesture({ distance: 2, elapsedMs: TAP_MAX_MS + 1 })).toBe(false);
  });
});

describe('nextZoom / clampZoom', () => {
  it('단계를 오르내린다', () => {
    expect(nextZoom(1, 1)).toBe(ZOOM_STEPS[1]);
    expect(nextZoom(ZOOM_STEPS[1], -1)).toBe(1);
  });

  it('끝에서 더 가지 않는다', () => {
    expect(nextZoom(1, -1)).toBe(1);
    const last = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    expect(nextZoom(last, 1)).toBe(last);
  });

  it('핀치로 생긴 중간 배율에서도 가장 가까운 단계 기준으로 움직인다', () => {
    expect(nextZoom(1.9, 1)).toBe(3);      // 2 다음
    expect(nextZoom(1.9, -1)).toBe(1.5);   // 2 이전
  });

  it('임의 배율은 목록 범위로 자른다', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(clampZoom(1.7)).toBe(1.7);      // 중간 배율은 그대로 — 핀치는 연속이다
  });
});

describe('keepCursorVisible', () => {
  const view = { width: 400, height: 300 };
  const content = { width: 1200, height: 900 };

  it('커서가 오른쪽 밖으로 나가면 따라 스크롤한다 — 안 보이는 커서는 조작 불가다', () => {
    const next = keepCursorVisible({
      cursor: { x: 900, y: 100 },
      view,
      content,
      scroll: { left: 0, top: 0 },
      margin: 40,
    });
    expect(next.left).toBe(900 + 40 - 400);
    expect(next.top).toBe(0);
  });

  it('보이는 동안에는 스크롤을 건드리지 않는다 — 따라다니면 화면이 멀미난다', () => {
    const next = keepCursorVisible({
      cursor: { x: 200, y: 150 },
      view,
      content,
      scroll: { left: 0, top: 0 },
    });
    expect(next).toEqual({ left: 0, top: 0 });
  });

  it('스크롤이 음수가 되거나 콘텐츠를 넘지 않는다', () => {
    const atStart = keepCursorVisible({
      cursor: { x: 0, y: 0 }, view, content, scroll: { left: 100, top: 100 },
    });
    expect(atStart.left).toBe(0);
    const atEnd = keepCursorVisible({
      cursor: { x: 1199, y: 899 }, view, content, scroll: { left: 0, top: 0 },
    });
    expect(atEnd.left).toBe(content.width - view.width);
    expect(atEnd.top).toBe(content.height - view.height);
  });

  it('캔버스가 콘텐츠 안에서 밀려 있으면 그만큼 더한다(가운데 정렬된 캔버스)', () => {
    const next = keepCursorVisible({
      cursor: { x: 0, y: 0 },
      canvasOffset: { x: 500, y: 0 },
      view,
      content,
      scroll: { left: 0, top: 0 },
      margin: 20,
    });
    expect(next.left).toBe(500 + 20 - 400);
  });
});

describe('scrollDeltaFor / touchDistance', () => {
  it('두 손가락 이동은 방향을 유지한 채 배수만 붙는다', () => {
    expect(scrollDeltaFor(10)).toBeGreaterThan(10);
    expect(scrollDeltaFor(-10)).toBeLessThan(-10);
    expect(scrollDeltaFor(0)).toBe(0);
  });

  it('두 점 거리 — 핀치 배율의 기준', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('classifyTwoFinger', () => {
  it('중점은 가만히 있고 간격만 벌어지면 확대', () => {
    expect(classifyTwoFinger({ spread: 200, base: 100, midTravel: 2 })).toBe('pinch');
  });

  it('간격이 그대로고 중점이 움직이면 스크롤', () => {
    expect(classifyTwoFinger({ spread: 101, base: 100, midTravel: 60 })).toBe('scroll');
  });

  it('손가락이 순차로 도착해 간격이 흔들려도, 중점이 더 움직였으면 스크롤이다', () => {
    // 실제로 이것 때문에 두 손가락 스크롤이 확대로 튀었다 — 포인터 이벤트는 하나씩 온다.
    expect(classifyTwoFinger({ spread: 56.6, base: 40, midTravel: 20 })).toBe('scroll');
  });

  it('기준 간격을 모르면(0) 확대로 넘기지 않는다', () => {
    expect(classifyTwoFinger({ spread: 100, base: 0, midTravel: 0 })).toBe('scroll');
  });
});
