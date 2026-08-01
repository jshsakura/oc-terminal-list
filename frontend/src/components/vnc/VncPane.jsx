/**
 * VNC pane 컨테이너 — WS 티켓 라이프사이클 + RFB 연결을 소유한다.
 * Terminal.jsx 의 WS 재연결 패턴(티켓 발급 → URL 조립 → 연결 → 정리)을 미러한다.
 *
 * 터미널과 달리 자동 재연결 로직은 단순화했다 — VNC 세션은 상태 저장 스트림이므로
 * 재연결 시 전체 화면을 다시 그려야 하며, noVNC RFB 가 내부적으로 한 번 시도한다.
 * 사용자는 상태 배지로 연결 상태를 보고 필요시 새로고침할 수 있다.
 */
import { useEffect, useRef, useState } from 'react';
import { tokens } from '../../styles/tokens';
import { issueWsTicket } from '../terminal/terminalHelpers';
import createVncClient from './createVncClient';
import { computeVncResize, createResizeScheduler } from '../../utils/vncResize';

const { color, font, fontSize, fontWeight, radius } = tokens;

/**
 * VNC WS URL 조립 — 터미널 buildWsUrl 과 모양이 다르다(/ws/vnc/<host> + display 쿼리).
 * 터미널 전용 buildWsUrl 은 cols/rows/shell/tmux 등 터미널 파라미터를 강제하므로
 * 여기서 VNC 전용 URL 을 직접 조립한다(티켓·display·client_id 만 포함).
 */
const buildVncWsUrl = ({ origin, path, ticket, display, clientId }) => {
  const params = new URLSearchParams();
  // 티켓이 없어도 same-origin 쿠키로 폴백 인증되므로 파라미터를 생략한다(ws_auth.py).
  if (ticket) params.set('ticket', ticket);
  if (display != null && display !== '') params.set('display', String(display));
  params.set('client_id', clientId);
  return `${origin}${path}?${params.toString()}`;
};

const STATUS_COLOR = {
  connecting: color.warning,
  connected: color.success,
  disconnected: color.muted,
  error: color.danger,
};

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

const VncPane = ({ hostId, display, isActive, isFocused, settings, t, onReadyChange }) => {
  const containerRef = useRef(null);
  const clientRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  // Phase 5 — 탭 숨김/활성 전환 추적. Xvnc 세션은 상태 저장 스트림이라 연결을
  // 끊었다 다시 붙여도 화면이 손실되지 않는다. 그래서 탭이 숨거나 pane 이
  // 비활성일 때 연결을 끊고(=WS·CPU 절약), 다시 보일 때 재연결한다.
  const [docHidden, setDocHidden] = useState(
    () => (typeof document !== 'undefined' ? document.hidden : false),
  );
  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const validDisplay = display != null && display !== '' && !Number.isNaN(Number(display));

  // clientId — 마운트마다 한 번 생성(재연결 식별용). crypto.randomUUID 우선, 폴백 Math.random.
  const clientIdRef = useRef(null);
  if (!clientIdRef.current) {
    try {
      clientIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `vnc-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    } catch {
      clientIdRef.current = `vnc-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
  }

  // 콜백을 ref 로 — 효과 재실행(=재연결) 없이 항상 최신 콜백을 호출.
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  const tRef = useRef(t);
  tRef.current = t;

  // Phase 4 — 원격 해상도 자동 추적 상태. lastSentRef: 마지막으로 보낸 framebuffer
  // 치수(중복 SetDesktopSize 방지). resizeSchedulerRef: 250ms 디바운스 스케줄러.
  const lastSentRef = useRef(null);
  const resizeSchedulerRef = useRef(null);

  useEffect(() => {
    // isActive=false(다른 pane 이 포커스) 거나 docHidden(탭 숨김) 이면 연결 안 한다.
    // 정리 함수가 기존 연결을 끊으므로, 비활성/숨김 전환 시 자동으로 disconnect 된다.
    if (!hostId || !validDisplay || !isActive || docHidden) return undefined;

    let cancelled = false;
    let destroyClient = null;
    // ro·scheduler 는 async 블록 안에서 만들어지지만 cleanup 에서 해제해야 하므로
    // effect 스코프에 선언해 둔다(async 가 끝나기 전에 cleanup 이 돌면 undefined).
    let ro = null;
    let scheduler = null;

    const origin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const wsPath = `/ws/vnc/${hostId}`;

    (async () => {
      // [티켓 발급] 터미널과 동일한 issueWsTicket 사용 — 같은 /api/ws-ticket 엔드포인트,
      // path 스코프만 /ws/vnc/<host> 로 다르다. 발급 실패해도 쿠키 폴백으로 부트스트랩.
      const { ticket, authExpired } = await issueWsTicket(wsPath);
      if (cancelled) return;
      if (authExpired) {
        // issueWsTicket 이 auth:session-expired 를 이미 발화 → 로그인으로 전환됨.
        // 여기서 에러 오버레이를 띄우면 로그아웃마다 무서운 에러가 겹쳐 보인다.
        setStatus('disconnected');
        return;
      }
      if (!containerRef.current) return;

      const url = buildVncWsUrl({
        origin,
        path: wsPath,
        ticket,
        display,
        clientId: clientIdRef.current,
      });

      try {
        const client = await createVncClient({
          container: containerRef.current,
          url,
          onConnected: () => { if (!cancelled) setStatus('connected'); },
          onDisconnected: () => { if (!cancelled) setStatus('disconnected'); },
          onCredentialsRequired: () => {
            if (!cancelled) {
              setStatus('error');
              setErrorMsg(tRef.current?.('vncCredentialsRequired') || 'VNC credentials required');
            }
          },
          onSecurityFailure: (detail) => {
            if (!cancelled) {
              setStatus('error');
              setErrorMsg(detail?.reason
                || tRef.current?.('vncSecurityFailure')
                || 'VNC security negotiation failed');
            }
          },
        });
        if (cancelled) { client.destroy(); return; }
        clientRef.current = client;
        destroyClient = client.destroy;

        // 리사이즈 스케줄러 — 드래그 중 remote resize 차단, 250ms 안정 후 1회 SetDesktopSize.
        scheduler = createResizeScheduler({
          onApply: () => {
            const c = clientRef.current;
            if (!c?.rfb || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const { resize } = computeVncResize({
              proposed: { width: rect.width, height: rect.height },
              connected: true,
              lastSent: lastSentRef.current,
            });
            if (resize) {
              lastSentRef.current = resize;
              // resizeSession=true 세터가 noVNC _requestRemoteResize() 를 즉시 트리거 →
              // 현재 컨테이너 크기를 읽어 SetDesktopSize PDU 1회 전송.
              c.rfb.resizeSession = true;
            }
          },
          debounceMs: 250,
        });
        resizeSchedulerRef.current = scheduler;

        ro = new ResizeObserver(() => {
          const c = clientRef.current;
          if (!c?.rfb) return;
          // 드래그 중 remote resize 즉시 차단. 시각적 스케일링(scaleViewport/_updateScale)은
          // _resizeSession 이 아닌 _scaleViewport 를 검사하므로 계속 동작한다.
          c.rfb.resizeSession = false;
          scheduler.schedule();
        });
        if (containerRef.current) ro.observe(containerRef.current);
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err?.message || String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      // destroyClient(=client.destroy) 를 우선 호출 — createVncClient 가 반환한 정리 함수.
      // 아직 client 가 만들어지지 않았다면(clientRef.current 없음) 정리할 것도 없다.
      ro?.disconnect();
      scheduler?.cancel();
      if (destroyClient) destroyClient();
      clientRef.current = null;
      resizeSchedulerRef.current = null;
    };
    // hostId·display·활성/가시성 만 재연결 트리거 — settings/t 는 ref 로 추적하므로 deps 에 넣지 않는다.
  }, [hostId, display, validDisplay, isActive, docHidden]);

  // ready 상태 보고 — Terminal 의 onReadyChange={setTerminalReady} 와 대응.
  useEffect(() => {
    onReadyChangeRef.current?.(status === 'connected');
  }, [status]);

  // display 누락/무효 — 에러 메시지.
  if (!hostId || !validDisplay) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.base,
        color: color.subtext,
        fontFamily: font.sans,
        fontSize: fontSize['13'],
        padding: '16px',
        textAlign: 'center',
      }}>
        {t?.('vncInvalidDisplay') || 'No VNC display selected.'}
      </div>
    );
  }

  // Phase 5 — pane 비활성 또는 탭 숨김. display 는 유효하지만 연결하지 않는다:
  // 유효한 display 인데 inactive/hidden 이면 일시정지 오버레이. 연결은 effect guard 가
  // 이미 막았고, 여기서 사용자에게 왜 빈 화면인지 알려준다. 다시 활성/가시 상태가
  // 되면 effect 가 재실행되어 자동 재연결된다.
  if (!isActive || docHidden) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.base,
        color: color.subtext,
        fontFamily: font.sans,
        fontSize: fontSize['13'],
        padding: '16px',
        textAlign: 'center',
      }}>
        {t?.('vncPaused') || 'VNC paused — tab inactive'}
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: color.base,
      overflow: 'hidden',
    }}>
      {/* RFB 캔버스가 붙는 컨테이너 — scaleViewport=true 가 이 영역에 맞춰 스케일. */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 연결 상태 배지 — 터미널 connection badge 스타일 미러. 연결 중/끊김/에러일 때만 표시. */}
      {status !== 'connected' && (
        <div style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          zIndex: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: `color-mix(in srgb, ${color.surface1} 85%, transparent)`,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          fontFamily: font.sans,
          fontSize: fontSize['11'],
          fontWeight: fontWeight.medium,
          color: color.subtext,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}>
          <span style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: STATUS_COLOR[status] || color.muted,
            flexShrink: 0,
            ...(status === 'connecting' ? {
              animation: 'iterm-vnc-pulse 1.2s ease-in-out infinite',
            } : null),
          }} />
          {t?.(`vncStatus_${status}`) || STATUS_LABEL[status]}
        </div>
      )}

      {/* 에러 메시지 오버레이 — 보안 실패/자격증명 요구/연결 예외. */}
      {errorMsg && (
        <div style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          right: '8px',
          zIndex: 10,
          padding: '8px 12px',
          background: `color-mix(in srgb, ${color.danger} 14%, ${color.surface0})`,
          border: `1px solid color-mix(in srgb, ${color.danger} 40%, transparent)`,
          borderRadius: radius.md,
          fontFamily: font.sans,
          fontSize: fontSize['12'],
          color: color.danger,
          pointerEvents: 'none',
        }}>
          {errorMsg}
        </div>
      )}

      {/* connecting 펄스 애니메이션 키프레임 — 인라인 <style> 로 스코프 누수 없이 주입. */}
      <style>{`
        @keyframes iterm-vnc-pulse {
          0%, 100% { opacity: 0.5; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default VncPane;
