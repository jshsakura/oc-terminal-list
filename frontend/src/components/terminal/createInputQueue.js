import { TMUX_WHEEL_INPUT_RE } from './terminalConstants';

/**
 * 사용자 입력 → WebSocket 송신 큐.
 *
 * 왜 큐가 필요한가: 대용량 paste 를 동기 루프로 ws.send() 에 몰아넣으면 브라우저 WS 버퍼,
 * 서버 receive, PTY, tmux, vim 이 저마다 다른 속도로 빠져나가므로 UI 가 얼고 소켓이 닫히고
 * 입력이 유실된다. 청크로 쪼개 틱마다 조금씩 흘려보내고, 소켓 버퍼가 차면 쉬어간다.
 *
 * 소켓이 닫혀 있어도 입력을 버리지 않는다 — 큐에 쌓아뒀다가 다시 열리면 흘려보낸다("키 씹힘" 방지).
 */

const INPUT_CHUNK = 16 * 1024;         // 한 번에 send 할 최대 바이트
const INPUT_BYTES_PER_TICK = 128 * 1024; // 한 틱에 흘려보낼 총량 (메인스레드 양보)
const MAX_QUEUE_BYTES = 1024 * 1024;   // 큐 상한 — 넘으면 오래된 것부터 버린다
const BUSY_RETRY_MS = 16;              // 소켓 버퍼가 찼을 때 다시 시도할 간격
const DISCONNECTED_FLUSH_MS = 50;      // 소켓이 없을 때의 최소 재시도 간격
const LIVENESS_SILENCE_MS = 3000;      // 이만큼 조용했는데 입력이 오면 소켓 생존을 의심

export const WS_BUFFER_HIGH_WATER = 512 * 1024;

/** 단일 키 / 짧은 escape — RTT 가 그대로 체감되므로 큐를 우회해 즉시 보낸다. */
export const isLatencySensitiveInput = (data) => (
  typeof data === 'string'
  && (data.length === 1 || (data.charCodeAt(0) === 0x1b && data.length <= 16))
);

const createInputQueue = ({
  getSocket,
  getLastRecvAt,
  onProbeLiveness,
  onBroadcast,
  onDisconnected,
}) => {
  let queue = [];
  let flushTimer = null;

  const schedule = (delay = 0) => {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, delay);
  };

  function flush() {
    flushTimer = null;
    const ws = getSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (queue.length === 0) return;

    // 소켓 송신 버퍼가 이미 높으면 이번 틱은 건너뛴다 — 더 밀어봐야 버퍼만 부풀린다.
    if (ws.bufferedAmount > WS_BUFFER_HIGH_WATER) {
      schedule(BUSY_RETRY_MS);
      return;
    }

    let sent = 0;
    while (queue.length > 0 && sent < INPUT_BYTES_PER_TICK) {
      if (ws.bufferedAmount > WS_BUFFER_HIGH_WATER) break;
      const next = queue[0];
      if (!next) {
        queue.shift();
        continue;
      }
      const chunk = next.length > INPUT_CHUNK ? next.slice(0, INPUT_CHUNK) : next;
      ws.send(chunk);
      sent += chunk.length;
      if (next.length > INPUT_CHUNK) queue[0] = next.slice(INPUT_CHUNK);
      else queue.shift();
    }

    if (queue.length > 0) {
      schedule(ws.bufferedAmount > WS_BUFFER_HIGH_WATER ? BUSY_RETRY_MS : 1);
    }
  }

  // 큐가 상한을 넘으면 오래된 것부터 버린다(마지막 하나는 남긴다).
  const trimToCap = (incomingBytes) => {
    let total = incomingBytes;
    for (const item of queue) total += item.length;
    while (total > MAX_QUEUE_BYTES && queue.length > 1) {
      total -= queue.shift().length;
    }
  };

  const enqueue = (data, { broadcast = false, delay = 0, priority = false, dropQueuedWheel = false } = {}) => {
    if (typeof data !== 'string' || data.length === 0) return false;

    // 밀린 휠 리포트를 걷어낸다 — 명령이 스크롤 뒤에 줄서지 않게(sendCommand 경로).
    if (dropQueuedWheel) {
      queue = queue.filter((item) => !TMUX_WHEEL_INPUT_RE.test(item));
    }

    trimToCap(data.length);
    if (priority) queue.unshift(data);
    else queue.push(data);

    const ws = getSocket();
    // 사용자가 타이핑하는데 서버가 한참 조용했다면 half-open 을 의심해 생존을 확인한다.
    if (ws?.readyState === WebSocket.OPEN && Date.now() - getLastRecvAt() > LIVENESS_SILENCE_MS) {
      onProbeLiveness?.();
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onDisconnected?.();
      schedule(Math.max(delay, DISCONNECTED_FLUSH_MS));
    } else {
      schedule(delay);
    }

    if (broadcast) onBroadcast?.(data);
    return true;
  };

  /** 휠 리포트처럼 이미 OPEN 을 확인하고 보내는 내부 경로 — 큐에 넣고 다음 틱에 합쳐 보낸다. */
  const push = (data) => {
    queue.push(data);
    schedule(0);
  };

  return {
    enqueue,
    push,
    schedule,
    hasPending: () => queue.length > 0,
    dispose: () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      queue = [];
    },
  };
};

export default createInputQueue;
