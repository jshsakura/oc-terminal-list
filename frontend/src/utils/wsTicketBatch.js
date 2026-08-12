/**
 * WS 티켓 마이크로 배처.
 *
 * 부팅/복원은 pane 을 전부 한꺼번에 연다. pane 마다 POST /api/ws-ticket 을 하면
 * 1초 안에 요청이 pane 수만큼(실측 14회) 몰리고, 전부 같은 공유 HTTP/2 연결에 줄을 선다 —
 * 모바일 네트워크 전환 때 wedge 되는 바로 그 연결이다. 짧은 창(30ms) 동안 모아
 * POST /api/ws-tickets 한 번으로 받는다.
 *
 * 창을 짧게 두는 이유: 혼자 재연결하는 경우엔 이 창이 그대로 지연이 된다. 30ms 는
 * 왕복(보통 100ms+) 대비 무시할 수 있으면서 동시 오픈을 모으기엔 충분하다.
 *
 * 결과는 **위치로** 매칭한다. 같은 호스트의 원격 pane 들은 ws 경로가 모두 같은데
 * 티켓은 단일 사용이라, 경로로 매칭하면 첫 pane 만 붙고 나머지가 조용히 실패한다.
 */

export const WS_TICKET_BATCH_WINDOW_MS = 30;
// 서버의 MAX_BATCH_PATHS 와 맞춘다 — 넘치면 나눠 보낸다.
export const WS_TICKET_BATCH_MAX = 32;

const FAILED = { ticket: null, authExpired: false };
const EXPIRED = { ticket: null, authExpired: true };

/**
 * @param postBatch (paths[]) => Promise<{ ok, status, tickets }>
 *   tickets: 요청과 같은 순서의 배열. 항목은 {ticket, expires_at} 또는 null.
 */
export const createWsTicketBatcher = ({ postBatch, windowMs = WS_TICKET_BATCH_WINDOW_MS, maxBatch = WS_TICKET_BATCH_MAX } = {}) => {
  let pending = [];
  let timer = null;

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending.length) return;
    const batch = pending;
    pending = [];

    let result;
    try {
      result = await postBatch(batch.map((p) => p.path));
    } catch {
      batch.forEach((p) => p.resolve(FAILED));
      return;
    }

    if (result?.status === 401 || result?.status === 403) {
      batch.forEach((p) => p.resolve(EXPIRED));
      return;
    }
    if (!result?.ok || !Array.isArray(result?.tickets)) {
      batch.forEach((p) => p.resolve(FAILED));
      return;
    }
    batch.forEach((p, i) => {
      const slot = result.tickets[i];
      p.resolve(slot?.ticket ? { ticket: slot.ticket, authExpired: false } : FAILED);
    });
  };

  const request = (path) => new Promise((resolve) => {
    pending.push({ path, resolve });
    if (pending.length >= maxBatch) { flush(); return; }
    if (!timer) timer = setTimeout(flush, windowMs);
  });

  return { request, flush };
};
