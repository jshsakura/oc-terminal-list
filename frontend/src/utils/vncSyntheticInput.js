/**
 * 터치패드 → noVNC 로 포인터 입력을 넣는 통로.
 *
 * **noVNC 에는 공개 포인터 API 가 없다.** RFB 가 공개하는 것은 sendKey / clipboardPasteFrom
 * 정도이고, 마우스는 전부 캔버스의 DOM 이벤트 핸들러(`mousedown/mouseup/mousemove/wheel`)
 * 안에서 처리된다. 그래서 우리는 **그 핸들러가 듣는 바로 그 이벤트를 만들어 캔버스에 보낸다.**
 * 사설 필드(`rfb._display`, `rfb._canvas`)를 건드리는 대신 컨테이너에서 `querySelector`
 * 로 찾은 캔버스에 dispatch 하므로, noVNC 내부 구조가 바뀌어도 깨질 표면이 가장 작다.
 *
 * 좌표 규칙: 커서는 **캔버스 요소 좌표(CSS px)** 로 관리한다. noVNC 가
 * `clientToElement()` 로 화면 좌표를 요소 좌표로 되돌린 뒤 자기 배율·뷰포트를 적용하므로,
 * 우리는 배율을 알 필요가 전혀 없다 — 확대/축소/pan 어느 상태에서도 같은 코드가 맞는다.
 *
 * 버튼 비트는 `MouseEvent.buttons` 규약이다(noVNC `_convertButtonMask` 가 이걸 RFB 마스크로
 * 바꾼다): 1=왼쪽, 2=오른쪽, 4=가운데.
 */

export const BUTTON_LEFT = 1;
export const BUTTON_RIGHT = 2;
export const BUTTON_MIDDLE = 4;

/** `MouseEvent.button`(단일 번호)은 buttons 비트와 다르다 — 오른쪽은 2, 가운데는 1. */
const buttonIndexFor = (buttons) => {
  if (buttons & BUTTON_RIGHT) return 2;
  if (buttons & BUTTON_MIDDLE) return 1;
  return 0;
};

/** 컨테이너 안의 noVNC 캔버스. 아직 연결 전이면 null. */
export const findVncCanvas = (container) => container?.querySelector?.('canvas') || null;

const dispatchMouse = (canvas, type, { x, y, buttons = 0 }) => {
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return false;
  const rect = canvas.getBoundingClientRect();
  const event = new MouseEvent(type, {
    // 캔버스 요소 좌표 → 화면 좌표. noVNC 가 다시 요소 좌표로 되돌린다.
    clientX: rect.left + x,
    clientY: rect.top + y,
    buttons,
    button: buttonIndexFor(buttons),
    bubbles: true,
    cancelable: true,
    // `view` 는 일부러 뺀다 — noVNC 는 clientX/clientY/buttons/type 만 읽고,
    // jsdom 은 진짜 Window 가 아닌 값을 거절해 테스트만 깨진다.
  });
  canvas.dispatchEvent(event);
  return true;
};

/** 커서 이동. `buttons` 를 유지하면 버튼을 누른 채 끄는 드래그가 된다. */
export const sendPointerMove = (canvas, { x, y, buttons = 0 }) => (
  dispatchMouse(canvas, 'mousemove', { x, y, buttons })
);

/** 버튼 누름/뗌을 따로 — 드래그 잠금처럼 상태를 오래 유지하는 조작에 쓴다. */
export const sendPointerDown = (canvas, { x, y, buttons = BUTTON_LEFT }) => (
  dispatchMouse(canvas, 'mousedown', { x, y, buttons })
);

export const sendPointerUp = (canvas, { x, y, buttons = 0 }) => (
  dispatchMouse(canvas, 'mouseup', { x, y, buttons })
);

/**
 * 한 번의 클릭 = 이동 + 누름 + 뗌.
 *
 * 이동을 먼저 보내는 이유: 원격 쪽은 커서가 그 자리에 **있었다**는 것을 알아야 한다.
 * 누름만 보내면 호버 상태가 없던 메뉴가 열리지 않는 앱이 있다.
 */
export const sendClick = (canvas, { x, y, buttons = BUTTON_LEFT }) => {
  if (!sendPointerMove(canvas, { x, y, buttons: 0 })) return false;
  sendPointerDown(canvas, { x, y, buttons });
  sendPointerUp(canvas, { x, y, buttons: 0 });
  return true;
};

/** 두 손가락 스크롤 → 휠. noVNC 가 누적해서 스텝으로 바꾼다(WHEEL_STEP). */
export const sendWheel = (canvas, { x, y, deltaX = 0, deltaY = 0 }) => {
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return false;
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent('wheel', {
    clientX: rect.left + x,
    clientY: rect.top + y,
    deltaX,
    deltaY,
    deltaMode: 0,            // 픽셀 단위 — noVNC 가 라인 단위면 곱해서 쓴다
    bubbles: true,
    cancelable: true,
  }));
  return true;
};
