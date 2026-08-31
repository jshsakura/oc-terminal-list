/**
 * 새로 연 pane 이 실제로 붙은 다음에 그 pane 으로 글자를 보낸다.
 *
 * 설치를 백그라운드 SSH 로 돌리지 않고 **사람이 보는 터미널에** 타이핑하는 것이 이
 * 기능의 설계다(backend/host_tools.py 머리말). 그런데 탭을 만든 직후의 pane 은 아직
 * WS 를 열지도 않았다 — 그 순간에 보내면 아무 데도 도착하지 않고, 사용자에게는 버튼이
 * 그냥 안 먹은 것으로 보인다.
 *
 * ⚠️ **터미널 키(sessionId)로 찾지 않는다.** 새 pane 의 sessionId 는 서버가 정해서
 * 돌려주는 값이라 여기서는 아직 모른다. 대신 전역 등록부의 각 항목이 스스로 말하는
 * `getSessionStatus().paneId` 로 찾는다 — 키 형식이 바뀌어도 안 깨진다.
 */

export const POLL_MS = 120;
export const DEFAULT_TIMEOUT_MS = 20000;

/**
 * 등록부에서 이 터미널의 핸들을 찾는다. 없으면 null.
 *
 * ⚠️ **탭 id 로 찾는다.** pane id 는 `makePane` 이 그때그때 만드는 UUID 라 setTabs 밖에서는
 * 알 수 없는데, 탭 id 는 탭을 만들기 **전에** 정해진다(`local:<uuid>` / `host:<id>:<ts>`).
 * 새로 연 탭은 pane 이 하나뿐이라 이것으로 충분하다.
 */
export const findTerminalSession = (registry, match) => {
  if (!registry || !match) return null;
  const [key, want] = Object.entries(match).find(([, v]) => v) || [];
  if (!key) return null;
  for (const handle of Object.values(registry)) {
    try {
      if (handle?.getSessionStatus?.()?.[key] === want) return handle;
    } catch {
      // 정리 중인 항목 — 다음 것을 본다.
    }
  }
  return null;
};

/** 붙어서 글자를 받을 수 있는 상태인가. 등록만으로는 부족하다(소켓이 아직 연결 중). */
export const isPaneReady = (handle) => {
  try {
    return handle?.getConnectionState?.() === 'open';
  } catch {
    return false;
  }
};

/**
 * pane 이 붙을 때까지 기다렸다 `text` 를 보낸다.
 *
 * ⚠️ **엔터를 누르지 않는다.** 무엇이 실행될지 사용자가 읽고 직접 확인하는 것이 이
 * 앱의 규칙이다(파일 드롭에서 배운 것 — vim/에이전트 안에 엔터를 흘리면 사고가 난다).
 * 설치 명령은 특히 그렇다.
 *
 * @returns {Promise<boolean>} 보냈으면 true, 시간 안에 안 붙었으면 false.
 */
export const typeIntoPane = (match, text, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = POLL_MS,
  getRegistry = () => (typeof window !== 'undefined' ? window.terminalSessions : null),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
} = {}) => new Promise((resolve) => {
  if (!text) { resolve(false); return; }
  let waited = 0;
  const attempt = () => {
    const handle = findTerminalSession(getRegistry(), match);
    if (handle && isPaneReady(handle)) {
      resolve(handle.sendData?.(text) !== false);
      return;
    }
    waited += pollMs;
    if (waited >= timeoutMs) { resolve(false); return; }
    setTimeoutFn(attempt, pollMs);
  };
  attempt();
});
