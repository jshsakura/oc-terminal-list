/**
 * 모바일 VNC 조작의 계산부 — 터치패드(상대 이동 커서)와 뷰어 확대.
 *
 * 왜 필요한가: noVNC 의 터치 입력은 전부 **절대 좌표 탭**이다. 1920px 데스크탑을 폭 400px
 * pane 에 맞춰 띄우면 화면 배율이 0.2 라 손가락 하나가 5px 이 아니라 **5px×5 = 원격 25px**
 * 을 덮는다. 창 닫기 버튼을 누르려면 손가락 끝의 1/4 정확도가 필요하다는 뜻이고, 그래서
 * 폰에서 "조작이 안 된다" 가 된다.
 *
 * 노트북 트랙패드가 이 문제를 이미 푼 방식을 그대로 쓴다: **손가락 위치가 아니라 손가락의
 * 이동량**으로 커서를 옮긴다. 화면 어디를 만지든 상관없고, 정확도는 배율이 아니라 감도가
 * 정한다. 느리게 밀면 정밀, 빠르게 튕기면 멀리 — 가속이 그 둘을 한 손가락으로 겸하게 한다.
 *
 * 여기 있는 것은 전부 순수 함수다. DOM 이벤트 배선과 합성 이벤트 발사는 VncTouchpad 가 한다.
 */

/** 기본 감도 — 1px 손가락 이동이 커서 1.6px. 값을 올리면 빨라지고 정밀도가 준다. */
export const POINTER_SENSITIVITY = 1.6;
/** 가속 상한. 빠른 플릭이 기본 감도의 최대 (1+ACCEL_MAX) 배까지 간다. */
export const POINTER_ACCEL_MAX = 1.6;
/** 이 픽셀 이상 움직인 이벤트부터 가속이 붙기 시작한다. */
export const POINTER_ACCEL_PIVOT = 12;

/** 탭 판정 — 이 시간 안에, 이 거리 안에서 끝나면 클릭이다. */
export const TAP_MAX_MS = 260;
export const TAP_SLOP_PX = 12;

/** 두 손가락 세로 이동 → 휠. 손가락 픽셀을 휠 델타로 바꾸는 배수. */
export const SCROLL_SENSITIVITY = 1.2;

/** 확대 단계. 1 = 맞춤(전체 보기), 그 위는 맞춤 대비 배율이다. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/**
 * 커서를 캔버스 밖으로 내보내지 않는다.
 *
 * 경계에서 멈추는 것이 중요하다 — noVNC 의 `clientToElement` 는 밖으로 나간 좌표를 가장자리로
 * 접어버리므로, 우리가 커서를 밖에 두면 화면의 커서와 실제로 눌리는 지점이 어긋난다.
 */
export const clampCursor = (pos, bounds) => {
  const maxX = Math.max(0, (bounds?.width || 0) - 1);
  const maxY = Math.max(0, (bounds?.height || 0) - 1);
  return {
    x: Math.min(Math.max(pos?.x || 0, 0), maxX),
    y: Math.min(Math.max(pos?.y || 0, 0), maxY),
  };
};

/**
 * 이벤트 하나의 이동량에 붙는 배수. 느린 이동은 감도 그대로(정밀), 빠른 이동은 더 멀리.
 *
 * 가속이 없으면 한 화면을 가로지르는 데 손가락을 여러 번 쓸어야 하고, 가속만 있으면
 * 작은 버튼을 못 맞춘다. 둘 다 필요해서 둘 다 있다.
 */
export const accelerationFor = (distance, {
  sensitivity = POINTER_SENSITIVITY,
  accelMax = POINTER_ACCEL_MAX,
  pivot = POINTER_ACCEL_PIVOT,
} = {}) => {
  const extra = Math.min(Math.max(distance, 0) / pivot, accelMax);
  return sensitivity * (1 + extra);
};

/** 상대 이동 → 새 커서 위치(불변). 원본을 고치지 않는다. */
export const moveCursor = (cursor, delta, { bounds, sensitivity, accelMax, pivot } = {}) => {
  const dx = delta?.dx || 0;
  const dy = delta?.dy || 0;
  const factor = accelerationFor(Math.hypot(dx, dy), { sensitivity, accelMax, pivot });
  return clampCursor(
    { x: (cursor?.x || 0) + dx * factor, y: (cursor?.y || 0) + dy * factor },
    bounds,
  );
};

/** 눌렀다 뗀 것이 클릭인가, 이동이었나. */
export const isTapGesture = ({ distance = 0, elapsedMs = 0 } = {}) => (
  distance <= TAP_SLOP_PX && elapsedMs <= TAP_MAX_MS
);

/** 다음 확대 단계. dir > 0 이면 확대, < 0 이면 축소. 목록 밖으로 나가지 않는다. */
export const nextZoom = (zoom, dir, steps = ZOOM_STEPS) => {
  const list = steps.length ? steps : ZOOM_STEPS;
  // 현재 값에 가장 가까운 단계를 기준으로 삼는다 — 핀치로 임의 배율이 된 뒤에도 버튼이 먹는다.
  let index = 0;
  let best = Infinity;
  list.forEach((step, i) => {
    const gap = Math.abs(step - zoom);
    if (gap < best) { best = gap; index = i; }
  });
  const nextIndex = Math.min(Math.max(index + (dir > 0 ? 1 : -1), 0), list.length - 1);
  return list[nextIndex];
};

/** 핀치 배율을 허용 범위로 자른다(임의 배율도 허용하되 목록의 끝은 넘지 않게). */
export const clampZoom = (zoom, steps = ZOOM_STEPS) => {
  const list = steps.length ? steps : ZOOM_STEPS;
  return Math.min(Math.max(zoom, list[0]), list[list.length - 1]);
};

/**
 * 확대된 화면에서 커서를 따라 스크롤한다 — **커서가 보이지 않으면 조작이 불가능하다.**
 *
 * 커서는 캔버스 좌표, 스크롤은 감싼 뷰의 좌표라 캔버스가 스크롤 콘텐츠 안에서 어디에
 * 놓였는지(`canvasOffset`)를 같이 받는다. 반환은 **새 스크롤 위치**(음수 없음).
 */
export const keepCursorVisible = ({
  cursor = { x: 0, y: 0 },
  canvasOffset = { x: 0, y: 0 },
  view = { width: 0, height: 0 },
  scroll = { left: 0, top: 0 },
  content = { width: 0, height: 0 },
  margin = 40,
} = {}) => {
  const pointX = canvasOffset.x + cursor.x;
  const pointY = canvasOffset.y + cursor.y;
  const maxLeft = Math.max(0, content.width - view.width);
  const maxTop = Math.max(0, content.height - view.height);

  let left = scroll.left;
  let top = scroll.top;
  if (pointX - margin < left) left = pointX - margin;
  if (pointX + margin > left + view.width) left = pointX + margin - view.width;
  if (pointY - margin < top) top = pointY - margin;
  if (pointY + margin > top + view.height) top = pointY + margin - view.height;

  return {
    left: Math.min(Math.max(left, 0), maxLeft),
    top: Math.min(Math.max(top, 0), maxTop),
  };
};

/**
 * 두 손가락이 지금 하는 일이 확대인가 스크롤인가.
 *
 * ⚠️ **벌어진 정도만 보면 안 된다.** 포인터 이벤트는 손가락마다 따로 도착하므로, 나란히
 * 미는 스크롤 중에도 한 손가락이 먼저 움직인 순간에는 간격이 크게 변한 것처럼 보인다
 * (테스트가 정확히 이걸로 깨졌고, 실기기에서도 같은 일이 난다). 그래서 **간격 변화가
 * 중점 이동보다 큰가**를 같이 본다 — 핀치는 중점이 거의 안 움직이고, 스크롤은 중점이
 * 곧 이동량이다.
 */
export const PINCH_RATIO_THRESHOLD = 0.12;

export const classifyTwoFinger = ({
  spread = 0,
  base = 0,
  midTravel = 0,
  threshold = PINCH_RATIO_THRESHOLD,
} = {}) => {
  if (base <= 0) return 'scroll';
  const ratio = spread / base;
  const spreadDelta = Math.abs(spread - base);
  return (Math.abs(ratio - 1) > threshold && spreadDelta > midTravel) ? 'pinch' : 'scroll';
};

/** 두 손가락 이동량 → 휠 델타. noVNC 가 자체 임계로 스텝을 만들므로 값만 전달한다. */
export const scrollDeltaFor = (dy, sensitivity = SCROLL_SENSITIVITY) => (dy || 0) * sensitivity;

/** 두 점 사이 거리 — 핀치 배율 계산용. */
export const touchDistance = (a, b) => Math.hypot(
  (a?.x || 0) - (b?.x || 0),
  (a?.y || 0) - (b?.y || 0),
);
