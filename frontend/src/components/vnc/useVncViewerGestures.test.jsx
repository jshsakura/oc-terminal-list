import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import useVncViewerGestures from './useVncViewerGestures';

/* jsdom 에는 TouchEvent 가 없다. 훅이 읽는 필드(touches/changedTouches)만 갖춘 대역을 쓴다 —
   실제 브라우저에서도 훅은 이 두 필드밖에 안 본다. */
class FakeTouchEvent extends Event {
  constructor(type, init = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.touches = init.touches || [];
    this.changedTouches = init.changedTouches || [];
  }
}

const touch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });

const Harness = ({ onZoom, zoom = 1, enabled = true, onCanvasEvent }) => {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  useVncViewerGestures({
    viewportRef,
    getCanvas: () => canvasRef.current,
    getZoom: () => zoom,
    onZoom,
    enabled,
  });
  return (
    <div ref={viewportRef} data-testid="view" style={{ width: 300, height: 300 }}>
      <div>
        <canvas
          ref={canvasRef}
          data-testid="canvas"
          onTouchStart={onCanvasEvent}
          onTouchMove={onCanvasEvent}
        />
      </div>
    </div>
  );
};

const setup = (props = {}) => {
  const utils = render(<Harness {...props} />);
  const view = utils.getByTestId('view');
  const canvas = utils.getByTestId('canvas');
  // 스크롤 가능한 상태를 흉내낸다(jsdom 은 레이아웃이 없어 scrollLeft 가 그냥 값이다).
  view.scrollLeft = 0;
  view.scrollTop = 0;
  return { ...utils, view, canvas };
};

beforeEach(() => {
  global.TouchEvent = FakeTouchEvent;
});

const fire = (el, type, touches) => el.dispatchEvent(new FakeTouchEvent(type, {
  touches, changedTouches: touches,
}));

describe('useVncViewerGestures', () => {
  it('두 손가락은 캔버스에 닿지 않는다 — noVNC 가 원격에 Ctrl+휠을 쏘는 것을 막는다', () => {
    const onCanvasEvent = vi.fn();
    const { view } = setup({ onCanvasEvent });
    fire(view, 'touchstart', [touch(1, 100, 100), touch(2, 200, 100)]);
    expect(onCanvasEvent).not.toHaveBeenCalled();
  });

  it('가로챌 때 noVNC 에 touchcancel 을 보낸다 — 안 보내면 원격에 드래그가 새어 나간다', () => {
    const seen = [];
    const { view, canvas } = setup();
    canvas.addEventListener('touchcancel', (e) => seen.push(e.type));
    fire(view, 'touchstart', [touch(1, 100, 100), touch(2, 200, 100)]);
    expect(seen).toEqual(['touchcancel']);
  });

  it('벌리면 확대를 요청한다 — 화면에서 바로 핀치가 먹는다', () => {
    const onZoom = vi.fn();
    const { view } = setup({ onZoom, zoom: 1 });
    fire(view, 'touchstart', [touch(1, 100, 100), touch(2, 200, 100)]);   // 간격 100
    fire(view, 'touchmove', [touch(1, 50, 100), touch(2, 250, 100)]);     // 간격 200
    expect(onZoom).toHaveBeenCalled();
    expect(onZoom.mock.calls.at(-1)[0]).toBeCloseTo(2, 1);
  });

  it('오므리면 축소된다', () => {
    const onZoom = vi.fn();
    const { view } = setup({ onZoom, zoom: 4 });
    fire(view, 'touchstart', [touch(1, 0, 0), touch(2, 200, 0)]);
    fire(view, 'touchmove', [touch(1, 50, 0), touch(2, 150, 0)]);
    expect(onZoom.mock.calls.at(-1)[0]).toBeLessThan(4);
  });

  it('두 손가락을 밀면 화면이 따라온다 — 확대한 뒤 이동이 이걸로 된다', () => {
    const { view } = setup({ zoom: 2 });
    fire(view, 'touchstart', [touch(1, 100, 100), touch(2, 200, 100)]);
    fire(view, 'touchmove', [touch(1, 60, 70), touch(2, 160, 70)]);       // 중점이 -40,-30
    expect(view.scrollLeft).toBe(40);
    expect(view.scrollTop).toBe(30);
  });

  it('한 손가락은 그대로 통과한다 — 원격 클릭·드래그는 noVNC 몫이다', () => {
    const onCanvasEvent = vi.fn();
    const { canvas } = setup({ onCanvasEvent });
    canvas.dispatchEvent(new FakeTouchEvent('touchstart', { touches: [touch(1, 10, 10)] }));
    expect(onCanvasEvent).toHaveBeenCalled();
  });

  it('마지막 손가락을 뗄 때까지 삼킨다 — 남은 손가락이 떼어지며 뭔가를 누르면 안 된다', () => {
    const onCanvasEvent = vi.fn();
    const { view, canvas } = setup({ onCanvasEvent });
    fire(view, 'touchstart', [touch(1, 100, 100), touch(2, 200, 100)]);
    // 한 손가락만 뗀 상태 — 아직 하나 남았다
    view.dispatchEvent(new FakeTouchEvent('touchend', {
      touches: [touch(1, 100, 100)], changedTouches: [touch(2, 200, 100)],
    }));
    canvas.dispatchEvent(new FakeTouchEvent('touchmove', { touches: [touch(1, 120, 100)] }));
    // 남은 손가락의 움직임이 캔버스로 새면 원격이 드래그된다
    const leaked = onCanvasEvent.mock.calls.length;
    view.dispatchEvent(new FakeTouchEvent('touchend', { touches: [], changedTouches: [touch(1, 120, 100)] }));
    expect(leaked).toBe(0);
  });

  it('꺼져 있으면(데스크탑 pane) 아무것도 가로채지 않는다', () => {
    const onCanvasEvent = vi.fn();
    const onZoom = vi.fn();
    const { view } = setup({ onCanvasEvent, onZoom, enabled: false });
    fire(view, 'touchstart', [touch(1, 100, 100), touch(2, 200, 100)]);
    fire(view, 'touchmove', [touch(1, 50, 100), touch(2, 250, 100)]);
    expect(onZoom).not.toHaveBeenCalled();
  });
});
