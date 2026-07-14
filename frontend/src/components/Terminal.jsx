/**
 * Terminal 컴포넌트
 * xterm.js 기반 터미널 에뮬레이터 (테마 및 스마트 스크롤 지원)
 */
import { useEffect, useRef, useState, useCallback, useMemo, memo, forwardRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import useSmartScroll from '../hooks/useSmartScroll';
import useTranslation from '../hooks/useTranslation';
import { normalizeTerminalFontFamily } from '../utils/terminalFonts';
import { isTerminalAutoResponse } from '../utils/terminalInput';
import { pushLocalCommand as pushLocalCommandHistory } from '../utils/commandHistory';
import { getNetworkSummary, getTerminalClientId } from '../utils/clientIdentity';
import {
  _textDecoder, _textEncoder,
  RECOVERY_GRACE_MS, RECOVERY_POLL_MS, TAKEOVER_CONFIRM_MS, TAKEOVER_CONFIRM_POLL_MS,
  MAX_RECONNECT_ATTEMPTS, RECONNECT_MAX_WALL_MS, AUTO_CLOSE_MS, LOAD_STUCK_MS,
  HEARTBEAT_INTERVAL_MS, HEARTBEAT_DEAD_MS, HEARTBEAT_INTERVAL_ACTIVE_MS, HEARTBEAT_DEAD_ACTIVE_MS,
  RESUME_PROBE_TIMEOUT_MS, RESUME_PROBE_THROTTLE_MS,
  WS_TICKET_USE_MARGIN_MS, HEALTHY_RECV_MS, NOTICE_SHOW_DELAY_MS,
  WEBGL_DETACH_GRACE_MS, WEBGL_IDLE_RELEASE_MS, CONNECT_OPEN_TIMEOUT_MS, RECONNECT_STABLE_RESET_MS,
  RECONNECT_WATCHDOG_POLL_MS, RECONNECT_ESCALATE_MS,
  STALE_CONNECTING_RESUME_MS, OUTAGE_PROBE_INTERVAL_MS, OUTAGE_PROBE_TIMEOUT_MS,
  OUTAGE_PROBE_MIN_DELAY_MS, SESSION_GONE_SIGNAL_MS, SESSION_GONE_LOOP_GUARD_MS,
} from './terminal/terminalConstants';
import {
  sleep, looksLikeRecoverableBulkInput,
  uploadFileAndGetPath, copyTextToClipboard, issueWsTicket,
} from './terminal/terminalHelpers';
import { TerminalEdgeGutter, AuthPromptOverlay, TerminalContextMenu } from './terminal/TerminalOverlays';
import { CopiedToast, ImagePasteToast, ReconnectPill, TerminalSkeleton, TmuxFallbackBanner } from './terminal/TerminalChrome';
import { ConnectionTroubleCard, ShellClosingCard, ShellEndedCard, TakeoverCard } from './terminal/TerminalStatusCards';
import attachTerminalInteractions from './terminal/attachTerminalInteractions';
import createInputQueue, { isLatencySensitiveInput, WS_BUFFER_HIGH_WATER } from './terminal/createInputQueue';
import createOutputSink from './terminal/createOutputSink';
import createWebglController from './terminal/createWebglController';
import createXtermInstance, { resolveContrast } from './terminal/createXtermInstance';
import { buildWsUrl, fetchSessionClients, wsPathFor } from './terminal/sessionEndpoints';
import { recordDisconnect, recordReconnect } from './terminal/reconnectDiag';
import ensureXtermGlobalStyles from './terminal/xtermGlobalCss';
import useTerminalApi from './terminal/useTerminalApi';
import TerminalTexture from './TerminalTexture';

// xterm 이 래퍼 크기를 그대로 따르게 고정. 분수 셀 잔여는 늘리지 않고
// TerminalEdgeGutter 가 테마색 가장자리로 마감한다.
const TERMINAL_CSS = `
  @keyframes term-skeleton-pulse {
    0%   { opacity: 0.35; }
    50%  { opacity: 0.7; }
    100% { opacity: 0.35; }
  }
  .xterm {
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
  }
  .xterm-scrollable-element { height: 100% !important; }
  .xterm-viewport { height: 100% !important; }
`;

// 디버그 로거 — debug_terminal=1 일 때만 info 를 흘린다. warn/error 는 항상.
const createLogger = (sessionId) => ({
  info: (msg) => {
    if (localStorage.getItem('debug_terminal') === '1') {
      console.log(`[Terminal:${sessionId}] ${msg}`);
    }
  },
  warn: (msg) => console.warn(`[Terminal:${sessionId}] ${msg}`),
  error: (msg, err) => console.error(`[Terminal:${sessionId}] ${msg}`, err),
});

const TerminalComponent = forwardRef(({ sessionId, hostId, isMobile = false, tmuxSuffix = null, tmuxSessionName = null, effectiveTmuxSession = null, settings, onSendData, onBroadcast, isActive = true, isFocused = true, layoutSignal = '', cwd = null, paneIndex = 0, paneId = null, tabId = null, onTakeOver = null, onReadyChange = null, onStatusChange = null, onClosePane = null, onRefresh = null }, ref) => {
  const { t } = useTranslation(settings.language);
  const logger = useMemo(() => createLogger(sessionId), [sessionId]);
  const terminalClientIdRef = useRef(getTerminalClientId());
  const terminalRef = useRef(null);
  const touchOverlayRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const searchAddonRef = useRef(null);
  // 예측 입력(predictive local echo) 엔진 — 키를 RTT 안 기다리고 유령 글자로 먼저 그림.
  const predictiveEchoRef = useRef(null);
  // WebglAddon — 비활성 탭에서는 GPU 페인팅 멈춰서 CPU/배터리 절약 (특히 모바일).
  // 활성화 시 DOM renderer 가 인계 → 활성 복귀 시 새 WebglAddon 재부착.
  // 사용자가 명시적으로 WebGL 끈 경우엔 (settings.useWebgl===false) 자동 재부착 안 함.
  // WebGL 컨텍스트는 활성 탭의 pane 에만 둔다. 브라우저는 WebGL 컨텍스트를 ~16개로
  // 하드 제한하므로, 탭/분할이 많아 pane 이 10+ 개면 컨텍스트 고갈 → 렌더러 OOM 으로
  // 브라우저 탭이 통째로 크래시한다. 비활성 탭은 컨텍스트를 반납(dispose)하고, 활성
  // 복귀 시 재부착. attach/detach 를 isActive effect 에서 호출하기 위한 ref.
  // WebGL 컨트롤러(부착/반납/idle) + 비활성 유예 반납 타이머.
  const webglRef = useRef(null);
  const webglDetachTimerRef = useRef(null);
  // dispose() 만으로는 GPU 컨텍스트가 즉시 안 풀린다(브라우저 지연 회수). 분할 pane 이
  // 많고 attach/detach churn 이 누적되면 회수 대기 컨텍스트가 ~16 한도를 넘겨 "Too many
  // active WebGL contexts" → 컨텍스트 손실 캐스케이드 → 탭 freeze. detach 시 이 컨텍스트를
  // 잡아 WEBGL_lose_context 로 명시 반납해 GPU 자원을 즉시 회수한다.
  // idle(데이터 활동 없음) 시 WebGL 컨텍스트를 반납하는 카운트다운 타이머 + 활동 알림 함수.
  // 비활성 탭에서 누적된 WS 출력을 활성 복귀 시 한 번에 flush 하기 위한 ref.
  // 비활성 grace-close 타이머 + close 가 inactivity 때문이었는지 표시.
  const graceCloseTimerRef = useRef(null);
  const wasClosedForInactivityRef = useRef(false);
  const wsRef = useRef(null);
  const wsGenerationRef = useRef(0);
  // 현재 소켓이 CONNECTING 을 시작한 시각(ms). resume 신호/워치독이 "죽은 경로에 매달린
  // CONNECTING 좀비"를 나이로 판별해 openTimer 만료 전에 끊을 수 있게 한다.
  const wsConnectingSinceRef = useRef(0);
  // 장기 outage 백오프 대기 중 서버 복귀를 감지하는 /api/health 프로브 interval id.
  const outageProbeTimerRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const resizeTrailingTimeoutRef = useRef(null);
  const fitNowRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  // 장애가 길어질수록 자동 재연결 간격을 키우는 백오프 라운드 카운터(콘솔/터널 hammering 방지).
  // OPEN 성공 또는 포커스/online 복귀 시 0 으로 리셋.
  const outageRoundRef = useRef(0);
  const stableReconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const livenessProbeTimerRef = useRef(null);
  const resumeProbeTimerRef = useRef(null);
  const lastResumeProbeAtRef = useRef(0);
  const lastRecvRef = useRef(0);
  // 재연결 진단용 — 하트비트가 죽인 소켓인지, 마지막 끊김이 언제/계획된 것이었는지.
  const heartbeatKilledRef = useRef(false);
  const lastDownRef = useRef(null);
  // 서버가 연결된 WS 위로 미리 밀어준 다음 재연결용 단일사용 티켓 {ticket, expiresAt(ms)}.
  // 재연결 시 이게 유효하면 /api/ws-ticket fetch 없이 바로 WebSocket 을 연다(= Jupyter 처럼
  // fresh TCP 로 wedge 된 HTTP/2 연결 풀을 우회 — 모바일 네트워크 전환 회복력의 핵심).
  const nextTicketRef = useRef(null);
  const authPromptRef = useRef(false);
  // xterm 으로 보낸 뒤 아직 파싱 안 끝난(콜백 미도착) 바이트 수. 부하/대량 출력 시
  // term.write 를 무한정 쌓으면 xterm 내부 write 버퍼가 폭증해 브라우저 탭이 통째로 멈춘다.
  // 이 백로그가 상한을 넘으면 새 출력을 잠깐 버려(드롭) 파서가 따라잡게 한다.
  // 출력 싱크 / 입력 큐 (모듈이 자체 상태를 들고 있고, ref 는 그 핸들만 잡는다).
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const enqueueInputRef = useRef(null);
  const probeLivenessRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  // 연속 재연결을 시작한 시각(ms). 0 이면 현재 재연결 중 아님. OPEN 성공 시 0 으로 리셋.
  // resume 이벤트가 attempts 를 리셋해도 이 값은 유지돼 벽시계 데드라인이 살아있게 한다.
  const reconnectingSinceRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  // checkAndRecover(onclose 후 preflight 폴링)가 도는 동안 true. 워치독이 정상 복구 진행을
  // 교착으로 오인해 끼어들지 않게 하는 가드.
  const recoveringRef = useRef(false);
  // connect() 가 ws-ticket 발급을 await 하는 동안(소켓 아직 없음) true. 워치독/중복 호출이
  // 이 창에서 또 connect 를 띄워 핸드셰이크가 겹치지 않게 한다.
  const connectInFlightRef = useRef(false);
  const lastDimsRef = useRef({ cols: 0, rows: 0 });
  /* 다른 클라이언트가 takeover (tmux attach -d) 했을 때 PTY 출력에 들어오는
     `[detached (from session ...)]` 토큰을 감지해 evictedRef 를 세움. WS close 시 이 ref 가
     true 면 자동 재접속 로직을 모두 skip — 사용자가 직접 "내가 가져오기" 버튼을 눌러야만 재attach. */
  const evictedRef = useRef(false);
  /* 서버 "session-gone"(원격 exit 42 — 재접속 대상 tmux 세션이 원격에 없음) 수신 시각.
     직후의 close 를 "세션 소멸"로 식별해 refresh 재시도 대신 새 세션 생성으로 전환. */
  const sessionGoneAtRef = useRef(0);
  /* 세션 소멸 → 새 세션 생성으로 전환한 시각. 생성 직후 또 소멸이면 루프 방지(ended 전환). */
  const sessionGoneCreateAtRef = useRef(0);
  const endedRef = useRef(false);
  const hasContentRef = useRef(false);
  /* useEffect 내부의 connect()/runPreflight() 를 takeover 버튼/자동 재attach 폴링/탭 활성 변경에서
     호출할 수 있게 ref 로 공개. */
  const connectRef = useRef(null);
  const runPreflightRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [evicted, setEvicted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endedNotice, setEndedNotice] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  // exit 등으로 셸이 종료돼 pane 을 자동으로 닫는 중 — 짧은 취소 카운트다운 표시.
  const [closing, setClosing] = useState(false);
  const autoCloseTimerRef = useRef(null);
  // 로딩이 오래 걸려 멈춘 것으로 보일 때 true — 스켈레톤 위에 수동 닫기 버튼 노출.
  const [loadStuck, setLoadStuck] = useState(false);
  // 연결 실패 원인이 "이 기기(클라이언트) 오프라인"인지 "서버/네트워크 경로"인지 구분해
  // 상태 오버레이 문구/선택지를 그 상황에 맞게만 준다.
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  const [connectionNotice, setConnectionNotice] = useState('');
  // 배너는 디바운스해서 보여준다 — 짧은 끊김이 NOTICE_SHOW_DELAY_MS 안에 복구되면
  // 아예 안 뜨게 해서 "재연결 중" 배너가 자꾸 깜빡이며 프롬프트를 가리는 체감을 없앤다.
  const [noticeVisible, setNoticeVisible] = useState(false);
  // 클립보드 이미지 붙여넣기 진행 상태: 'uploading' | 'done' | 'error' | null
  const [imagePasteState, setImagePasteState] = useState(null);
  // 우클릭 "파일 보내기" 용 숨김 file input — 사진/파일 골라 업로드 후 저장 경로를 터미널에 삽입.
  const fileUploadRef = useRef(null);
  const handleFileChosen = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 가능하게 리셋
    if (!file) return;
    setImagePasteState('uploading');
    try {
      const data = await uploadFileAndGetPath(file);
      xtermRef.current?.paste(`${data.path} `); // 경로 뒤 공백 — 이어서 명령 타이핑
      setImagePasteState('done');
      setTimeout(() => setImagePasteState(null), 1200);
    } catch (err) {
      logger.error('file upload failed', err);
      setImagePasteState('error');
      setTimeout(() => setImagePasteState(null), 2500);
    }
  }, []);
  const reconnectingRef = useRef(false);
  const contentReadyRef = useRef(false);
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // 상태 변화 시 부모에 통지 — evicted, ended, isReady, hasContent 변경마다 호출
  // exit 로 셸이 종료된 게 확인됐을 때: 짧은 취소 여유 후 pane 자동 닫기.
  // onClosePane 이 없으면(닫을 방법 없음) 기존 ended 오버레이로 폴백.
  const beginAutoClose = useCallback(() => {
    if (!onClosePane) {
      endedRef.current = true;
      setEnded(true);
      setEndedNotice('');
      return;
    }
    setClosing(true);
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = setTimeout(() => {
      autoCloseTimerRef.current = null;
      onClosePane();
    }, AUTO_CLOSE_MS);
  }, [onClosePane]);

  const cancelAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setClosing(false);
    // 자동 닫기를 취소하면 수동 액션(닫기/다시 연결)을 고를 수 있게 ended 오버레이로 전환.
    endedRef.current = true;
    setEnded(true);
    setEndedNotice('');
  }, []);

  const markEnded = useCallback((notice = '') => {
    if (outageProbeTimerRef.current) {
      clearInterval(outageProbeTimerRef.current);
      outageProbeTimerRef.current = null;
    }
    endedRef.current = true;
    evictedRef.current = false;
    reconnectingRef.current = false;
    reconnectingSinceRef.current = 0;
    setIsReady(false);
    setReconnecting(false);
    setEvicted(false);
    setClosing(false);
    setConnectionNotice('');
    setEnded(true);
    setEndedNotice(notice);
    onStatusChangeRef.current?.({
      evicted: false,
      ended: true,
      isReady: false,
      hasContent: hasContentRef.current,
      sessionId,
      paneId,
      tabId,
    });
  }, [sessionId, paneId, tabId]);

  // 좀비 소켓(close() 해도 onclose 가 안 오는 모바일 림보 포함)을 wsRef 에서 떼어내고
  // 즉시 기존 셸로 강제 재연결. onclose/워치독 을 기다리지 않는 빠른 복구 경로 — 포커스
  // 복귀 프로브 실패와 워치독 양쪽에서 공용으로 쓴다.
  const forceReconnect = useCallback((ws, { notice = '', create = false } = {}) => {
    if (ws) {
      try { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; } catch { /* noop */ }
      try {
        const rs = ws.readyState;
        if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) ws.close();
      } catch { /* noop */ }
      if (wsRef.current === ws) wsRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    reconnectingSinceRef.current = 0;
    intentionalCloseRef.current = false;
    if (notice) setConnectionNotice(notice);
    connectRef.current?.({ create });
  }, []);

  // 배너 디바운스 — connectionNotice 가 채워져도 NOTICE_SHOW_DELAY_MS 가 지나야 실제 표시.
  // 그 전에 비워지면(빠른 재연결 성공) 배너는 끝내 안 뜬다. 이미 표시 중일 땐 텍스트만
  // 바뀌어도 타이머를 재시작하지 않아 깜빡임이 없다.
  useEffect(() => {
    if (!connectionNotice) {
      setNoticeVisible(false);
      return undefined;
    }
    if (noticeVisible) return undefined;
    const id = setTimeout(() => setNoticeVisible(true), NOTICE_SHOW_DELAY_MS);
    return () => clearTimeout(id);
  }, [connectionNotice, noticeVisible]);

  // 배너 페이드아웃 마운트 유지 — 복구되어 배너가 사라질 때 즉시 언마운트하지 않고
  // 페이드아웃이 끝난 뒤 제거해, 깜빡임 없이 부드럽게 빠진다.
  const [bannerMounted, setBannerMounted] = useState(false);
  const bannerShown = !!connectionNotice && noticeVisible && !ended && !evicted && !closing;
  useEffect(() => {
    if (bannerShown) {
      setBannerMounted(true);
      return undefined;
    }
    if (!bannerMounted) return undefined;
    const id = setTimeout(() => setBannerMounted(false), 240);
    return () => clearTimeout(id);
  }, [bannerShown, bannerMounted]);

  // 재연결 교착 워치독. "재연결 중" 배너가 떠 있는데 아무도 실제 재연결을 안 하는 상태를
  // 주기 점검해 강제 복구한다. 핵심 함정: 모바일에서 ws.close() 를 불러도 onclose 가 영영
  // 안 오는 좀비 소켓이 생긴다 — 이때 isReady 는 true 로 남고(onclose 만 false 로 내림),
  // 소켓은 CLOSING/half-dead OPEN 으로 wsRef 에 박혀 connect() 가드까지 막는다. 그래서
  // 새로고침은 멀쩡한데 인페이지 재연결만 영영 안 됐다. → isReady 에 의존하지 않고,
  // 좀비 소켓을 wsRef 에서 떼어낸 뒤 새 connect 를 띄운다.
  // deps 는 배너 문구 변화(networkReconnect↔sameDevice…)에 stuckSince 가 리셋되지 않게
  // 불리언(hasNotice)으로만 건다.
  const hasNotice = !!connectionNotice;
  useEffect(() => {
    // closing — 셸이 깨끗이 종료돼 pane 자동 닫기 중이면 재연결을 강제하지 않는다.
    if (!hasNotice || ended || evicted || closing) return undefined;
    const stuckSince = Date.now();
    const id = setInterval(() => {
      if (endedRef.current || evictedRef.current) return;
      const ws = wsRef.current;
      const rs = ws?.readyState;

      // 1) 진짜 살아있는 소켓(OPEN + 최근 수신)인데 배너만 남음 → 조용히 닫는다(셀프힐).
      if (rs === WebSocket.OPEN && Date.now() - lastRecvRef.current < HEARTBEAT_DEAD_MS) {
        setConnectionNotice('');
        return;
      }

      // 2) 정상 복구가 진행 중이면 끼어들지 않는다. 갓 시작한 CONNECTING 은 connect() 의
      //    openTimer 가 좀비를 책임지므로 여기선 대기로 둔다. 단, openTimer 만료를 한참
      //    지나도록 CONNECTING 이면(제너레이션 엇갈림 등으로 openTimer 가 죽은 극단 케이스)
      //    영구 "연결 중" 교착이므로 아래로 진행해 강제 재연결한다.
      if (reconnectTimeoutRef.current || recoveringRef.current || connectInFlightRef.current) return;
      if (rs === WebSocket.CONNECTING
          && Date.now() - (wsConnectingSinceRef.current || 0)
             < CONNECT_OPEN_TIMEOUT_MS + RECONNECT_WATCHDOG_POLL_MS * 2) return;

      // 3) 그 외(소켓 없음 / CLOSING / CLOSED / 수신 끊긴 half-dead OPEN) = 교착.
      //    오프라인이면 online 이벤트가 복구를 깨운다 — 그동안은 차분한 pill 만 떠 있게 둔다.
      if (navigator.onLine === false) return;

      // 좀비 소켓을 떼고 강제 재연결. 페이지 새로고침은 하지 않는다 — mosh 처럼 인페이지로
      // 무한 복구하고, 끊김은 구석 pill 로만 차분히 알린다. 16s 넘게 못 붙었으면 create=true 로
      // (세션이 사라졌어도) 재생성까지 시도한다.
      const stuckMs = Date.now() - stuckSince;
      forceReconnect(ws, { create: stuckMs > RECONNECT_ESCALATE_MS });
    }, RECONNECT_WATCHDOG_POLL_MS);
    return () => clearInterval(id);
  }, [hasNotice, ended, evicted, closing, forceReconnect]);

  const clearEndedForReconnect = useCallback(() => {
    endedRef.current = false;
    setEnded(false);
    setEndedNotice('');
    setClosing(false);
  }, []);

  // 연결 실패(인증 아님)로 재연결 버스트를 다 소진했을 때, 막다른 "셸 종료" 오버레이(markEnded)로
  // 끝내지 않고 차분한 재연결 pill 만 유지하며 mosh 식 인페이지 무한 복구를 이어간다.
  // 핵심: attempts 를 0 으로 리셋하지 않는다 — 리셋하면 매번 1s 부터 빠른 버스트가 다시 돌아
  // 콘솔·공유 터널을 도배(hammering)한다. 대신 outage 라운드마다 다음 재시도 간격을 키워
  // (4→8→16→30s) 죽은 터널을 살살 두드린다. 초기 1회 버스트(짧은 블립 즉시 복구)는 그대로 두고,
  // 그 뒤부터 백오프가 먹는다. reconnectTimeoutRef 로 직접 예약하므로 워치독은 끼어들지 않는다.
  // 포커스/online 복귀(handleResume)는 outageRound·attempts 를 0 으로 리셋해 즉시 빠른 재시도.
  const keepReconnectingPill = useCallback((notice) => {
    endedRef.current = false;
    reconnectingSinceRef.current = 0;
    reconnectingRef.current = true;
    setEnded(false);
    setEndedNotice('');
    setClosing(false);
    setReconnecting(true);
    setIsReady(false);
    setConnectionNotice(notice || (t('networkReconnect') || 'Network connection changed. Reconnecting...'));
    const round = (outageRoundRef.current += 1);
    const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(round, 4))); // 4s,8s,16s,30s cap
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connectRef.current?.({ create: false, autoRecover: true });
    }, delay);
    // 긴 백오프 대기 중 서버 복귀 즉시 감지 — 활성·가시 pane 하나만 /api/health 를 저부하로
    // 두드리고, 성공하면 예약된 백오프를 기다리지 않고 바로 재연결한다. 데스크탑 포커스 탭은
    // resume 이벤트(online/focus/visible)가 영영 안 와서 서버가 돌아와도 최대 30s 를 더
    // 기다리던 구멍을 막는다. 실패는 조용히 무시(다음 tick 재시도), 연결되면 connect() 가 정리.
    if (delay >= OUTAGE_PROBE_MIN_DELAY_MS) {
      if (outageProbeTimerRef.current) clearInterval(outageProbeTimerRef.current);
      // down→up "전환"만 조기 재연결 트리거로 쓴다. 첫 프로브부터 성공이면 서버는 원래
      // 살아있는데 WS 쪽만 실패 중인 것 — 조기 재연결해 봐야 3s 주기 hammering 만 되므로
      // 프로브를 접고 라운드 백오프에 맡긴다.
      let sawServerDown = false;
      const probeId = setInterval(() => {
        if (document.hidden || !isActiveRef.current) return;
        if (!reconnectTimeoutRef.current) return; // 대기 중인 재연결이 없으면 프로브 무의미
        if (endedRef.current || evictedRef.current) return;
        fetch('/api/health', {
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(OUTAGE_PROBE_TIMEOUT_MS)
            : undefined,
        }).then((res) => {
          // in-flight 응답이 도착했을 때 이미 다른 라운드/connect 가 이 프로브를 교체·정리했다면 무시.
          if (outageProbeTimerRef.current !== probeId) return;
          if (!res.ok) { sawServerDown = true; return; }
          clearInterval(probeId);
          outageProbeTimerRef.current = null;
          if (!sawServerDown) return; // 서버는 계속 살아있었음 — 백오프 유지
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          connectRef.current?.({ create: false, autoRecover: true });
        }).catch(() => { sawServerDown = true; /* 다음 tick 재시도 */ });
      }, OUTAGE_PROBE_INTERVAL_MS);
      outageProbeTimerRef.current = probeId;
    }
  }, [t]);

  const notifyStatus = useCallback(() => {
    onStatusChangeRef.current?.({
      evicted: evictedRef.current,
      ended: endedRef.current,
      isReady,
      hasContent: hasContentRef.current,
      sessionId,
      paneId,
      tabId,
    });
  }, [sessionId, paneId, tabId, isReady]);

  // 터미널 상태 변화 시마다 부모 통지 (evicted, ended, isReady, hasContent ref 동기화)
  useEffect(() => {
    hasContentRef.current = hasContent;
    notifyStatus();
  }, [evicted, ended, isReady, hasContent, notifyStatus]);

  // 모바일 여부를 이벤트 리스너 내부에서 최신 상태로 참조하기 위함
  const isMobileRef = useRef(isMobile);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  // isActive 를 ref 로도 들고 다님 — handleResize 같은 long-lived 콜백에서 stale closure 피하기.
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const [authPrompt, setAuthPrompt] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [tmuxFallback, setTmuxFallback] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [edgeGutter, setEdgeGutter] = useState({ right: 0, bottom: 0 });
  const edgeGutterRef = useRef(edgeGutter);

  const updateEdgeGutter = useCallback((metrics) => {
    if (!metrics) return;
    const next = {
      right: Math.round(metrics.remainderX * 100) / 100,
      bottom: Math.round(metrics.remainderY * 100) / 100,
    };
    const prev = edgeGutterRef.current;
    if (Math.abs(prev.right - next.right) < 0.5 && Math.abs(prev.bottom - next.bottom) < 0.5) return;
    edgeGutterRef.current = next;
    setEdgeGutter(next);
  }, []);
  // authPrompt 열고 닫을 때 전역 이벤트 — App.jsx 가 모바일 단축키바를 그동안 숨김.
  // 언마운트 시 강제 close — TrueNAS MFA 시도 중 탭 닫으면 App 의 authPromptOpen 이
  // true 로 stuck 되어 모바일바가 전체 탭에서 사라지는 버그 방지.
  useEffect(() => {
    authPromptRef.current = !!authPrompt;
    window.dispatchEvent(new CustomEvent('iterm:auth-prompt', { detail: { open: !!authPrompt } }));
    return () => {
      if (authPrompt) {
        window.dispatchEvent(new CustomEvent('iterm:auth-prompt', { detail: { open: false } }));
      }
    };
  }, [authPrompt]);

  // 언마운트 시 auto-close 타이머 정리 (pane 이 다른 경로로 먼저 닫히는 경우 대비).
  useEffect(() => () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  // 로딩 멈춤 감지 — 콘텐츠가 안 들어오고 다른 오버레이도 없는 상태가 LOAD_STUCK_MS 넘게
  // 지속되면 수동 닫기 버튼을 노출한다. 콘텐츠/연결 회복 시 즉시 해제.
  useEffect(() => {
    if (hasContent || ended || evicted || closing) {
      setLoadStuck(false);
      return;
    }
    const timer = setTimeout(() => setLoadStuck(true), LOAD_STUCK_MS);
    return () => clearTimeout(timer);
  }, [hasContent, ended, evicted, closing, reconnecting]);

  // 온·오프라인 반영 — 상태 오버레이가 "이 기기 오프라인 vs 서버 문제"를 실시간으로 구분.
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // 스마트 스크롤 훅 — xterm buffer API 기반 (DOM scrollTop 아님)
  const { handleUserScroll, handleNewData, forceScrollToBottom } = useSmartScroll(xtermRef, {
    autoScroll: settings.autoScroll,
  });
  // handleNewData 는 autoScroll 설정에 의존하므로 렌더링마다 바뀔 수 있음.
  // useEffect 내부의 flushBufferedOutput 클로저가 항상 최신 콜백을 참조하도록 ref 유지.
  const handleNewDataRef = useRef(handleNewData);
  handleNewDataRef.current = handleNewData;
  const forceScrollToBottomRef = useRef(forceScrollToBottom);
  forceScrollToBottomRef.current = forceScrollToBottom;

  // 테마 가져오기 — settings.theme 이 바뀔 때만 재계산 (매 렌더마다 buildThemeUI 객체
  // 새로 만드는 비용 + 자식 props 변경에 의한 불필요 리렌더 방지).
  const currentTheme = useMemo(
    () => themes[settings.theme] || themes.catppuccin,
    [settings.theme],
  );
  const themeUi = useMemo(() => buildThemeUI(currentTheme), [currentTheme]);
  // [중요] paneIndex 는 connectionKey 에서 제외한다. paneIndex 는 분할 grid 에서의 배열
  // 위치라, 형제 pane 하나를 닫으면 나머지 pane 들의 index 가 밀려 바뀐다. 예전엔 이게
  // connectionKey 를 바꿔 멀쩡히 붙어있던 pane 들이 불필요하게 재연결(WS 재오픈)됐다.
  // 실제 연결 정체성은 sessionId(로컬) / effectiveTmuxSession·tmuxSessionName(호스트)로
  // 충분히 표현된다. 로컬 WS 는 pane_index 를 안 받고, 호스트 WS 도 tmux_session_name 이
  // 있으면 pane_index 를 무시하므로 paneIndex 변화는 연결에 영향이 없다.
  const connectionKey = useMemo(() => JSON.stringify({
    sessionId,
    hostId: hostId || null,
    tmuxSuffix: tmuxSuffix || null,
    tmuxSessionName: tmuxSessionName || null,
    effectiveTmuxSession: effectiveTmuxSession || null,
    cwd: cwd ?? null,
    shell: settings.defaultShell || 'bash',
  }), [sessionId, hostId, tmuxSuffix, tmuxSessionName, effectiveTmuxSession, cwd, settings.defaultShell]);

  // 터미널 생성 및 WebSocket 연결
  useEffect(() => {
    if (!terminalRef.current) return;

    ensureXtermGlobalStyles();

    setIsReady(false);
    setHasContent(false);
    contentReadyRef.current = false;
    hasContentRef.current = false;
    evictedRef.current = false;
    endedRef.current = false;
    // 새 term 생성 — 옛 term 의 미완료 write 콜백은 더 이상 안 오므로 백로그 카운터 리셋.
    onReadyChangeRef.current?.(false);

    // xterm + 애드온 한 벌 생성 후 컨테이너에 부착. 배선은 아래에서.
    const { term, fitAddon, searchAddon, predictiveEcho } = createXtermInstance({
      container: terminalRef.current,
      settings,
      theme: currentTheme,
      paneId,
      sessionId,
      onEdgeGutter: updateEdgeGutter,
    });
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    predictiveEchoRef.current = predictiveEcho;

    const container = terminalRef.current;
    const overlay = touchOverlayRef.current;

    /* 출력 싱크 — WS 바이트를 배치·백프레셔·비활성지연을 거쳐 xterm 에 쓴다. */
    const output = createOutputSink({
      term,
      isActive: () => isActiveRef.current,
      onServerOutput: () => predictiveEchoRef.current?.onServerOutput(),
      onNewData: () => handleNewDataRef.current(),
      onContent: () => {
        setHasContent(true);
        hasContentRef.current = true;
        if (contentReadyRef.current) return;
        contentReadyRef.current = true;
        onReadyChangeRef.current?.(true);
      },
    });
    outputRef.current = output;

    /* 입력 큐 — 청크 분할·백프레셔. 소켓이 닫혀 있어도 버리지 않고 쌓아뒀다 재연결 후 보낸다. */
    const input = createInputQueue({
      getSocket: () => wsRef.current,
      getLastRecvAt: () => lastRecvRef.current,
      onProbeLiveness: () => probeLivenessRef.current?.(),
      onBroadcast: (data) => onBroadcastRef.current?.(data),
      onDisconnected: () => setConnectionNotice(t('networkReconnect') || 'Network connection changed. Reconnecting...'),
    });
    inputRef.current = input;
    enqueueInputRef.current = input.enqueue;


    /* WebGL 렌더러 — DOM 렌더러보다 입력→화면 반영이 빠르고 CPU 도 덜 먹는다.
       기본값: 명시 설정이 없으면 모바일 OFF(저가형 GPU 안정성/배터리) · 데스크탑 ON.
       컨텍스트 수명(비활성 유예 반납 / idle 반납)은 컨트롤러가 관리한다. */
    const explicitWebgl = settings?.useWebgl;
    webglRef.current = createWebglController({
      term,
      enabled: explicitWebgl === undefined ? !isMobileRef.current : explicitWebgl !== false,
      isActive: () => isActiveRef.current,
      debug: localStorage.getItem('debug_terminal') === '1',
    });

    /* 포인터·키보드 배선 — 휠/터치 스크롤 라우팅, 자연 마우스 선택, 붙여넣기(이미지 포함),
       컨텍스트 메뉴, 키 가로채기. detach() 로 한 번에 걷는다. */
    const interactions = attachTerminalInteractions({
      term,
      container,
      overlay,
      input,
      getSocket: () => wsRef.current,
      isMobile: () => isMobileRef.current,
      sessionId,
      logger,
      setContextMenu,
      setCopyFlash,
      setImagePasteState,
    });

    // ⚠️  WS 연결 전에 fit() 동기 호출 — xterm.js 의 cols/rows 와 백엔드/tmux 에
    // 알리는 차원이 일치하도록 한다. 늦게 fit 하면 첫 렌더가 80x24 로 나간 뒤
    // 컨테이너 실제 크기로 리사이즈되며 초기 viewport 가 잘려 빈 화면처럼 보인다.
    try {
      fitAddon.fit();
    } catch (e) {
      // 컨테이너가 아직 0x0 인 극단 케이스 방어
    }
    term.focus();

    /* preflight 로 WS 오픈을 gating. 다른 기기가 이미 attach 중이면 건드리지 않고 evicted
       오버레이만 띄운다 — 사용자가 "내가 가져오기" 를 누를 때까지 기다린다. */
    let cancelled = false;
    const runPreflight = () => fetchSessionClients({
      sessionId,
      hostId,
      tmuxSession: effectiveTmuxSession,
      clientId: terminalClientIdRef.current,
    });

    const scheduleReconnect = (createIfMissing, notice = '') => {
      if (cancelled) return false;
      const attempts = reconnectAttemptsRef.current;
      if (attempts >= MAX_RECONNECT_ATTEMPTS) return false;
      // 벽시계 데드라인 — resume 이벤트가 attempts 를 계속 리셋해도 무한 재연결이 안 되게.
      const now = Date.now();
      if (reconnectingSinceRef.current === 0) {
        reconnectingSinceRef.current = now;
      } else if (now - reconnectingSinceRef.current > RECONNECT_MAX_WALL_MS) {
        return false;
      }
      if (stableReconnectTimerRef.current) {
        clearTimeout(stableReconnectTimerRef.current);
        stableReconnectTimerRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // 첫 재연결은 거의 즉시(150~300ms) — 흔한 짧은 끊김을 새로고침만큼 빠르게 복구한다.
      // 지수 백오프+지터(thundering herd 분산)는 첫 시도가 실패한 뒤부터만 적용해, 반복 실패 시
      // 공유 Cloudflare 터널의 연결 풀을 한꺼번에 때리는 걸 막는 보호는 그대로 유지한다.
      const delay = attempts === 0
        ? 150 + Math.floor(Math.random() * 150)
        : (() => {
            const backoff = Math.min(8000, Math.pow(2, attempts) * 1000);
            return backoff + Math.floor(Math.random() * backoff * 0.5);
          })();
      reconnectAttemptsRef.current = attempts + 1;
      reconnectingRef.current = true;
      setReconnecting(true);
      clearEndedForReconnect();
      if (notice) setConnectionNotice(notice);
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (!cancelled) connectRef.current?.({ create: createIfMissing, autoRecover: true });
      }, delay);
      return true;
    };

    const scheduleExistingReconnect = (notice = t('networkReconnect') || 'Network connection changed. Reconnecting...') => {
      if (cancelled) return false;
      if (scheduleReconnect(false, notice)) return true;
      // 버스트 소진(횟수/벽시계) — 셸이 죽은 게 아니라 연결이 오래 안 붙는 것뿐이므로
      // "셸 종료" 데드엔드 대신 차분한 재연결 pill 로 mosh 식 인페이지 무한 복구를 잇는다.
      // (진짜 셸 종료는 exists=false 확정 → beginAutoClose 경로가 따로 처리한다.)
      keepReconnectingPill(notice);
      return false;
    };

    const connect = async (options = {}) => {
      if (cancelled) return;
      // outage 프로브는 connect 진입 시점에 정리 — 어떤 경로로든 재연결이 시작(또는 이미
      // 연결 존재)하면 더 두드릴 필요가 없다.
      if (outageProbeTimerRef.current) {
        clearInterval(outageProbeTimerRef.current);
        outageProbeTimerRef.current = null;
      }
      // [저부하 가드] 이미 살아있거나(OPEN) 연결 중(CONNECTING)인 소켓이 있으면
      // 그대로 둔다 — 멀쩡한 소켓을 닫고 새로 여는 핸드셰이크 폭주가 공유 Cloudflare
      // 터널을 포화시키는 주범. 중복 connect 호출은 비용 없는 no-op 으로 만든다.
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return;
      }
      // ticket 발급 await 창 동안 워치독/중복 호출이 또 connect 를 띄우지 않게 표시.
      connectInFlightRef.current = true;
      const createIfMissing = options.create !== false;
      const autoRecover = options.autoRecover !== false;
      /* 재연결 시작 — evicted 플래그 리셋. tmux 가 재attach 후 버퍼 리플레이 시
         이전 [detached] 메시지를 다시 내려보내므로 오픈 후 1.5초간 무시. */
      evictedRef.current = false;
      // 새 연결 시도 시작 — 이후 예기치 않은 close 는 다시 자동복구 대상이 되도록 리셋.
      intentionalCloseRef.current = false;
      setEndedNotice('');
      let ignoreDetachUntil = 0;
      const proposed = fitAddon.proposeDimensions();
      const cols = proposed?.cols || term.cols || 80;
      const rows = proposed?.rows || term.rows || 24;
      lastDimsRef.current = { cols, rows };

      const wsPath = wsPathFor({ sessionId, hostId });
      /* [Jupyter 식 재연결] 서버가 연결 중 미리 밀어준 티켓이 아직 유효하면 fetch 를 건너뛰고
         곧장 WebSocket 을 연다. 새 WS 는 fresh TCP 라, 모바일 네트워크 전환으로 wedge 된 공유
         HTTP/2 연결 풀(= /api/ws-ticket fetch 가 영영 매달리던 주범)을 통째로 우회한다. */
      const stashedTicket = nextTicketRef.current;
      nextTicketRef.current = null; // 단일 사용 — 쓰든 안 쓰든 비운다.
      let wsTicket = null;
      let ticketAuthExpired = false;
      if (stashedTicket?.ticket && stashedTicket.expiresAt - Date.now() > WS_TICKET_USE_MARGIN_MS) {
        wsTicket = stashedTicket.ticket;
        connectInFlightRef.current = false;
      } else {
        const ticketResult = await issueWsTicket(wsPath);
        wsTicket = ticketResult.ticket;
        ticketAuthExpired = ticketResult.authExpired;
        connectInFlightRef.current = false;
      }
      if (cancelled) return;
      if (!wsTicket) {
        if (reconnectAttemptsRef.current < 2) logger.warn(`WebSocket ticket 발급 실패: ${sessionId}`);
        if (ticketAuthExpired) {
          /* 세션 만료/로그아웃 — issueWsTicket 이 이미 auth:session-expired 를 쏴서 로그인 화면으로
             전환된다. 여기서 "셸 종료" 오버레이까지 띄우면 로그아웃마다 무서운 에러가 겹쳐 보인다.
             연결 UI 만 조용히 내린다 — 재로그인하면 탭/세션이 자동 복원된다. */
          intentionalCloseRef.current = true;
          reconnectingRef.current = false;
          setReconnecting(false);
          setIsReady(false);
          setConnectionNotice('');
          return;
        }
        if (autoRecover
            && scheduleReconnect(createIfMissing, t('networkReconnect') || 'Network connection changed. Reconnecting...')) {
          return;
        }
        // 버스트를 다 소진해도 막다른 "셸 종료" 로 끝내지 않는다 — 차분한 pill 을 유지하면
        // 워치독이 계속 재시도해 터널/서버가 돌아오면 새로고침 없이 자동 복구된다.
        keepReconnectingPill(t('networkReconnect') || 'Network connection changed. Reconnecting...');
        return;
      }

      const wsUrl = buildWsUrl({
        origin: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`,
        ticket: wsTicket,
        sessionId,
        hostId,
        cols,
        rows,
        shell: settings.defaultShell || 'bash',
        cwd,
        paneIndex,
        tmuxSuffix,
        tmuxSessionName,
        createIfMissing,
        clientId: terminalClientIdRef.current,
      });

      // 새 소켓을 만들기 전, 이전 소켓이 남아있으면 핸들러를 떼고 닫는다.
      // 재연결 폭주 시 옛 소켓이 OPEN 으로 남아 버퍼·핸들러를 누적하는 누수를 차단.
      const prevSocket = wsRef.current;
      if (prevSocket && prevSocket !== null) {
        try { prevSocket.onopen = null; prevSocket.onmessage = null; prevSocket.onclose = null; prevSocket.onerror = null; } catch { /* noop */ }
        try {
          if (prevSocket.readyState === WebSocket.OPEN || prevSocket.readyState === WebSocket.CONNECTING) {
            prevSocket.close();
          }
        } catch { /* noop */ }
      }

      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      wsConnectingSinceRef.current = Date.now();
      const wsGeneration = wsGenerationRef.current + 1;
      wsGenerationRef.current = wsGeneration;
      wsRef.current = socket;

      // onopen 까지 너무 오래 걸리면(열리지도 닫히지도 않는 좀비 소켓) 중단하고 재시도 가능 상태로.
      let openTimer = setTimeout(() => {
        if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
        if (socket.readyState === WebSocket.OPEN) return;
        logger.warn(`WebSocket open 타임아웃 — 중단: ${sessionId}`);
        intentionalCloseRef.current = true; // onclose 가 또 다른 재연결 루프 안 타게
        try { socket.close(); } catch { /* noop */ }
        if (autoRecover && scheduleReconnect(createIfMissing, t('networkReconnect') || 'Network connection changed. Reconnecting...')) {
          return;
        }
        // 좀비 소켓 타임아웃으로 버스트를 다 소진해도 막다른 오버레이로 끝내지 않는다 — 차분한
        // 재연결 pill 을 유지해 워치독이 계속 복구를 시도하게(mosh 식 인페이지 무한 복구).
        keepReconnectingPill(t('networkReconnect') || 'Network connection changed. Reconnecting...');
      }, CONNECT_OPEN_TIMEOUT_MS);
      const clearOpenTimer = () => { if (openTimer) { clearTimeout(openTimer); openTimer = null; } };

      socket.onopen = () => {
        clearOpenTimer();
        if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
        logger.info(`WebSocket 연결 성공: ${sessionId}`);
        if (lastDownRef.current) {
          const { at, planned } = lastDownRef.current;
          lastDownRef.current = null;
          recordReconnect({
            sessionId,
            outageMs: Date.now() - at,
            attempts: reconnectAttemptsRef.current,
            planned,
          });
        }
        if (stableReconnectTimerRef.current) {
          clearTimeout(stableReconnectTimerRef.current);
          stableReconnectTimerRef.current = null;
        }
        setConnectionNotice('');
        // OPEN 성공 — 벽시계 데드라인 리셋. 다음 끊김은 새 재연결 사이클로 친다.
        reconnectingSinceRef.current = 0;
        ignoreDetachUntil = Date.now() + 1500; // tmux 버퍼 리플레이 윈도우
        setIsReady(true);
        outageRoundRef.current = 0; // 연결 성공 — 백오프 라운드 리셋
        // 재연결 성공 — 오버레이 해제
        if (reconnectingRef.current) {
          reconnectingRef.current = false;
          setReconnecting(false);
          clearEndedForReconnect();
          evictedRef.current = false;
          setEvicted(false);
        }
        stableReconnectTimerRef.current = setTimeout(() => {
          stableReconnectTimerRef.current = null;
          if (cancelled || wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
          if (socket.readyState === WebSocket.OPEN) reconnectAttemptsRef.current = 0;
        }, RECONNECT_STABLE_RESET_MS);

        // 재연결로 다시 열렸을 때, 끊겨있는 동안 큐에 쌓인 입력을 즉시 흘려보낸다.
        if (input.hasPending()) input.schedule(0);

        // 하트비트 시작 — half-open 소켓 감지. onopen 직후 lastRecv 초기화.
        lastRecvRef.current = Date.now();
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        // 각 interval 은 자기 id 만 정리 — 재연결로 새 interval 이 떠도 stale tick 이 그걸 끄지 않게.
        const hbId = setInterval(() => {
          if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) {
            clearInterval(hbId);
            if (heartbeatTimerRef.current === hbId) heartbeatTimerRef.current = null;
            return;
          }
          // 백그라운드 탭은 grace-close 가 따로 처리하고, 타이머가 throttle 되어 오탐 위험.
          // 인증 prompt 중에는 사용자가 응답 중이라 끊지 않는다.
          if (document.hidden || authPromptRef.current) return;
          if (socket.readyState !== WebSocket.OPEN) return;
          // 여기 도달 = 가시 탭. 보고 있는 활성 pane 은 짧은 dead 임계로 빠르게 감지하고,
          // 같은 탭의 비활성 pane 은 기본(긴) 임계를 백스톱으로 둔다(복귀 시 resume probe 가 책임).
          const deadMs = isActiveRef.current ? HEARTBEAT_DEAD_ACTIVE_MS : HEARTBEAT_DEAD_MS;
          // 서버 응답(pong 등)이 임계 시간 넘게 없으면 half-open 으로 보고 강제 close → onclose 가 재연결.
          if (Date.now() - lastRecvRef.current > deadMs) {
            heartbeatKilledRef.current = true;
            try { socket.close(); } catch { /* noop */ }
            return;
          }
          try { socket.send(JSON.stringify({ type: 'ping' })); } catch { /* noop */ }
        }, HEARTBEAT_INTERVAL_ACTIVE_MS);
        heartbeatTimerRef.current = hbId;

        // 서버에 현재 크기 무조건 한번 더 전송 — tmux 가 이전 클라이언트 차원으로 잠긴 케이스 강제 갱신.
        const sendResize = () => {
          if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
          try { fitAddon.fit(); } catch {}
          const dims = fitAddon.proposeDimensions();
          const c = dims?.cols || term.cols || 80;
          const r = dims?.rows || term.rows || 24;
          lastDimsRef.current = { cols: c, rows: r };
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
          }
        };
        setTimeout(sendResize, 0);

        // 호스트 세션은 attach 후 SIGWINCH 한 번 더 흔들어서 tmux→shell 재그리기 유도.
        // (Ctrl+L 은 zsh 키바인딩이 없는 환경에선 ^L 노출되므로 사용 안 함)
        if (hostId) {
          setTimeout(() => {
            if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
            if (socket.readyState === WebSocket.OPEN) {
              const dims = fitAddon.proposeDimensions();
              const c = dims?.cols || term.cols || 80;
              const r = dims?.rows || term.rows || 24;
              // 1px 줄였다가 즉시 복원 → SIGWINCH 가 확실히 두 번 전파
              socket.send(JSON.stringify({ type: 'resize', cols: Math.max(20, c - 1), rows: Math.max(5, r - 1) }));
              setTimeout(() => {
                if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
                }
              }, 60);
            }
          }, 150);
        }
      };

    // 데이터 도착 시 활동 신호 — 탭 busy 인디케이터 트리거.
    // 100ms 쓰로틀로 조여 반응성 ↑ (이전 300ms 면 짧은 출력 burst 가 한 번 디스패치되고 끝나
    // busy on/off 가 깜빡 보였음). App.jsx 가 별도 윈도우로 fade-out 처리.
    let lastActivityDispatch = 0;
    const dispatchActivity = () => {
      const now = Date.now();
      if (now - lastActivityDispatch < 100) return;
      lastActivityDispatch = now;
      // 출력 = 활동 → idle 로 반납됐던 WebGL 재부착 + idle 카운트다운 리셋.
      webglRef.current?.noteActivity();
      try {
        window.dispatchEvent(new CustomEvent('iterm:activity', {
          detail: { paneId, tabId, sessionId, hostId, ts: now },
        }));
      } catch {}
    };

    const handleEviction = () => {
      evictedRef.current = true;
      // eviction 이후의 출력은 아무것도 터미널에 닿으면 안 된다.
      output.clear();
      setEvicted(true);
    };

    socket.onmessage = (event) => {
      if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
      // 어떤 메시지든 수신 = 연결 살아있음. 하트비트 워치독 기준 갱신.
      lastRecvRef.current = Date.now();
      // binary array buffer data
      if (event.data instanceof ArrayBuffer) {
        // Fast heuristic check for detached token without decoding large buffers
        if (event.data.byteLength < 500) {
          try {
            const text = _textDecoder.decode(event.data);
            if (text.includes('[detached (from session') && Date.now() > ignoreDetachUntil) {
              handleEviction();
              return; // don't write detach text to terminal
            }
          } catch {}
        }

        output.push(event.data);
        dispatchActivity();
        return;
      }

      /* JSON 프로토콜 메시지 — 인증 prompt (TOTP/2FA) 등. 터미널 출력으로 가지 않게 일찍 분기. */
      if (typeof event.data === 'string' && event.data.length > 1 && event.data[0] === '{' && event.data[event.data.length - 1] === '}') {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.type === 'pong') {
            // 하트비트 응답 — lastRecv 는 위에서 이미 갱신됨. 터미널로 흘리지 않는다.
            return;
          }
          if (msg && msg.type === 'ws_ticket' && msg.ticket) {
            // 다음 재연결용 사전 티켓 stash — 재연결 때 fetch 없이 바로 WS 를 연다.
            nextTicketRef.current = { ticket: msg.ticket, expiresAt: (Number(msg.expires_at) || 0) * 1000 };
            return;
          }
          if (msg && msg.type === 'auth-prompt') {
            setAuthPrompt(msg);
            return;
          }
          if (msg && msg.type === 'tmux-missing') {
            setTmuxFallback(true);
            return;
          }
          if (msg && msg.type === 'session-gone') {
            /* 원격에 재접속 대상 tmux 세션이 없음(호스트 재부팅 등) — 직후 close 에서
               refresh 재시도 대신 새 세션 생성으로 전환한다. 터미널로 흘리지 않는다. */
            sessionGoneAtRef.current = Date.now();
            return;
          }
        } catch { /* JSON 아님, 일반 출력으로 통과 */ }
      }
      /* tmux 가 다른 클라이언트에게 takeover 당해 우리를 detach 시킬 때, 마지막에 보내는
         `[detached (from session ...)]` 한 줄로 의도적 detach 임을 식별 — 네트워크 끊김과 분리. */
      if (typeof event.data === 'string' && event.data.includes('[detached (from session')
          && Date.now() > ignoreDetachUntil) {
        handleEviction();
        return; // don't write detach text to terminal
      }

      // string payload (like detached message, or unhandled json fallback)
      if (typeof event.data === 'string') {
        output.push(_textEncoder.encode(event.data).buffer);
        dispatchActivity();
      }
    };

    socket.onclose = (event) => {
      clearOpenTimer();
      if (stableReconnectTimerRef.current) {
        clearTimeout(stableReconnectTimerRef.current);
        stableReconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;

      const planned = intentionalCloseRef.current || wasClosedForInactivityRef.current;
      recordDisconnect({
        sessionId,
        code: event.code,
        wasClean: event.wasClean,
        intentional: intentionalCloseRef.current,
        graceClosed: wasClosedForInactivityRef.current,
        silentMs: Date.now() - lastRecvRef.current,
        heartbeatKilled: heartbeatKilledRef.current,
        attempts: reconnectAttemptsRef.current,
      });
      heartbeatKilledRef.current = false;
      lastDownRef.current = { at: Date.now(), planned };

      if (intentionalCloseRef.current) return;
      setConnectionNotice(t('networkReconnect') || 'Network connection changed. Reconnecting...');
      setIsReady(false);
      // 재연결 시도 중 실패 — 스피너 해제 (오버레이는 유지)
      if (reconnectingRef.current) {
        reconnectingRef.current = false;
        setReconnecting(false);
      }
      if (!autoRecover) {
        markEnded(t('reconnectExistingShellFailed') || 'No existing shell was found. Start a new shell to continue.');
        return;
      }
      if (evictedRef.current) {
        /* takeover 당함 — 자동 재접속 금지. 사용자가 "내가 가져오기" 버튼으로만 재attach. */
        setEvicted(true);
        return;
      }
      // [세션 소멸] 서버가 session-gone(원격 exit 42) 을 보낸 직후의 close — 호스트 재부팅
      // 등으로 원격 tmux 세션이 통째로 사라졌다. create=0 refresh 재시도는 전부 같은 결과라
      // "[session not found]" 스팸만 반복되므로, 즉시 새 세션 생성(create=1)으로 전환하고
      // 화면(터미널 스크롤백 + 재연결 pill)에 "새 세션 시작"임을 뚜렷이 알린다.
      if (sessionGoneAtRef.current && Date.now() - sessionGoneAtRef.current < SESSION_GONE_SIGNAL_MS) {
        sessionGoneAtRef.current = 0;
        const goneNotice = t('sessionGoneNewStart')
          || 'Previous remote session is gone (host restarted?) — starting a fresh session.';
        if (Date.now() - sessionGoneCreateAtRef.current < SESSION_GONE_LOOP_GUARD_MS) {
          // 방금 새로 만든 세션이 곧바로 또 소멸 — 원격이 세션을 유지 못 하는 상태.
          // 생성 루프 대신 ended 오버레이로 수동 재시작 탈출구를 준다.
          markEnded(goneNotice);
          return;
        }
        sessionGoneCreateAtRef.current = Date.now();
        try {
          term.write(`\r\n\x1b[33m[${goneNotice}]\x1b[0m\r\n`);
        } catch { /* noop */ }
        // 세션 소멸은 확정 신호(SSH 도달 성공 + 세션 부재) — 그동안의 outage 재시도로
        // 소진된 버스트 카운터와 무관한 새 국면이므로 리셋 후 곧장 생성 재연결.
        reconnectAttemptsRef.current = 0;
        reconnectingSinceRef.current = 0;
        scheduleReconnect(true, goneNotice);
        return;
      }
      // [병행 빠른 재연결] 여기 도달 = detach 토큰 없이 끊긴 케이스 — 대부분 평범한 네트워크
      // 블립이다. preflight 응답(정상 수백 ms, 나쁜 망에선 5s 타임아웃)을 기다리지 않고 즉시
      // 첫 재연결(150~300ms)을 예약한다. 사전 푸시 티켓이 있으면 fresh TCP 라 wedge 된
      // HTTP/2 풀도 우회된다. resume 경로(forceReconnect)가 이미 preflight 없이 재연결하는
      // 것과 같은 원칙. takeover/셸 종료로 판명나면 아래 checkAndRecover 가 예약을 걷어낸다.
      scheduleReconnect(false, t('networkReconnect') || 'Network connection changed. Reconnecting...');
      const cancelPendingReconnect = () => {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      // detach token 못 봤어도 server-initiated close 면 takeover 또는 셸 종료 가능성.
      // preflight: attached 면 takeover 오버레이. exists=false 는 전환 레이스일 수 있어
      // 충분히 기다린 뒤에도 재연결을 먼저 시도한다. 병행 재연결과 동시에 돌며, 병행 쪽이
      // 먼저 새 소켓을 열면(isStaleSocket) 이 판정 루프는 조용히 물러난다.
      const checkAndRecover = async () => {
        /* 진단을 접어야 하는 때 = "병행 재연결이 *성공*했을 때" 뿐이다.
           예전엔 새 소켓이 *생기기만* 해도(제너레이션 증가) 접었다. 그런데 병행 재연결은
           150~300ms 만에 무조건 새 소켓을 만들고, 아래 진단은 매 단계 500ms~1s 를 기다린다.
           그래서 진단이 결론에 닿기 전에 늘 접혀버렸다 — 셸이 exit 해도(exists=false) 자동
           닫기가 영영 안 돌고 "재연결 중" pill 만 무한히 도는 상태였다.
           재연결이 아직 못 붙은(CONNECTING/CLOSED) 동안에는 계속 진단한다. */
        const isStaleSocket = () => cancelled
          || (wsRef.current !== socket && wsRef.current?.readyState === WebSocket.OPEN);
        const getPf = async () => {
          try {
            return await (runPreflightRef.current?.() || Promise.resolve({ attached: false, exists: true }));
          } catch {
            return { attached: false, exists: true };
          }
        };
        const confirmTakeover = async () => {
          const deadline = Date.now() + TAKEOVER_CONFIRM_MS;
          let latest = { attached: true, exists: true };
          while (Date.now() < deadline) {
            await sleep(TAKEOVER_CONFIRM_POLL_MS);
            if (isStaleSocket()) return 'stale';
            latest = await getPf();
            if (isStaleSocket()) return 'stale';
            if (latest.same_client_active && !latest.other_client_active) {
              if (latest.network_changed) {
                const net = getNetworkSummary();
                setConnectionNotice(
                  net
                    ? `${t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...'} (${net})`
                    : (t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...')
                );
              }
              return false;
            }
            if (!latest.attached) return false;
          }
          return !!latest.attached;
        };

        const pf = await getPf();
        if (cancelled) return;
        // 병행 재연결이 이미 새 소켓을 열었으면(대개 성공 복구) 낡은 판정은 물러난다.
        if (isStaleSocket()) return;

        if (pf.attached) {
          if (pf.same_client_active && !pf.other_client_active) {
            const sameDeviceNotice = (() => {
              if (!pf.network_changed) return undefined;
              const net = getNetworkSummary();
              return net
                ? `${t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...'} (${net})`
                : (t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...');
            })();
            if (sameDeviceNotice) setConnectionNotice(sameDeviceNotice);
            scheduleExistingReconnect(sameDeviceNotice);
            return;
          }
          const confirmed = await confirmTakeover();
          if (confirmed === 'stale') return;
          if (!confirmed) {
            scheduleExistingReconnect();
            return;
          }
          // 대기 중인 병행 재연결이 있으면 걷어낸다 — connect() 는 진입 시 evicted 플래그를
          // 리셋하므로, 타이머가 살아있으면 eviction 오버레이가 곧바로 풀려버린다.
          cancelPendingReconnect();
          evictedRef.current = true;
          setEvicted(true);
          return;
        }

        if (pf.exists === false) {
          // exists=false 직후는 attach 전환, tmux 재기동, 다른 클라이언트 detach 타이밍과
          // 겹칠 수 있다. 여기서 바로 "셸 종료"로 확정하지 않고 grace window 동안
          // attached/exists 회복을 본 다음, 그래도 없으면 재연결로 세션 재생성을 시도한다.
          const deadline = Date.now() + RECOVERY_GRACE_MS;
          let recovered = false;
          while (Date.now() < deadline) {
            await sleep(RECOVERY_POLL_MS);
            if (isStaleSocket()) return;
            const nextPf = await getPf();
            if (isStaleSocket()) return;
            if (nextPf.attached) {
              const confirmed = await confirmTakeover();
              if (confirmed === 'stale') return;
              if (!confirmed) {
                recovered = true;
                break;
              }
              cancelPendingReconnect();
              evictedRef.current = true;
              setEvicted(true);
              return;
            }
            if (nextPf.exists !== false) {
              recovered = true;
              break;
            }
          }
          if (!recovered) {
            // grace window 내내 세션이 없었음 → exit 등으로 셸이 깨끗이 종료된 것.
            // 재연결/오버레이 대신 짧은 취소 카운트다운 후 pane 을 자동으로 닫는다.
            if (isStaleSocket()) return;
            cancelPendingReconnect(); // 자동 닫기 카운트다운 중 병행 재연결이 끼어들지 않게
            beginAutoClose();
            return;
          }
          // 열린 터미널의 재연결은 기존 세션만 찾는다. 새 셸 생성은 새 탭/새 세션 흐름에서만 한다.
        }

        if (isStaleSocket()) return;
        // 병행 예약이 아직 대기 중이면 그대로 둔다 — 중복 예약은 attempts 만 인플레이션.
        if (reconnectTimeoutRef.current) return;
        // 호스트 네트워크 불안정 (RPi5 wifi 등) 케이스 대응 — 시도 횟수 늘리고 cap 도 큼.
        // 1→2→4→8→8→8…s, 최대 12회 ≈ 1분 30초.
        if (!scheduleReconnect(false, t('networkReconnect') || 'Network connection changed. Reconnecting...')) {
          // 버스트 소진 — 셸이 죽었다는 증거가 없으므로(있으면 exists=false 경로가 처리)
          // "셸 종료" 데드엔드 대신 pill 을 유지하고 저속 백오프로 무한 복구를 계속한다.
          keepReconnectingPill(t('networkReconnect') || 'Network connection changed. Reconnecting...');
        }
      };
      /* recoveringRef — 폴링이 도는 동안 워치독이 정상 복구를 교착으로 오인하지 않게 한다.
         겸해서 진단 중복도 막는다: 재연결이 반복 실패하면 close 마다 진단이 새로 떠서 겹치는데,
         같은 세션을 여러 번 진단해봐야 결론은 같고 beginAutoClose 만 중복 예약된다. */
      if (recoveringRef.current) return;
      recoveringRef.current = true;
      checkAndRecover().finally(() => { recoveringRef.current = false; });
    };

      socket.onerror = (error) => {
        logger.error(`WebSocket 에러: ${sessionId}`, error);
      };
    }; // ← end of connect()

    /* connect/runPreflight 를 외부(takeover 버튼, auto-resume 폴링)에서 부를 수 있게 ref 로 노출. */
    connectRef.current = connect;
    runPreflightRef.current = runPreflight;

    /* mount: 바로 connect. 예전에는 preflight 로 attached 여부를 확인했지만,
       탭 전환/pane 이동으로 인한 unmount→remount 직후 구 WS 가 tmux 에서 아직 등록된
       채로 남아 attached=true 를 반환해 false eviction 오버레이가 뜨는 문제가 있었음.
       진짜 eviction 은 데이터 스트림 내 [detached (from session...)] 토큰으로 감지하므로
       mount preflight 없이도 충분히 보호됨. */
    if (!cancelled) connect();

    // 4. 사용자 입력 처리 — connect() 가 여러 번 호출돼도 (takeover/auto-resume) 항상 최신 ws 를 잡게 ref 사용.
    // 대용량 paste 는 절대 동기 while 루프로 WebSocket.send() 를 몰아넣지 않는다.
    // 브라우저 WebSocket buffer / 서버 receive_text / PTY / tmux / vim 이 모두 별도 속도로 drain 되므로
    // 수 MB~수십 MB 를 한 번에 밀면 UI freeze, WS close, tmux/vim 입력 유실이 생길 수 있다.
    // 입력 시점 빠른 생존 확인 — 사용자가 타이핑하는데 서버로부터 한동안 아무 것도 못 받았으면
    // half-open 의심. ping 을 즉시 쏘고 짧게 기다려 pong(또는 그 외 메시지) 이 안 오면 죽은 소켓으로
    // 보고 재연결. pong 은 셸 상태와 무관하게 브리지가 응답하므로, 비밀번호 입력/장기 실행 명령처럼
    // 에코가 없는 상황에서도 오탐하지 않는다. (35s 하트비트보다 훨씬 빠른 ~3s 복구)
    let lastProbeAt = 0;
    const probeLiveness = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastProbeAt < 2500) return; // 키 입력마다 쏘지 않게 throttle
      lastProbeAt = now;
      const recvBeforeProbe = lastRecvRef.current;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { return; }
      if (livenessProbeTimerRef.current) clearTimeout(livenessProbeTimerRef.current);
      livenessProbeTimerRef.current = setTimeout(() => {
        livenessProbeTimerRef.current = null;
        if (wsRef.current === ws && ws.readyState === WebSocket.OPEN
            && lastRecvRef.current <= recvBeforeProbe) {
          logger.warn(`입력 시점 생존 확인 실패 — 죽은 소켓, 재연결: ${sessionId}`);
          try { ws.close(); } catch { /* noop */ }
        }
        // 부하 큰 서버에서 pong 이 잠깐 늦어도 멀쩡한 소켓을 닫지 않게 4s 로 둔다
        // (resume probe 와 동일 내성). 진짜 죽은 소켓은 35s 하트비트가 백스톱.
      }, RESUME_PROBE_TIMEOUT_MS);
    };
    probeLivenessRef.current = probeLiveness;

    term.onData((data) => {
      // 입력 = 활동 → idle 로 반납됐던 WebGL 재부착 + idle 카운트다운 리셋(타이핑 즉시 또렷하게).
      webglRef.current?.noteActivity();
      if (isTerminalAutoResponse(data)) {
        if (localStorage.getItem('debug_terminal') === '1') {
          console.debug('[xterm] dropped terminal auto-response from input stream', JSON.stringify(data));
        }
        return;
      }
      // term.onData 는 IME 합성 중 매 음절마다 (backspace+새글자) length>=2 청크가 들어와
      // 히스토리가 한 글자씩 쪼개져 저장되는 노이즈가 심하다. 이 경로에서는 더 이상 캡처하지 않고,
      // 서버 히스토리는 sendData() 명시적 호출 경로 (Quick Input / 음성 / MobileToolbar 등) 만 캡처한다.
      // 단 대용량 paste/장문 bulk 입력은 네트워크 절체 때 복구할 수 있게 로컬 최근 5개에만 남긴다.
      if (looksLikeRecoverableBulkInput(data)) {
        try { pushLocalCommandHistory(sessionId, data); } catch { /* noop */ }
      }
      // 예측 입력 — 인쇄 가능 문자면 RTT 안 기다리고 유령으로 즉시 표시(엔진 내부에서 안전 필터).
      predictiveEchoRef.current?.onInput(data);
      // 서버가 한동안 조용했는데 사용자가 타이핑하면, 입력이 실제로 닿는지 빠르게 검증.
      if (Date.now() - lastRecvRef.current > 3000) probeLiveness();
      const ws = wsRef.current;
      // WS 가 아직 OPEN 이 아니거나(reconnect 직후·언마운트 사이 깜빡임) CLOSING 상태여도
      // 입력을 버리지 않고 큐에 적재해 다음 OPEN 또는 flush 틱에 전송. drop 으로 인한
      // "키 씹힘" 의 주요 원인 차단. 단 너무 오래 쌓이지 않게 큐 사이즈 보호.
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        input.enqueue(data, { broadcast: false, delay: 50 });
        return;
      }
      if (isLatencySensitiveInput(data) && !input.hasPending() && ws.bufferedAmount < WS_BUFFER_HIGH_WATER) {
        ws.send(data);
        onBroadcastRef.current?.(data);
        return;
      }
      input.enqueue(data, { broadcast: true, delay: 0 });
    });

    // 스크롤 이벤트 연결
    term.onScroll(() => {
      handleUserScroll();
    });

    // 윈도우/패널 리사이즈 대응.
    // - 데스크탑: rAF 직후 빠르게 1회 fit 해서 열린 pane 들이 즉시 따라오게 한다.
    // - 모바일 visualViewport/키보드: 최종 크기 안정화 후 trailing fit 을 한 번 더 쏴서 떨림과
    //   중간 크기 고정을 동시에 피한다.
    const doFit = (reason = 'resize') => {
      if (!fitAddonRef.current) return;
      const proposed = fitAddonRef.current.proposeDimensions();
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
      fitAddonRef.current.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0
            && (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows)) {
          lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    };
    fitNowRef.current = doFit;

    const scheduleFit = (delay = 0, reason = 'resize') => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        resizeTimeoutRef.current = null;
        requestAnimationFrame(() => doFit(reason));
      }, delay);
    };

    const handleResize = () => {
      // Skip intermediate fits during pane drag — a single fit fires via layoutSignal on mouseup
      if (window.__paneResizingActive) return;
      // 비활성 탭에서는 ResizeObserver 콜백 무시 — 활성화될 때 layoutSignal 효과로 fit 됨.
      if (!isActiveRef.current) return;
      predictiveEchoRef.current?.refreshMetrics(); // 셀 크기 바뀌었을 수 있으니 재측정.
      scheduleFit(isMobileRef.current ? 160 : 32, 'observer');
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      resizeTrailingTimeoutRef.current = setTimeout(() => doFit('observer-trailing'), isMobileRef.current ? 360 : 140);
    };

    const handleGlobalFit = () => {
      if (window.__paneResizingActive) return;
      if (!isActiveRef.current) return;
      scheduleFit(0, 'global');
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      resizeTrailingTimeoutRef.current = setTimeout(() => doFit('global-trailing'), 120);
    };

    // [중요] ResizeObserver를 통한 컨테이너 크기 변화 감지 (에디터 열고 닫기 등 레이아웃 변화 대응)
    const observer = new ResizeObserver(() => handleResize());
    if (terminalRef.current) observer.observe(terminalRef.current);
    window.addEventListener('resize', handleResize);
    window.addEventListener('iterm:fit-terminals', handleGlobalFit);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      cancelled = true;
      intentionalCloseRef.current = true;
      contentReadyRef.current = false;
      onReadyChangeRef.current?.(false);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('iterm:fit-terminals', handleGlobalFit);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      interactions.detach();
      try { wsRef.current?.close(); } catch {}
      connectRef.current = null;
      runPreflightRef.current = null;
      output.dispose();
      outputRef.current = null;
      // dispose 만으로는 GPU 컨텍스트가 GC 때까지 남는다 → pane 닫기/재생성이 잦으면
      // 컨텍스트가 누적돼 한도 초과 freeze. 컨트롤러가 명시 반납(loseContext)까지 한다.
      try { webglRef.current?.dispose(); } catch { /* noop */ }
      webglRef.current = null;
      if (webglDetachTimerRef.current) { clearTimeout(webglDetachTimerRef.current); webglDetachTimerRef.current = null; }
      try { predictiveEchoRef.current?.dispose(); } catch { /* noop */ }
      predictiveEchoRef.current = null;
      if (graceCloseTimerRef.current) clearTimeout(graceCloseTimerRef.current);
      graceCloseTimerRef.current = null;
      wasClosedForInactivityRef.current = false;
      try { term.dispose(); } catch {}
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (outageProbeTimerRef.current) {
        clearInterval(outageProbeTimerRef.current);
        outageProbeTimerRef.current = null;
      }
      if (stableReconnectTimerRef.current) {
        clearTimeout(stableReconnectTimerRef.current);
        stableReconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
      if (livenessProbeTimerRef.current) { clearTimeout(livenessProbeTimerRef.current); livenessProbeTimerRef.current = null; }
      if (resumeProbeTimerRef.current) { clearTimeout(resumeProbeTimerRef.current); resumeProbeTimerRef.current = null; }
      input.dispose();
      inputRef.current = null;
      enqueueInputRef.current = null;
      probeLivenessRef.current = null;
      fitNowRef.current = null;
    };
  }, [connectionKey, updateEdgeGutter]);

  /* evicted 동안 백엔드 폴링 — 다른 기기가 떨어지면(`count == 0`) 사용자 클릭 없이도 자동 재attach.
     "내가 모바일 닫고나서도 여기 사이즈가 작은 상태로 남아있다" 상황을 방지.
     핑퐁 방지: count=0 을 2회 연속 확인한 뒤에만 재attach (단발 0 = 일시적 blip 무시).
     비활성 탭 / 페이지 hidden 일 땐 폴링 중단 — 사용자가 그 탭을 보지 않는데 미리 재attach 할 이유 없음. */
  useEffect(() => {
    if (!evicted || !isActive) return undefined;
    if (!(hostId ? effectiveTmuxSession : sessionId)) return undefined;
    let cancelled = false;
    let zeroStreak = 0;
    const ZERO_THRESHOLD = 2; // 2회 연속 "붙은 사람 없음" 이어야 재attach (단발 0 = blip)
    const tick = async () => {
      if (document.hidden) return; // 안 보이는 탭은 쉰다 — visibilitychange 가 다시 깨운다
      const data = await fetchSessionClients({
        sessionId,
        hostId,
        tmuxSession: effectiveTmuxSession,
        clientId: terminalClientIdRef.current,
      });
      if (cancelled) return;
      if (data.same_client_active && !data.other_client_active) {
        evictedRef.current = false;
        setEvicted(false);
        setConnectionNotice(t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...');
        connectRef.current?.({ create: false });
        return;
      }
      if (data.attached) {
        zeroStreak = 0;
        return;
      }
      zeroStreak += 1;
      if (zeroStreak < ZERO_THRESHOLD) return;
      /* 다른 기기가 다 떨어졌다 → 자동 재attach. remount 없이 WS 만 다시 연다.
         새 attach 가 이 기기의 PTY 크기로 뜨므로 tmux 도 따라서 resize 된다. */
      evictedRef.current = false;
      setEvicted(false);
      connectRef.current?.();
    };
    /* 초기 대기 8s(기기가 안정화될 시간) + 이후 10s 간격으로 폴링. */
    const initial = setTimeout(tick, 8000);
    const id = setInterval(tick, 10000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [evicted, isActive, hostId, effectiveTmuxSession, sessionId]);

  // 테마 및 설정(폰트 크기 등) 변경 시 반영
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = currentTheme;
      xtermRef.current.options.fontSize = settings.fontSize;
      xtermRef.current.options.fontFamily = normalizeTerminalFontFamily(settings.fontFamily);
      xtermRef.current.options.smoothScrollDuration = settings.smoothScroll ? 100 : 0;
      xtermRef.current.options.minimumContrastRatio = resolveContrast(settings.terminalContrast);
      // 예측 유령 색/셀 크기 갱신 — 테마·폰트 바뀌면 다시 측정.
      predictiveEchoRef.current?.setGhostColor(`color-mix(in srgb, ${currentTheme.foreground || '#cdd6f4'} 55%, transparent)`);
      predictiveEchoRef.current?.refreshMetrics();

      // 폰트 크기가 바뀌면 즉시 fit() 을 호출해 그리드 크기 재계산 (xterm.js 내부 캐시 갱신)
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch (e) {}
      }

      // 폰트 변경 후 리사이즈 필요 (폰트 로드 대기를 위해 약간의 지연).
      // hidden(비활성) 탭이면 0×0 이라 fit 스킵 — 가시화될 때 layoutSignal 효과로 다시 fit 됨.
      setTimeout(() => {
        if (!fitAddonRef.current) return;
        const proposed = fitAddonRef.current.proposeDimensions();
        if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          if (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows) {
            lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        }
      }, 50); // 200ms 는 너무 길어 반응이 느려 보이므로 50ms 로 단축
    }
  }, [currentTheme, settings.fontSize, settings.fontFamily, settings.smoothScroll]);

  // 예측 입력 on/off 설정 동기화.
  useEffect(() => {
    predictiveEchoRef.current?.setEnabled(settings.predictiveEcho !== false);
  }, [settings.predictiveEcho]);

  useEffect(() => {
    if (!isActive) return;

    /* 활성 탭이 되는 순간 = 가시 영역이 처음 생기는 순간. rAF 한 프레임 뒤 레이아웃 확정 후 fit.
       단, proposed 치수가 현재 term.cols/rows 와 같으면 fit() 자체를 호출하지 않음 — term.resize 가
       호출되면 같은 dims 라도 xterm 이 refresh 를 돌려 "미세한 확대축소" 처럼 보이는 잔상을 만든다.
       탭 전환 시 dims 가 안 바뀌는 게 절대다수라 이 가드로 시각 변화 0. */
    let rafId = requestAnimationFrame(() => {
      const term = xtermRef.current;
      const fit = fitAddonRef.current;
      if (!term || !fit) return;
      const proposed = fit.proposeDimensions();
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
      if (proposed.cols === term.cols && proposed.rows === term.rows) {
        return;
      }
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        if (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows) {
          lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [layoutSignal, isActive]);

  // Broadcast: onBroadcast prop 은 broadcastActive 변화마다 교체되므로 ref 로 최신 유지
  const onBroadcastRef = useRef(onBroadcast);
  useEffect(() => { onBroadcastRef.current = onBroadcast; }, [onBroadcast]);

  /* 명령형 API — forwardRef(부모 PaneGrid 의 broadcast fan-out) + window.terminalSessions
     (빠른입력·모바일바·팔레트) 양쪽으로 노출. 전부 ref 위에서만 동작한다. */
  const { copyAll } = useTerminalApi({
    refs: {
      xtermRef, wsRef, searchAddonRef,
      enqueueInputRef, forceScrollToBottomRef, fitNowRef, webglRef,
      lastDimsRef, evictedRef, endedRef, hasContentRef,
    },
    forwardedRef: ref,
    sessionId,
    paneId,
    tabId,
    isReady,
  });

  // 키보드 포커스는 visible 한 pane 들 중 "focused" 한 1개에만 줘야 한다.
  // 분할(grid) 레이아웃에서 4 pane 모두 isActive=true 이지만 isFocused 는 1개뿐.
  useEffect(() => {
    if (isActive && isFocused && xtermRef.current && isReady) {
      const timer = setTimeout(() => {
        xtermRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, isFocused, isReady]);

  // 활성 복귀 시 비활성 동안 쌓인 출력을 즉시 flush. tmux 도 별도로 화면 redraw 를 보내옴.
  useEffect(() => {
    if (!isActive) return;
    outputRef.current?.flush();
  }, [isActive]);

  // WebGL 컨텍스트 수명 = 활성 탭에 한정. 비활성 탭은 유예 후 컨텍스트 반납해서
  // pane 이 많아도(여러 탭 × 분할) 브라우저 WebGL 컨텍스트 한도(~16)를 넘지 않게 한다.
  // 이걸 안 하면 컨텍스트 고갈로 렌더러 OOM → 브라우저 탭 전체 크래시.
  useEffect(() => {
    if (isActive) {
      if (webglDetachTimerRef.current) {
        clearTimeout(webglDetachTimerRef.current);
        webglDetachTimerRef.current = null;
      }
      // 부착 + idle 카운트다운 시작(noteActivity 가 둘 다 처리).
      webglRef.current?.noteActivity();
      return undefined;
    }
    // 비활성 — idle 반납 카운트다운은 멈추고, 빠른 탭 전환 churn 방지를 위해 유예 후 반납.
    webglRef.current?.cancelIdle();
    if (webglDetachTimerRef.current) clearTimeout(webglDetachTimerRef.current);
    webglDetachTimerRef.current = setTimeout(() => {
      webglDetachTimerRef.current = null;
      webglRef.current?.detach();
    }, WEBGL_DETACH_GRACE_MS);
    return () => {
      if (webglDetachTimerRef.current) {
        clearTimeout(webglDetachTimerRef.current);
        webglDetachTimerRef.current = null;
      }
    };
  }, [isActive]);

  // Phase 3b — 비활성 탭의 WS 를 grace period 후 close, 활성 복귀 시 즉시 재접속.
  //   - tmux 세션은 백엔드에서 그대로 유지되므로 데이터 손실 없음.
  //   - xterm 버퍼/스크롤백은 dispose 하지 않으므로 사용자에게 보이는 마지막 화면 유지.
  //   - 재접속 시 tmux attach 가 현재 화면을 다시 그려서 자연스럽게 동기화.
  // grace = 60s — 사용자가 잠깐 다른 탭 들렀다 돌아오는 경우엔 close 안 됨 (재접속 비용 0).
  useEffect(() => {
    // 비활성 pane(앱은 보이지만 다른 pane 을 보는 중) — 60s 후 닫아 리소스 절약(기존 동작).
    const INACTIVE_PANE_GRACE_MS = 60_000;
    // 탭 자체를 숨김(다른 브라우저 탭으로 이동/최소화/잠금) — 더 길게. 잠깐 탭 전환에 매번
    // 소켓을 닫으면 복귀 때마다 재연결+tmux 리플레이로 "응답 없는 느낌"이 난다. Chrome 도
    // 보통 5분쯤 지나야 백그라운드 탭을 얼리므로, 그 전까진 소켓을 그대로 둬 즉시 스냅하고,
    // 진짜 오래(밤새) 비울 때만 닫아 리소스 드레인/크래시를 막는다.
    const HIDDEN_TAB_GRACE_MS = 5 * 60_000;
    // "연결을 유지할까?" = 이 pane 이 활성이고 + 브라우저 탭이 화면에 보일 때만.
    // 둘 중 하나라도 아니면 grace 후 소켓을 닫고 완전히 조용해진다(하트비트·티켓·타이머 0).
    // tmux 가 세션을 유지하므로 복귀 시 attach 리플레이로 손실 없이 다시 붙는다.
    const armOrCancel = () => {
      const shouldHold = isActiveRef.current && !document.hidden;
      if (shouldHold) {
        if (graceCloseTimerRef.current) {
          clearTimeout(graceCloseTimerRef.current);
          graceCloseTimerRef.current = null;
        }
        // 백그라운드 동안 타이머 throttle 로 ping 을 못 보냈을 수 있으니, 복귀 시 워치독 기준 리셋.
        lastRecvRef.current = Date.now();
        if (wasClosedForInactivityRef.current && connectRef.current) {
          wasClosedForInactivityRef.current = false;
          // 다음 unexpected close 는 다시 auto-reconnect 흐름 타게 reset.
          intentionalCloseRef.current = false;
          connectRef.current({ create: false });
        }
        return;
      }
      if (graceCloseTimerRef.current) return; // 이미 grace 예약됨
      // 탭을 숨긴 경우(document.hidden)는 길게, 단순 pane 비활성은 짧게.
      const grace = document.hidden ? HIDDEN_TAB_GRACE_MS : INACTIVE_PANE_GRACE_MS;
      graceCloseTimerRef.current = setTimeout(() => {
        graceCloseTimerRef.current = null;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        // evicted/ended overlay 가 떠있으면 사용자 액션 대기 중이므로 건드리지 않음.
        if (evictedRef.current || endedRef.current) return;
        intentionalCloseRef.current = true;
        wasClosedForInactivityRef.current = true;
        try { ws.close(); } catch { /* noop */ }
      }, grace);
    };
    armOrCancel();
    document.addEventListener('visibilitychange', armOrCancel);
    return () => {
      document.removeEventListener('visibilitychange', armOrCancel);
      if (graceCloseTimerRef.current) {
        clearTimeout(graceCloseTimerRef.current);
        graceCloseTimerRef.current = null;
      }
    };
  }, [isActive]);

  // 모바일/백그라운드 복귀 대응.
  // iOS/Android 브라우저는 백그라운드에서 WS 를 OPEN 상태 그대로 얼려두는 경우가 있어,
  // 화면이 다시 보이면 ping 으로 실제 생존을 확인하고 답이 없으면 close 해서 기존 재연결 경로를 태운다.
  useEffect(() => {
    let fitRaf = null;
    let fitTrailing = null;

    const clearResumeProbe = () => {
      if (resumeProbeTimerRef.current) {
        clearTimeout(resumeProbeTimerRef.current);
        resumeProbeTimerRef.current = null;
      }
    };

    const scheduleFitAfterResume = () => {
      if (fitRaf) cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(() => {
        fitRaf = null;
        outputRef.current?.flush();
        fitNowRef.current?.('resume');
      });
      // trailing fit — 복귀/재포커스 직후 한 프레임만으론 visualViewport·포커스 전환으로
      // 레이아웃이 덜 안정돼 살짝 작게 측정→그 크기로 고정되는("쪼그라듦") 문제가 있다.
      // 안정된 뒤 1회 더 fit 해 원래 크기로 복원한다(resize/global fit 의 trailing 패턴과 동일).
      if (fitTrailing) clearTimeout(fitTrailing);
      fitTrailing = setTimeout(() => {
        fitTrailing = null;
        fitNowRef.current?.('resume-trailing');
      }, 180);
    };

    const handleResume = (reason = 'resume') => {
      if (!isActiveRef.current) return;
      if (document.hidden) return;
      if (navigator.onLine === false) return;
      if (authPromptRef.current || evictedRef.current || endedRef.current) return;

      if (graceCloseTimerRef.current) {
        clearTimeout(graceCloseTimerRef.current);
        graceCloseTimerRef.current = null;
      }

      scheduleFitAfterResume();

      // 소켓이 살아있거나(OPEN) 연결 중(CONNECTING)이면 재연결하지 않는다 — 헬시
      // 소켓을 닫고 새로 여는 핸드셰이크 폭주가 공유 Cloudflare 터널을 포화시키는 주범.
      const ws = wsRef.current;
      if (wasClosedForInactivityRef.current
          || !ws
          || ws.readyState === WebSocket.CLOSED
          || ws.readyState === WebSocket.CLOSING) {
        wasClosedForInactivityRef.current = false;
        intentionalCloseRef.current = false;
        // 백오프를 base 로 리셋하고(포커스/online 복귀는 즉시 빠른 재시도), 대기 중인 단일
        // 재연결 타이머를 먼저 비운다 — 즉시 재연결과 예약된 재연결이 겹쳐 중복 핸드셰이크가 나가지 않게.
        reconnectAttemptsRef.current = 0;
        outageRoundRef.current = 0;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        // connect 가드(이미 OPEN/CONNECTING이면 no-op)가 중복 호출을 비용 없이 막는다.
        connectRef.current?.({ create: false });
        return;
      }

      // CONNECTING — 갓 시작한 핸드셰이크는 그대로 둔다(probe 도 안 쏜다, 부하 0).
      // 단, 죽은 네트워크 경로에서 시작돼 3s 넘게 매달린 CONNECTING 은 openTimer 만료까지
      // 기다리면 "연결 중"에 갇혀 보인다 — 지금이 바로 네트워크가 돌아온 순간(online/focus/
      // visible)이므로 좀비를 즉시 떼고 fresh 소켓으로 새로 연다.
      if (ws.readyState === WebSocket.CONNECTING) {
        if (Date.now() - (wsConnectingSinceRef.current || 0) > STALE_CONNECTING_RESUME_MS) {
          logger.warn(`복귀 신호 시점에 stale CONNECTING(${reason}) — 좀비 소켓 교체: ${sessionId}`);
          forceReconnect(ws, { notice: t('networkReconnect') || 'Network connection changed. Reconnecting...' });
        }
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      // 최근에 데이터를 받았으면 소켓 생존이 이미 증명됨 — probe 불필요.
      // 활성 터미널을 포커스할 때마다 멀쩡한 소켓을 닫던 오탐의 주원인 차단.
      if (now - lastRecvRef.current < HEALTHY_RECV_MS) return;
      if (now - lastResumeProbeAtRef.current < RESUME_PROBE_THROTTLE_MS) return;
      lastResumeProbeAtRef.current = now;

      const recvBeforeProbe = lastRecvRef.current;
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // ping 조차 못 보내는 죽은 소켓 — 즉시 떼고 재연결.
        forceReconnect(ws);
        return;
      }

      clearResumeProbe();
      resumeProbeTimerRef.current = setTimeout(() => {
        resumeProbeTimerRef.current = null;
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (authPromptRef.current || evictedRef.current || endedRef.current) return;
        if (lastRecvRef.current > recvBeforeProbe) return;
        logger.warn(`복귀 후 WS 생존 확인 실패(${reason}) — 재연결: ${sessionId}`);
        // onclose 를 기다리지 않고 즉시 좀비를 떼고 재연결한다 — 모바일은 close() 해도
        // onclose 가 영영 안 와 워치독(4s 폴링)까지 기다리던 지연을 없앤다.
        forceReconnect(ws, { notice: t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...' });
      }, RESUME_PROBE_TIMEOUT_MS);
    };

    const onVisibility = () => {
      if (!document.hidden) handleResume('visible');
    };
    const onPageShow = () => handleResume('pageshow');
    const onFocus = () => handleResume('focus');
    const onOnline = () => handleResume('online');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      clearResumeProbe();
      if (fitRaf) cancelAnimationFrame(fitRaf);
      if (fitTrailing) clearTimeout(fitTrailing);
    };
  }, [sessionId, forceReconnect, t]);

  // WebGL 컨텍스트 수명 관리는 위 isActive effect(부착/유예반납) + noteWebglActivity(idle 반납·
  // 활동 재부착)가 함께 처리한다. 빠른 탭 전환 churn 은 유예(WEBGL_DETACH_GRACE_MS)로, idle 반납
  // repaint 는 활동(출력/입력/포커스) 시점에 묻혀 사용자 눈에 거의 안 띈다.

  /* 상태 카드의 버튼으로 사용자가 직접 거는 재연결.
     이미 시도 중이면 무시(중복 핸드셰이크 방지). connect 가 아직 없으면(effect 정리 직후 등)
     새로고침으로 폴백한다. 아래 네 핸들러가 이 가드를 공유한다. */
  const beginManualReconnect = () => {
    if (reconnectingRef.current) return false;
    reconnectingRef.current = true;
    setReconnecting(true);
    return true;
  };

  // 연결 실패 카드의 "다시 시도" — autoRecover:false 라 실패하면 재연결 버스트를 돌지 않는다.
  const handleRetryConnect = () => {
    if (!beginManualReconnect()) return;
    setLoadStuck(false);
    reconnectAttemptsRef.current = 0;
    if (connectRef.current) connectRef.current({ create: false, autoRecover: false });
    else window.location.reload();
  };

  // takeover 카드의 "내가 가져오기" — tmux attach -d 로 세션을 되찾는다.
  const handleTakeOver = () => {
    if (!beginManualReconnect()) return;
    if (connectRef.current) connectRef.current();
    else if (onTakeOver) onTakeOver();
    else window.location.reload();
  };

  // 종료 카드 — 기존 셸에 다시 붙는다(없으면 실패).
  const handleReconnectExisting = () => {
    if (!beginManualReconnect()) return;
    clearEndedForReconnect();
    reconnectAttemptsRef.current = 0;
    if (connectRef.current) connectRef.current({ create: false });
    else window.location.reload();
  };

  // 종료 카드 — 새 셸을 만든다(create:true).
  const handleRestartShell = () => {
    if (!beginManualReconnect()) return;
    clearEndedForReconnect();
    reconnectAttemptsRef.current = 0;
    if (connectRef.current) connectRef.current({ create: true });
    else window.location.reload();
  };

  return (
    <>
      <style>{TERMINAL_CSS}</style>

      {/* 스켈레톤: 첫 콘텐츠가 그려지기 전까지 표시 */}
      {!hasContent && <TerminalSkeleton themeUi={themeUi} />}

      {/* 로딩이 오래 멈춰 있을 때 — 어느 쪽(이 기기 vs 서버) 문제인지 명시하고,
          그 상황에서 실제로 되는 선택지만 준다. */}
      {loadStuck && !hasContent && !ended && !evicted && !closing && (
        <ConnectionTroubleCard
          themeUi={themeUi}
          t={t}
          isOffline={isOffline}
          reconnecting={reconnecting}
          onClosePane={onClosePane}
          onRetry={handleRetryConnect}
        />
      )}

      {/* xterm.js 컨테이너 — 좌/우/상에 약간의 호흡 패딩.
          fitAddon 은 element.clientWidth(=content box, padding 제외) 기준이라 cols 자동 계산 정확.
          tmux 안 건드림. */}
      <div
        ref={terminalRef}
        onClick={() => {
          if (xtermRef.current) {
            xtermRef.current.focus();
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          background: currentTheme.background,
          overflow: 'hidden',
          // 재연결 중(로딩 pill 표시)엔 살짝 디밍해 "지금 stale" 신호를 준다. opacity 만 써서
          // 컴포지터 단계에서만 처리 → 커서/렌더 비용 0. 복구되면 부드럽게 원래 밝기로.
          opacity: !hasContent ? 0 : (bannerShown ? 0.5 : 1),
          transition: 'opacity 0.22s ease',
          caretColor: 'transparent',
          outline: 'none',
        }}
      />

      {/* 테마 질감 오버레이 (CRT 주사선 / 네온 비네트). 정적 CSS 라 pane 마다 얹어도 비용 0.
          콘텐츠가 그려진 뒤에만 표시해 스켈레톤 위에 얹히지 않게 한다. */}
      {hasContent && (
        <TerminalTexture
          texture={currentTheme.texture}
          accent={currentTheme.ui?.accent || currentTheme.foreground}
        />
      )}

      <TerminalEdgeGutter
        right={edgeGutter.right}
        bottom={edgeGutter.bottom}
        themeUi={themeUi}
      />

      {/* 모바일 터치 오버레이: canvas 위에 깔아 touch-action:none + passive:false 스크롤 보장.
          iOS는 이 div가 터치 타깃이 되므로 scroll 제스처를 선점하지 않음.
          onClick으로 터미널 포커스(iOS 키보드)도 처리. */}
      {isMobile && (
        <div
          ref={touchOverlayRef}
          aria-hidden="true"
          onClick={() => xtermRef.current?.focus()}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            cursor: 'default',
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}

      {/* context menu — 우클릭 시 복사/붙여넣기/전체복사/하단스크롤 */}
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          themeUi={themeUi}
          t={t}
          onCopy={() => {
            const sel = xtermRef.current?.getSelection();
            if (sel) copyTextToClipboard(sel);
            setContextMenu(null);
          }}
          onCopyAll={() => {
            copyAll();
            setContextMenu(null);
          }}
          onPaste={async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text && xtermRef.current) {
                xtermRef.current.paste(text);
              }
            } catch {}
            setContextMenu(null);
          }}
          onRefresh={onRefresh ? () => { setContextMenu(null); onRefresh(); } : null}
          onScrollToBottom={() => {
            xtermRef.current?.scrollToBottom();
            setContextMenu(null);
          }}
          onUploadFile={() => { fileUploadRef.current?.click(); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}
      {/* 우클릭 "파일 보내기" 트리거용 숨김 input — 사진/파일 아무거나. */}
      <input
        ref={fileUploadRef}
        type="file"
        onChange={handleFileChosen}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* "Copied!" 토스트 — 드래그 선택 후 자동 복사 시 짧게 표시 */}
      {copyFlash && <CopiedToast themeUi={themeUi} t={t} />}

      <ImagePasteToast state={imagePasteState} themeUi={themeUi} t={t} />

      {tmuxFallback && (
        <TmuxFallbackBanner themeUi={themeUi} t={t} onDismiss={() => setTmuxFallback(false)} />
      )}

      {/* 재연결 pill — 짧은 끊김은 아예 안 뜨고(디바운스), 길어지면 스피너. 복구되면 스르륵 사라진다. */}
      {bannerMounted && (
        <ReconnectPill themeUi={themeUi} t={t} isOffline={isOffline} visible={bannerShown} />
      )}

      {evicted && (
        <TakeoverCard
          themeUi={themeUi}
          t={t}
          reconnecting={reconnecting}
          onTakeOver={handleTakeOver}
        />
      )}

      {closing && !evicted && (
        <ShellClosingCard themeUi={themeUi} t={t} onUndo={cancelAutoClose} />
      )}

      {ended && !evicted && !closing && (
        <ShellEndedCard
          themeUi={themeUi}
          t={t}
          notice={endedNotice}
          reconnecting={reconnecting}
          onClosePane={onClosePane}
          onReconnect={handleReconnectExisting}
          onRestart={handleRestartShell}
        />
      )}

      {/* SSH keyboard-interactive (TOTP/OTP/2FA) 챌린지 prompt — 호스트 연결 직전에 백엔드가 트리거. */}
      {authPrompt && (
        <AuthPromptOverlay
          prompt={authPrompt}
          themeUi={themeUi}
          t={t}
          onSubmit={(values) => {
            try {
              wsRef.current?.send(JSON.stringify({ type: 'auth-response', values }));
            } catch { /* noop */ }
            setAuthPrompt(null);
            setTimeout(() => xtermRef.current?.focus(), 100);
          }}
          onCancel={() => {
            try {
              wsRef.current?.send(JSON.stringify({ type: 'auth-cancel' }));
            } catch { /* noop */ }
            setAuthPrompt(null);
            // 명시적 취소 — 자동 재연결 막고 WS 닫음. 사용자가 host 카드에서 다시 시도.
            intentionalCloseRef.current = true;
            try { wsRef.current?.close(); } catch { /* noop */ }
            // 화면에 cancelled 상태 — ended 오버레이로 "다시 시작" 노출.
            endedRef.current = true;
            setEnded(true);
          }}
        />
      )}
    </>
  );
});

export default memo(TerminalComponent);
