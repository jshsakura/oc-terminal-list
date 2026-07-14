/**
 * 재연결 진단 기록.
 *
 * 왜 필요한가: 백엔드 로그만으로는 "정상 grace-close 후 탭 복귀" 와 "진짜 장애" 를 구분할 수
 * 없다 — 둘 다 disconnected → connected 로 똑같이 보인다. 구분에 필요한 정보(종료 코드,
 * 마지막 수신 이후 경과, 의도적 종료 여부, 복구까지 걸린 시간)는 브라우저에만 있다.
 *
 * 최근 기록을 링버퍼에 남기고 `window.__terminalDiag()` 로 꺼내볼 수 있게 한다.
 */

const MAX_EVENTS = 60;
const events = [];

const record = (event) => {
  events.push({ at: new Date().toISOString(), ...event });
  if (events.length > MAX_EVENTS) events.shift();
};

// 끊김 원인을 사람이 읽을 수 있는 한 마디로. 이게 로그의 핵심이다.
const classify = ({ intentional, graceClosed, code, silentMs, heartbeatKilled }) => {
  if (graceClosed) return 'grace-close(비활성 절전 — 정상)';
  if (intentional) return 'intentional(우리가 닫음)';
  if (heartbeatKilled) return `heartbeat-timeout(${Math.round(silentMs / 1000)}s 무응답 — 오탐 의심)`;
  if (code === 1000 || code === 1001) return `server-close(code ${code})`;
  if (code === 1006) return 'abnormal(1006 — 네트워크/터널이 끊음)';
  return `close(code ${code})`;
};

export const recordDisconnect = ({
  sessionId, code, wasClean, intentional, graceClosed, silentMs, heartbeatKilled, attempts,
}) => {
  const reason = classify({ intentional, graceClosed, code, silentMs, heartbeatKilled });
  record({
    type: 'down', sessionId, reason, code, wasClean, attempts,
    silentMs: Math.round(silentMs),
    hidden: document.hidden,
    online: navigator.onLine,
  });
  // 정상 절전은 시끄럽게 알릴 필요가 없다.
  if (graceClosed || intentional) return;
  console.warn(`[Terminal:${sessionId}] 끊김 — ${reason}`, {
    code, wasClean, silentMs: Math.round(silentMs), attempts, hidden: document.hidden, online: navigator.onLine,
  });
};

export const recordReconnect = ({ sessionId, outageMs, attempts, planned }) => {
  record({ type: 'up', sessionId, outageMs: Math.round(outageMs), attempts, planned: !!planned });
  // 계획된 절전(grace-close) 복귀나, 1초 안에 붙은 건 사용자가 느끼지도 못한다.
  if (planned || outageMs < 1000) return;
  console.warn(`[Terminal:${sessionId}] 복구 — ${(outageMs / 1000).toFixed(1)}s 만에 재연결 (시도 ${attempts}회)`);
};

if (typeof window !== 'undefined') {
  // 콘솔에서 `__terminalDiag()` 로 최근 기록을 표로 본다.
  window.__terminalDiag = () => {
    console.table(events);
    return events;
  };
}
