/**
 * Terminal 동작 튜닝 상수 — 재연결/하트비트/WebGL/버퍼 임계값.
 * Terminal.jsx 본체와 추출된 훅들이 공용으로 쓴다. 순수 상수만(로직 없음).
 */

// 모듈 스코프 — 매 메시지마다 재생성하지 않고 재사용 (GC 절감)
export const _textDecoder = new TextDecoder('utf-8');
export const _textEncoder = new TextEncoder();

export const RECOVERY_GRACE_MS = 12000;
export const RECOVERY_POLL_MS = 1000;
export const TAKEOVER_CONFIRM_MS = 3500;
export const TAKEOVER_CONFIRM_POLL_MS = 500;
export const MAX_RECONNECT_ATTEMPTS = 12;
// 연속 재연결의 벽시계 상한. 횟수 기반 cap(MAX_RECONNECT_ATTEMPTS)은 resume 이벤트
// (online/focus/visibilitychange)가 attempts 를 0 으로 리셋하면 무력화되므로,
// resume 이 건드리지 않는 벽시계 데드라인을 둬서 "재연결 중..." 무한 대기를 막는다.
// 한 번이라도 OPEN 에 성공하면 리셋된다.
export const RECONNECT_MAX_WALL_MS = 90000;
// 셸이 깨끗이 종료(exit)된 게 확인되면 짧은 취소 여유를 두고 pane 자동 닫기.
export const AUTO_CLOSE_MS = 1800;
// 로딩이 이 시간을 넘기면 "멈춤"으로 보고 수동 닫기 버튼을 노출 (행 걸린 pane 탈출구).
export const LOAD_STUCK_MS = 8000;
// 앱 레벨 하트비트 — half-open(죽었지만 OPEN 으로 보이는) 소켓 감지.
// 클라이언트가 ping 을 보내고 서버 pong(또는 그 외 메시지) 을 일정 시간 못 받으면 죽은 소켓으로 보고 강제 재연결.
export const HEARTBEAT_INTERVAL_MS = 15000;
export const HEARTBEAT_DEAD_MS = 35000;
// 활성·가시 탭의 빠른 하트비트 — "포커스한 채 타이핑·탭전환 없이 가만히 보는" 사각지대 전용.
// 이 창에선 입력 probe·resume probe·워치독이 모두 안 걸려 오직 하트비트만 동작하는데,
// 기본 15s/35s 로는 half-open 소켓 감지에 ~45s 가 걸려 화면이 멈춘 듯 보인다. 활성 pane 에
// 한해 ping 을 5s 로, dead 임계를 12s 로 좁혀 ~13s 안에 자동 복구한다(ping 2회 연속 무응답
// + 여유가 있어야 dead 판정이라 순간 부하로 pong 이 한 번 늦는 정도로는 오탐하지 않는다).
// ping 이 빨라지는 건 보고 있는 활성 pane 하나뿐이라 공유 터널 부하는 최소. hidden/비활성
// pane 은 위 기본값을 백스톱으로 그대로 쓴다(hidden 은 grace-close 가, 비활성 복귀는 resume
// probe 가 따로 책임).
export const HEARTBEAT_INTERVAL_ACTIVE_MS = 5000;
export const HEARTBEAT_DEAD_ACTIVE_MS = 12000;
/* 임계를 넘겨도 곧장 끊지 않는다 — ping 을 한 번 더 쏘고 이만큼 더 기다린다.
   공유 터널이 잠깐 막혀 pong 두 번이 늦은 것뿐이면 멀쩡한 소켓이다. 그걸 죽이면
   재연결 + tmux 리플레이로 수십 초를 잃는다("가만히 보고 있는데 갑자기 재연결 중"). */
export const HEARTBEAT_LAST_CHANCE_MS = 6000;
// 복귀(focus/visibility) 프로브 판정 시간. 살아있는 소켓 pong 은 보통 1초 미만이라
// 길게 잡을 필요가 없다. 포커스 순간 빠른 복구를 위해 짧게 — 그래도 typical RTT 의 5배+.
export const RESUME_PROBE_TIMEOUT_MS = 2500;
export const RESUME_PROBE_THROTTLE_MS = 1500;
// 서버가 푸시한 사전 티켓을 재연결에 쓸 때 필요한 최소 잔여 유효시간(ms). 핸드셰이크 여유.
export const WS_TICKET_USE_MARGIN_MS = 3000;
// 최근 이 시간 안에 서버로부터 무언가(출력/pong) 를 받았으면 소켓은 살아있음이 증명된
// 상태 — resume probe 를 아예 건너뛴다. 부하로 pong 이 잠깐 늦을 때 멀쩡한 소켓을 닫고
// "네트워크 변경" 알림 + 재연결 프리징이 반복되는 오탐을 막는다. (입력시점 liveness probe 와 동일 가드)
export const HEALTHY_RECV_MS = 3000;
// 재연결 pill 을 이 시간만큼 미뤘다가 보여준다. 이 안에 복구되면 아무것도 안 뜬다.
// 티켓 푸시로 짧은 블립은 보통 1초 안에 다시 붙으므로, 2초 미만 끊김은 완전히 무음으로 지나간다.
export const NOTICE_SHOW_DELAY_MS = 2000;
// xterm 미처리 백로그가 이 바이트를 넘으면 새 출력을 드롭한다(파서가 따라잡을 때까지).
// 대량 출력 flood(예: 여러 pane 동시 출력 + tmux 재연결 redraw)로 브라우저 탭이 통째로
// 멈추는 걸 막는 안전밸브. 드롭된 화면은 다음 안정 시점의 출력/redraw 로 회복된다.
export const MAX_PENDING_WRITE_BYTES = 8 * 1024 * 1024;
// 탭이 비활성 된 뒤 이 시간이 지나면 WebGL 컨텍스트를 반납한다. 탭을 빠르게 휙휙
// 넘길 때 컨텍스트를 만들었다 부쉈다 churn 하지 않게 짧은 유예를 둔다.
export const WEBGL_DETACH_GRACE_MS = 8000;
// 활성·가시 탭이라도 데이터 활동(출력/입력)이 이 시간 동안 없으면 WebGL 컨텍스트를 반납한다.
// cursorBlink 등으로 idle 터미널이 출력 없이도 GPU 렌더 루프를 계속 돌려, 데스크탑 포그라운드
// 탭을 밤새 켜두면 GPU 프로세스가 누적 OOM → 브라우저 "째로" 멈추는 문제를 막는다(JS 힙 OOM 은
// 탭만 죽이지만 GPU 프로세스 사망은 브라우저 전체 freeze). 출력/입력/포커스가 오면 즉시 재부착.
// 3분 — 잠깐의 사고 휴지에는 churn 없고, 밤샘 idle 은 수 분 내 GPU 를 0 으로 떨군다.
export const WEBGL_IDLE_RELEASE_MS = 3 * 60_000;
// WS 가 이 시간 안에 onopen 못 하면 재연결 실패로 보고 중단 (무한 "연결 중..." 방지).
// 정상 핸드셰이크는 터널 경유라도 보통 1~2s — 8s 면 충분히 관대하면서, 죽은 경로에
// 매달린 CONNECTING 좀비를 12s 보다 4s 빨리 끊어 체감 "연결중 갇힘" 창을 줄인다.
export const CONNECT_OPEN_TIMEOUT_MS = 8000;
// resume 신호(online/focus/visible) 시점에 이보다 오래 CONNECTING 인 소켓은 죽은
// 네트워크 경로에서 시작된 좀비로 보고 즉시 떼고 새로 연다. 네트워크 전환 직후
// openTimer(8s) 만료까지 기다리지 않는 빠른 탈출구.
export const STALE_CONNECTING_RESUME_MS = 3000;
// onopen 직후 바로 끊기는 flapping 연결은 성공으로 보지 않는다.
export const RECONNECT_STABLE_RESET_MS = 15000;
// "재연결 중" 배너 교착 워치독. 모바일 네트워크 전환 시 focus/visibility/online/pageshow 가
// 한꺼번에 터지며 비동기 preflight(checkAndRecover) 와 resume 재연결이 엇갈리면, 배너만 남고
// 소켓도 없고 예약된 재연결 타이머도 없는 상태에 드물게 빠진다. 이 경우 markEnded 도 안 불려
// 새로고침 말곤 탈출구가 없다. 워치독이 주기적으로 이 교착을 감지해 강제 재연결한다.
export const RECONNECT_WATCHDOG_POLL_MS = 4000;
// 워치독이 교착을 풀 때, 이 시간 넘게 못 붙었으면 create=true 로 올려 (세션이 사라졌어도)
// 재생성까지 시도한다. 페이지 새로고침은 절대 안 한다 — 끊김은 인페이지로만, mosh 처럼 무한 복구.
export const RECONNECT_ESCALATE_MS = 16000;
// 서버가 "재접속 대상 tmux 세션이 원격에 없음"(session-gone, 원격 exit 42)을 알린 직후의
// close 를 세션 소멸로 식별하는 신선도 창. 이 안의 close 는 create=0 refresh 재시도
// ("[session not found]" 스팸) 대신 곧장 새 세션 생성으로 전환하고 화면에 알린다.
export const SESSION_GONE_SIGNAL_MS = 15000;
// 새로 만든 세션이 이 시간 안에 또 소멸하면(원격이 세션을 유지 못 하는 상태) 생성 루프를
// 끊고 ended 오버레이로 넘긴다 — 수동 재시작 탈출구.
export const SESSION_GONE_LOOP_GUARD_MS = 30000;
// 장기 outage 라운드(keepReconnectingPill)의 백오프 대기(4→8→16→30s) 중 서버 복귀를
// 즉시 감지하는 저부하 프로브. 활성·가시 pane 하나만 /api/health 를 이 주기로 두드리고,
// 성공하면 예약된 백오프를 기다리지 않고 바로 재연결한다 — 서버가 돌아왔는데 데스크탑
// 포커스 탭(resume 이벤트가 영영 안 오는 케이스)이 최대 30s 를 더 기다리던 구멍을 막는다.
export const OUTAGE_PROBE_INTERVAL_MS = 3000;
export const OUTAGE_PROBE_TIMEOUT_MS = 2500;
// 이보다 짧은 백오프 대기에는 프로브를 띄우지 않는다(어차피 곧 재시도).
export const OUTAGE_PROBE_MIN_DELAY_MS = 4000;

// WASM 가용성 프로브 — 최소 유효 wasm 모듈을 동기 컴파일해본다. CSP(특히 Cloudflare
// Zaraz 가 재작성한 script-src)가 wasm-unsafe-eval 을 막으면 CompileError 가 동기로
// 던져진다. 이걸 한 번만 확인해서, 막혀 있으면 ImageAddon 로드를 건너뛴다.
// (안 그러면 매 pane·매 재마운트마다 unhandled CompileError 가 콘솔을 도배하고
//  rejection 이 누적돼 탭이 무거워진다.) CSP 가 풀리면 자동으로 다시 켜진다.
export const WASM_ALLOWED = (() => {
  try {
    new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    return true;
  } catch {
    return false;
  }
})();

export const TMUX_WHEEL_INPUT_RE = /^(?:\x1b\[<(?:64|65);\d+;\d+M)+$/;
