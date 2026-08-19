import { authHeaders } from '../../utils/auth';

/**
 * 세션 관련 URL 조립과 preflight 조회. 전부 순수하거나(fetch 하나 빼고) 부수효과가 없어
 * 단위 테스트가 가능하다 — WS URL 은 백엔드와의 계약이라 조용히 틀어지면 안 된다.
 */

const PREFLIGHT_TIMEOUT_MS = 5000;

/**
 * 터미널 WebSocket URL.
 *
 * 로컬 세션은 `/ws/<sessionId>` (셸 이름을 함께 넘긴다), 호스트 세션은 `/ws/host/<hostId>`.
 * 호스트 쪽 tmux 지정 규칙:
 *  - tmuxSessionName 이 있으면 그 세션에 붙는다(Home 의 "이어하기"). base/suffix 는 무시된다.
 *  - 없으면 tmuxSuffix 로 탭마다 별도 base 세션을 분리한다(새 탭 = 새 작업공간).
 * create=0 은 "없으면 만들지 말고 실패하라" — 기존 셸에만 재연결할 때 쓴다.
 */
export const buildWsUrl = ({
  origin,
  ticket,
  sessionId,
  hostId = null,
  cols,
  rows,
  shell = 'bash',
  cwd = null,
  paneIndex = 0,
  tmuxSuffix = null,
  tmuxSessionName = null,
  createIfMissing = true,
  clientId,
  reason = null,
  prevMs = null,
}) => {
  const params = new URLSearchParams();
  // 티켓이 없으면(발급 실패 — wedge 된 HTTP 풀) 파라미터를 생략한다. 서버가 same-origin
  // 쿠키로 폴백 인증하므로 티켓 없이도 연결이 부트스트랩된다(ws_auth.py).
  if (ticket) params.set('ticket', ticket);
  params.set('cols', String(cols));
  params.set('rows', String(rows));

  if (hostId) {
    if (paneIndex) params.set('pane_index', String(paneIndex));
    if (tmuxSuffix) params.set('tmux_suffix', tmuxSuffix);
    if (tmuxSessionName) params.set('tmux_session_name', tmuxSessionName);
  } else {
    params.set('shell', shell || 'bash');
  }

  if (cwd) params.set('cwd', cwd);
  if (!createIfMissing) params.set('create', '0');
  params.set('client_id', clientId);
  // Observability only (backend/ws_observe.py): why this socket is being opened, and how
  // long the previous one lived. The server logs it and nothing else — it never affects
  // auth or routing. Without it the log can only say a socket reopened, never why, which
  // is exactly the question every reconnect bug in this repo has needed answered.
  if (reason) params.set('reason', reason);
  if (prevMs != null && prevMs >= 0) params.set('prev_ms', String(Math.round(prevMs)));

  const path = hostId ? `/ws/host/${hostId}` : `/ws/${sessionId}`;
  return `${origin}${path}?${params.toString()}`;
};

/** WS 티켓 발급 경로 — buildWsUrl 과 같은 path 를 써야 서버가 스코프를 맞춘다. */
export const wsPathFor = ({ sessionId, hostId = null }) => (
  hostId ? `/ws/host/${hostId}` : `/ws/${sessionId}`
);

/**
 * preflight — 이 tmux 세션에 누가 붙어 있는지, 세션이 아직 있는지 묻는다.
 *
 * 실패(네트워크/타임아웃/에러 응답)는 "붙은 사람 없고 세션은 있다"로 낙관 처리한다.
 * 여기서 비관적으로 굴면 잠깐의 네트워크 blip 이 "셸 종료" 오버레이로 번진다.
 */
export const fetchSessionClients = async ({ sessionId, hostId = null, tmuxSession = null, clientId }) => {
  const fallback = { attached: false, exists: true };
  const target = hostId ? tmuxSession : sessionId;
  if (!target) return fallback;

  const url = hostId
    ? `/api/hosts/${hostId}/tmux-clients?session=${encodeURIComponent(target)}&client_id=${encodeURIComponent(clientId)}`
    : `/api/sessions/${target}/clients?client_id=${encodeURIComponent(clientId)}`;

  try {
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      ...data,
      attached: !!data.attached,
      count: data.count || 0,
      // exists=false = 셸이 exit 해서 tmux 세션이 사라졌다. 명시적으로 false 일 때만 그렇게 친다.
      exists: data.exists !== false,
    };
  } catch {
    return fallback;
  }
};
