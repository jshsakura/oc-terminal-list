import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VncTouchpad from './VncTouchpad';

/* noVNC 캔버스 대역. 실제 noVNC 가 듣는 이벤트만 기록한다 — 이 컴포넌트의 계약은
   "캔버스에 그 이벤트가, 그 좌표로, 그 버튼으로 도착한다" 이다. */
const CANVAS_RECT = { left: 0, top: 0, width: 800, height: 600 };

const setup = (props = {}) => {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({
    ...CANVAS_RECT,
    right: CANVAS_RECT.width, bottom: CANVAS_RECT.height, x: 0, y: 0,
  });
  container.appendChild(canvas);
  document.body.appendChild(container);

  const seen = [];
  for (const type of ['mousedown', 'mouseup', 'mousemove', 'wheel']) {
    canvas.addEventListener(type, (e) => seen.push({
      type: e.type, clientX: e.clientX, clientY: e.clientY,
      buttons: e.buttons, deltaY: e.deltaY,
    }));
  }
  const utils = render(
    <VncTouchpad getContainer={() => container} t={(k) => k} {...props} />,
  );
  return { ...utils, canvas, seen, container };
};

// jsdom 은 포인터 캡처 API 가 없다 — 컴포넌트는 optional call 이라 없어도 동작해야 한다.
const pad = () => screen.getByRole('application');

const down = (el, { id = 1, x = 100, y = 100 } = {}) => fireEvent.pointerDown(el, {
  pointerId: id, clientX: x, clientY: y,
});
const move = (el, { id = 1, x, y }) => fireEvent.pointerMove(el, {
  pointerId: id, clientX: x, clientY: y,
});
const up = (el, { id = 1, x = 100, y = 100 } = {}) => fireEvent.pointerUp(el, {
  pointerId: id, clientX: x, clientY: y,
});

describe('VncTouchpad', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('커서는 화면 한가운데에서 시작한다 — 어디 있는지 모르는 커서가 제일 나쁘다', () => {
    const { seen } = setup();
    down(pad());
    move(pad(), { x: 101, y: 100 });
    // 중앙(400,300)에서 오른쪽으로만 움직였다.
    expect(seen[0].type).toBe('mousemove');
    expect(seen[0].clientX).toBeGreaterThan(400);
    expect(seen[0].clientY).toBe(300);
  });

  it('손가락보다 커서가 더 간다 — 그게 작은 화면에서 정확도를 얻는 방법이다', () => {
    const { seen } = setup();
    down(pad());
    move(pad(), { x: 120, y: 100 });
    expect(seen[0].clientX - 400).toBeGreaterThan(20);
  });

  it('톡 치면 왼쪽 클릭 — 이동 → 누름 → 뗌', () => {
    const { seen } = setup();
    down(pad());
    up(pad());
    expect(seen.map((e) => e.type)).toEqual(['mousemove', 'mousedown', 'mouseup']);
    expect(seen[1].buttons).toBe(1);
  });

  it('끌고 나서 떼면 클릭이 아니다 — 이동 끝에 클릭이 딸려 나가면 안 된다', () => {
    const { seen } = setup();
    down(pad());
    move(pad(), { x: 300, y: 260 });
    up(pad(), { x: 300, y: 260 });
    expect(seen.some((e) => e.type === 'mousedown')).toBe(false);
  });

  it('두 손가락 탭은 오른쪽 클릭', () => {
    const { seen } = setup();
    down(pad(), { id: 1, x: 100, y: 100 });
    down(pad(), { id: 2, x: 140, y: 100 });
    up(pad(), { id: 2, x: 140, y: 100 });
    up(pad(), { id: 1, x: 100, y: 100 });
    const clicks = seen.filter((e) => e.type === 'mousedown');
    expect(clicks).toHaveLength(1);
    expect(clicks[0].buttons).toBe(2);
  });

  it('두 손가락을 함께 밀면 휠 — 손가락 방향과 화면 방향이 같다', () => {
    const { seen } = setup();
    down(pad(), { id: 1, x: 100, y: 200 });
    down(pad(), { id: 2, x: 140, y: 200 });
    move(pad(), { id: 1, x: 100, y: 160 });
    move(pad(), { id: 2, x: 140, y: 160 });
    const wheels = seen.filter((e) => e.type === 'wheel');
    expect(wheels.length).toBeGreaterThan(0);
    expect(wheels[wheels.length - 1].deltaY).toBeGreaterThan(0);   // 위로 밀면 아래로 스크롤
  });

  it('두 손가락을 벌리면 확대를 요청한다 (스크롤이 아니라)', () => {
    const onZoomSet = vi.fn();
    setup({ onZoomSet, zoom: 1 });
    down(pad(), { id: 1, x: 200, y: 200 });
    down(pad(), { id: 2, x: 240, y: 200 });
    move(pad(), { id: 2, x: 400, y: 200 });
    expect(onZoomSet).toHaveBeenCalled();
    expect(onZoomSet.mock.calls.at(-1)[0]).toBeGreaterThan(1);
  });

  it('끌기 잠금은 버튼을 누른 채로 둔다 — 그 상태에서 이동은 드래그다', () => {
    const { seen } = setup();
    fireEvent.click(screen.getByText('vncDragLock'));
    expect(seen.at(-1)).toMatchObject({ type: 'mousedown', buttons: 1 });
    down(pad());
    move(pad(), { x: 130, y: 100 });
    expect(seen.at(-1)).toMatchObject({ type: 'mousemove', buttons: 1 });
    fireEvent.click(screen.getByText('vncDragLock'));
    expect(seen.at(-1)).toMatchObject({ type: 'mouseup', buttons: 0 });
  });

  it('잠금 중 언마운트해도 버튼을 뗀다 — 안 그러면 원격 마우스가 눌린 채 굳는다', () => {
    const { seen, unmount } = setup();
    fireEvent.click(screen.getByText('vncDragLock'));
    unmount();
    expect(seen.at(-1)).toMatchObject({ type: 'mouseup', buttons: 0 });
  });

  it('버튼으로도 클릭할 수 있다 — 한 손으로 쓰는 사람이 있다', () => {
    const { seen } = setup();
    fireEvent.click(screen.getByText('vncRightClick'));
    expect(seen.filter((e) => e.type === 'mousedown').at(-1).buttons).toBe(2);
  });

  it('확대 버튼은 단계 이동을 요청한다', () => {
    const onZoomStep = vi.fn();
    setup({ onZoomStep });
    fireEvent.click(screen.getByTitle('vncZoomIn'));
    expect(onZoomStep).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTitle('vncZoomOut'));
    expect(onZoomStep).toHaveBeenCalledWith(-1);
  });

  it('연결 전(캔버스 없음)에도 죽지 않는다', () => {
    const empty = document.createElement('div');
    expect(() => {
      render(<VncTouchpad getContainer={() => empty} t={(k) => k} />);
      fireEvent.click(screen.getAllByText('vncLeftClick')[0]);
    }).not.toThrow();
  });
});
