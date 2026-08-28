import apiFetch from './apiFetch';
import { authHeaders } from './auth';

/**
 * 탭을 닫을 때 원격 tmux 세션을 죽인다 — **확인될 때까지 다시 시도한다.**
 *
 * ⚠️ 예전에는 `fetch(...).catch(() => {})` 한 줄이었다. 그래서 백엔드가 재시작 중이거나
 * (배포 직후가 정확히 그 창이다) 공유 HTTP/2 연결이 막혀 있으면 **닫은 탭의 세션이 조용히
 * 살아남았다.** 그 세션은 아무 탭도 안 들고 있으므로 다음에 홈의 "이어할 수 있는 세션" 에
 * 나타나고, 사용자에게는 "닫았는데 왜 엉뚱한 게 올라오나" 로 보인다. 실측으로 그렇게
 * 생긴 고아가 있었다(`mobile-ac0df9c9e9b1`).
 *
 * 이 저장소의 규칙 그대로다: **에러를 조용히 삼키지 않는다.** 그리고 무엇을 재시도할지도
 * 이미 정해져 있다(업로드에서 배운 것) —
 *
 *   - 연결이 못 닿은 것(예외·5xx) → 다시. 잠깐 뒤엔 될 일이다.
 *   - 서버가 **답을 한** 거절(4xx) → 안 붙잡는다. 다시 보내도 같은 답이라 시간만 버린다.
 *   - 404 는 성공으로 친다 — 호스트가 없으면 지울 것도 없다.
 *
 * @returns {Promise<boolean>} 죽은 것이 확인됐나. 실패하면 호출부가 사용자에게 말한다.
 */
const RETRY_DELAYS_MS = [0, 2000, 5000, 12000];

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

export const killRemoteSession = async (hostId, sessionName) => {
  if (!hostId || !sessionName) return true;      // 죽일 것이 없다
  const url = `/api/hosts/${encodeURIComponent(hostId)}/kill-tmux`
    + `?session=${encodeURIComponent(sessionName)}&allow_attached=true`;

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      const res = await apiFetch(url, { method: 'POST', headers: authHeaders() });
      if (res.ok || res.status === 404) return true;
      if (res.status >= 400 && res.status < 500) return false;   // 서버가 답했다
    } catch {
      /* 못 닿았다 — 다음 차례에 다시. */
    }
  }
  return false;
};

export default killRemoteSession;
