import { authHeaders } from './auth';

/**
 * pane 의 셸을 "같은 경로에서 완전히 새로" 다시 연다.
 *
 * `…` 메뉴의 "터미널 새로고침" 과는 다르다. 그쪽은 xterm 만 remount 해서 살아있는 tmux 에
 * 다시 붙는 것이라 셸 상태가 그대로다. 여기서는 tmux 세션 자체를 죽이므로 그 안에서 돌던
 * 프로세스(빌드·watch·ssh …)도 함께 끝난다.
 *
 * 죽이기만 하면 된다 — 재생성은 재접속이 알아서 한다. WebSocket 라우트가 세션이 없으면
 * `create=1`(기본값)로 새로 만들고, 그때 `cwd` 쿼리를 시작 디렉토리로 쓴다.
 * 그래서 호출 측은 kill 이 끝난 뒤에 터미널을 remount 해야 한다. 순서가 뒤집히면
 * 아직 살아있는 세션에 그대로 재부착돼 아무 일도 안 일어난다.
 *
 * cwd 형식이 로컬/원격이 다르다:
 *   - 로컬  : 워크스페이스 상대경로. 백엔드 validate_path() 가 선행 '/' 를 떼고
 *             워크스페이스에 이어붙이므로 절대경로를 주면 엉뚱한 곳을 가리킨다.
 *   - 원격  : 원격 박스의 절대경로. `tmux new -A -s <name> -c <path>` 로 들어간다.
 *
 * @returns {Promise<{ok: boolean, error?: string}>} 실패해도 던지지 않는다 — 호출 측이 알림만 띄운다.
 */
export const killPaneSession = async ({ isLocal, sessionId, hostId, remoteTmuxSession }) => {
  try {
    if (isLocal) {
      if (!sessionId) return { ok: false, error: 'missing sessionId' };
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) return { ok: false, error: `DELETE /api/sessions → ${res.status}` };
      return { ok: true };
    }

    if (!hostId) return { ok: false, error: 'missing hostId' };
    // 원격 tmux 를 안 쓰는 호스트는 죽일 세션이 없다 — 재접속만으로 새 셸이 뜬다.
    if (!remoteTmuxSession) return { ok: true };

    const res = await fetch(
      `/api/hosts/${encodeURIComponent(hostId)}/kill-tmux?session=${encodeURIComponent(remoteTmuxSession)}`,
      { method: 'POST', headers: authHeaders() },
    );
    if (!res.ok) return { ok: false, error: `POST kill-tmux → ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'network error' };
  }
};

/** 재접속 시 시작 디렉토리로 쓸 값. 로컬은 워크스페이스 상대, 원격은 절대. */
export const restartCwdFor = ({ isLocal, paneCwdRel, paneCwdAbs }) => (
  isLocal ? (paneCwdRel ?? null) : (paneCwdAbs ?? null)
);
