/**
 * 모바일 키바 길게 누르기 반복 — 백스페이스를 스무 번 두드리지 않게.
 *
 * 왜 터치 이벤트여야 하나: iOS 는 손가락을 **떼야** 합성 mousedown 을 보낸다. 누르고 있는
 * 동안에는 아무 마우스 이벤트도 오지 않으므로 mousedown 기반 반복은 영영 시작되지 않는다.
 * 그래서 touchstart 에서 시작하고 touchend/cancel 에서 멈춘다.
 *
 * 아무 키나 반복하면 위험하다 — ESC/Enter/^C 가 연타되면 사고다. 커서를 한 칸씩 옮기거나
 * 한 글자씩 지우는, "여러 번 누르는 게 당연한" 키만 화이트리스트로 연다.
 */

export const REPEATABLE_KEY_PAYLOADS = new Set([
  '\x7f',      // Backspace
  '\x08',      // Ctrl+H (같은 의미로 쓰는 사용자가 있다)
  '\x1b[3~',   // Delete
  '\x1b[A',    // ↑
  '\x1b[B',    // ↓
  '\x1b[C',    // →
  '\x1b[D',    // ←
]);

export const isRepeatableKey = (payload) => REPEATABLE_KEY_PAYLOADS.has(payload);

export const REPEAT_DELAY_MS = 420;   // 이 시간 넘게 누르고 있어야 반복 시작 (오발 방지)
export const REPEAT_INTERVAL_MS = 80; // 반복 간격 — OS 키 리피트와 비슷한 체감

/**
 * 반복 타이머 한 벌. 한 번에 하나의 키만 반복한다(두 손가락으로 두 키를 눌러도 뒤엣것만).
 *
 * @param onFire 반복 시점마다 호출 — 최초 1회 발사는 호출부 몫이다(누르자마자 즉시 반응해야 하므로).
 */
export const createKeyRepeater = ({
  onFire,
  delay = REPEAT_DELAY_MS,
  interval = REPEAT_INTERVAL_MS,
} = {}) => {
  let startTimer = null;
  let tickTimer = null;

  const stop = () => {
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  };

  const start = (payload) => {
    stop();
    if (!isRepeatableKey(payload)) return false;
    startTimer = setTimeout(() => {
      startTimer = null;
      tickTimer = setInterval(() => onFire?.(payload), interval);
    }, delay);
    return true;
  };

  return { start, stop, isRunning: () => !!(startTimer || tickTimer) };
};

export default createKeyRepeater;
