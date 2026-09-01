/**
 * 새로 연 pane 의 셸이 **명령을 받을 수 있는 상태**가 된 다음에 글자를 보낸다.
 *
 * 설치를 백그라운드 SSH 로 돌리지 않고 사람이 보는 터미널에 타이핑하는 것이 이 기능의
 * 설계다(backend/host_tools.py 머리말). 그런데 "보낼 수 있다" 의 정의를 너무 이르게
 * 잡으면 그 설계가 통째로 무너진다.
 *
 * ⚠️ **"WS 가 열렸다" 는 "셸이 프롬프트에 있다" 가 아니다.** 새 pane 의 WS 는 tmux 가
 * attach 하는 순간 열리는데, 그때 셸은 아직 rc 를 돌고 있다. 실제로 oh-my-zsh 의
 * `[Y/n]` 업데이트 프롬프트가 서 있는 사이에 보내서 첫 글자 `c` 가 그 프롬프트에 먹히고
 * `url -fsSL … | sh` 만 명령줄에 남았다 — 사용자에게는 "설치가 이지랄난다" 로 보인다.
 * 이 저장소가 재접속에서 여러 번 밟은 그 규칙과 같다: **겉으로 열린 것과 실제로 쓸 수
 * 있는 것은 다르다.**
 *
 * ⚠️ **그래서 보낸 뒤에 확인한다.** 그리고 확인은 반드시 **커서가 앉은 입력 줄**로
 * 해야 한다 — 화면 검색은 못 잡는다. 위 사고에서 먹힌 글자까지 프롬프트 줄에 그대로
 * 에코됐기 때문에 "화면에 그 문자열이 있나" 는 통과한다.
 *
 * ⚠️ **터미널 키(sessionId)로 찾지 않는다.** 새 pane 의 sessionId 는 서버가 정해서
 * 돌려주는 값이라 여기서는 아직 모른다. 대신 전역 등록부의 각 항목이 스스로 말하는
 * `getSessionStatus()` 로 찾는다 — 키 형식이 바뀌어도 안 깨진다.
 */

export const POLL_MS = 120;
export const DEFAULT_TIMEOUT_MS = 20000;
/** 입력 줄이 이만큼 그대로면 셸이 우리 차례를 내줬다고 본다. */
export const SETTLE_QUIET_MS = 500;
/** 영영 조용해지지 않는 셸(스트리밍 로그 등)도 있다 — 기다림에는 상한이 있다. */
export const SETTLE_MAX_MS = 6000;
/** 보낸 글자가 화면에 나타나기까지. 원격은 왕복이 한 번 더 있다. */
export const VERIFY_TIMEOUT_MS = 2000;

const defaultWait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

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

/** 낡은 핸들(getInputLine 없음)이면 null — "빈 줄" 과 구별해야 한다. */
export const readInputLine = (handle) => {
  if (typeof handle?.getInputLine !== 'function') return null;
  try {
    const line = handle.getInputLine();
    return typeof line === 'string' ? line : null;
  } catch {
    return null;
  }
};

/** 줄바꿈으로 접힌 자리와 프롬프트의 공백 차이를 무시하고 비교하기 위해. */
const squeeze = (text) => (text || '').replace(/\s+/g, '');

/**
 * 그 명령이 **입력 줄의 끝**에 들어갔는가.
 *
 * `includes` 가 아니라 `endsWith` 인 것이 핵심이다. 첫 글자가 먹힌 줄
 * (`… [Y/n] url -fsSL …`)은 명령 전체를 품고 있지 않으므로 `endsWith` 만이 가른다.
 */
export const didLandOnInputLine = (line, text) => {
  const want = squeeze(text);
  if (!want) return false;
  return squeeze(line).endsWith(want);
};

/**
 * pane 이 붙고 셸이 조용해질 때까지 기다렸다 `text` 를 보내고, 들어갔는지 확인한다.
 *
 * ⚠️ **엔터를 누르지 않는다.** 무엇이 실행될지 사용자가 읽고 직접 확인하는 것이 이
 * 앱의 규칙이다(파일 드롭에서 배운 것 — vim/에이전트 안에 엔터를 흘리면 사고가 난다).
 *
 * @returns {Promise<{ok: boolean, verified?: boolean, reason?: string}>}
 *   `reason` — `no-text` | `no-pane` | `send-failed` | `not-typed`.
 *   `verified:false` 는 확인할 수단이 없었다는 뜻이지 실패가 아니다.
 */
export const typeIntoPane = async (match, text, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = POLL_MS,
  settleQuietMs = SETTLE_QUIET_MS,
  settleMaxMs = SETTLE_MAX_MS,
  verifyMs = VERIFY_TIMEOUT_MS,
  getRegistry = () => (typeof window !== 'undefined' ? window.terminalSessions : null),
  wait = defaultWait,
} = {}) => {
  if (!text) return { ok: false, reason: 'no-text' };

  // 1) 붙을 때까지.
  let handle = null;
  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    const found = findTerminalSession(getRegistry(), match);
    if (found && isPaneReady(found)) { handle = found; break; }
    await wait(pollMs);
  }
  if (!handle) return { ok: false, reason: 'no-pane' };

  // 2) 셸이 조용해질 때까지. rc 가 아직 도는 중이면 우리 글자가 그 안으로 들어간다.
  //    상한이 있는 이유는 이 저장소의 다른 모든 대기와 같다 — 끝나지 않는 기다림은 버그다.
  let last = readInputLine(handle);
  for (let waited = 0, quiet = 0; waited < settleMaxMs && quiet < settleQuietMs; waited += pollMs) {
    await wait(pollMs);
    const now = readInputLine(handle);
    quiet = now === last ? quiet + pollMs : 0;
    last = now;
  }

  if (handle.sendData?.(text) === false) return { ok: false, reason: 'send-failed' };

  // 3) 실제로 그 줄에 들어갔는지. 확인할 수단이 없는 핸들이면 확인을 건너뛴다 —
  //    없는 기능으로 실패를 만들지는 않는다.
  if (typeof handle.getInputLine !== 'function') return { ok: true, verified: false };
  for (let waited = 0; waited <= verifyMs; waited += pollMs) {
    if (didLandOnInputLine(readInputLine(handle), text)) return { ok: true, verified: true };
    await wait(pollMs);
  }
  return { ok: false, reason: 'not-typed' };
};
