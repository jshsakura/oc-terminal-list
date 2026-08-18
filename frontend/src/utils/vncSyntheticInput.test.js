import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT,
  findVncCanvas, sendClick, sendPointerDown, sendPointerMove, sendPointerUp, sendWheel,
} from './vncSyntheticInput';

/* noVNC 캔버스 대역 — 실제 noVNC 가 듣는 이벤트 이름과 필드만 흉내낸다.
   getBoundingClientRect 를 고정해 좌표 변환을 정확히 잴 수 있게 한다. */
const makeCanvas = (rect = { left: 100, top: 50 }) => {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({
    left: rect.left, top: rect.top, width: 800, height: 600,
    right: rect.left + 800, bottom: rect.top + 600, x: rect.left, y: rect.top,
  });
  const seen = [];
  for (const type of ['mousedown', 'mouseup', 'mousemove', 'wheel']) {
    canvas.addEventListener(type, (e) => seen.push({
      type: e.type,
      clientX: e.clientX,
      clientY: e.clientY,
      buttons: e.buttons,
      button: e.button,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    }));
  }
  return { canvas, seen };
};

let canvas;
let seen;
beforeEach(() => { ({ canvas, seen } = makeCanvas()); });

describe('findVncCanvas', () => {
  it('컨테이너 안의 캔버스를 찾는다 — 사설 필드(rfb._canvas)를 안 건드리는 이유', () => {
    const container = document.createElement('div');
    const inner = document.createElement('canvas');
    container.appendChild(inner);
    expect(findVncCanvas(container)).toBe(inner);
  });

  it('연결 전(캔버스 없음)에도 죽지 않는다', () => {
    expect(findVncCanvas(document.createElement('div'))).toBeNull();
    expect(findVncCanvas(null)).toBeNull();
  });
});

describe('좌표 변환', () => {
  it('캔버스 좌표에 요소 위치를 더해 화면 좌표로 보낸다 — noVNC 가 다시 되돌린다', () => {
    sendPointerMove(canvas, { x: 10, y: 20 });
    expect(seen[0]).toMatchObject({ type: 'mousemove', clientX: 110, clientY: 70 });
  });

  it('캔버스가 없으면 조용히 false — 연결 전 조작이 예외가 되면 안 된다', () => {
    expect(sendPointerMove(null, { x: 1, y: 1 })).toBe(false);
    expect(sendWheel(null, { x: 1, y: 1, deltaY: 1 })).toBe(false);
  });
});

describe('클릭', () => {
  it('이동 → 누름 → 뗌 순서로 보낸다 (호버가 있어야 열리는 메뉴가 있다)', () => {
    sendClick(canvas, { x: 5, y: 5 });
    expect(seen.map((e) => e.type)).toEqual(['mousemove', 'mousedown', 'mouseup']);
    expect(seen[1].buttons).toBe(BUTTON_LEFT);
    expect(seen[2].buttons).toBe(0);       // 뗀 뒤에는 눌린 버튼이 없다
  });

  it('오른쪽·가운데 버튼은 buttons 비트와 button 번호가 둘 다 맞아야 한다', () => {
    sendClick(canvas, { x: 1, y: 1, buttons: BUTTON_RIGHT });
    expect(seen[1]).toMatchObject({ buttons: BUTTON_RIGHT, button: 2 });
    seen.length = 0;
    sendClick(canvas, { x: 1, y: 1, buttons: BUTTON_MIDDLE });
    expect(seen[1]).toMatchObject({ buttons: BUTTON_MIDDLE, button: 1 });
  });
});

describe('드래그 잠금', () => {
  it('누른 채 이동하면 buttons 가 유지된다 — 창 끌기가 이걸로 된다', () => {
    sendPointerDown(canvas, { x: 0, y: 0 });
    sendPointerMove(canvas, { x: 50, y: 0, buttons: BUTTON_LEFT });
    sendPointerUp(canvas, { x: 50, y: 0 });
    expect(seen.map((e) => [e.type, e.buttons])).toEqual([
      ['mousedown', BUTTON_LEFT],
      ['mousemove', BUTTON_LEFT],
      ['mouseup', 0],
    ]);
  });
});

describe('휠', () => {
  it('픽셀 단위 델타를 그대로 넘긴다 — 스텝 변환은 noVNC 몫이다', () => {
    sendWheel(canvas, { x: 3, y: 4, deltaY: -30 });
    expect(seen[0]).toMatchObject({ type: 'wheel', deltaY: -30, clientX: 103, clientY: 54 });
  });
});
