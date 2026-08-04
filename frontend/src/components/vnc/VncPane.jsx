/**
 * VNC pane 컨테이너 — WS 티켓 라이프사이클 + RFB 연결을 소유한다.
 * Terminal.jsx 의 WS 재연결 패턴(티켓 발급 → URL 조립 → 연결 → 정리)을 미러한다.
 *
 * 터미널과 달리 자동 재연결 로직은 단순화했다 — VNC 세션은 상태 저장 스트림이므로
 * 재연결 시 전체 화면을 다시 그려야 하며, noVNC RFB 가 내부적으로 한 번 시도한다.
 * 사용자는 상태 배지로 연결 상태를 보고 필요시 새로고침할 수 있다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, ChevronLeft, ChevronRight } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { issueWsTicket } from '../terminal/terminalHelpers';
import createVncClient from './createVncClient';
import { computeVncResize, createResizeScheduler } from '../../utils/vncResize';

const { color, font, fontSize, fontWeight, radius } = tokens;

// VNC 화질/압축 프리셋 — 3 단면으로 단순화. 값 자체를 UI 에 노출하지 않고 이름으로 고른다.
//   sharp:    최고 화질, 압축 없음 — 빠른 망/로컬에서 화면이 또렷함. 페이로드 큼.
//   balanced: 기본값 — 적당한 화질과 가벼운 압축. 대부분의 환경에서 무난.
//   light:    강한 압축 + 저화질 — 느린 망에서 끊김 최소화. CPU 도 더 씀.
// noVNC qualityLevel(0-9, 높을수록 선명) + compressionLevel(0-9, 높을수록 압축 강함).
const VNC_QUALITY_PRESETS = {
  sharp: { qualityLevel: 9, compressionLevel: 0 },
  balanced: { qualityLevel: 6, compressionLevel: 3 },
  light: { qualityLevel: 3, compressionLevel: 7 },
};

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
  credentials: color.warning,
  disconnected: color.muted,
  error: color.danger,
};

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Connected',
  credentials: 'Password required',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

const VncPane = ({
  hostId, display, isActive, isFocused, settings, t, onReadyChange, updateSettings,
}) => {
  const containerRef = useRef(null);
  const clientRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  // 연결 진행 단계 — 'ticket'(티켓 발급 중) → 'negotiating'(WS+RFB 협상 중).
  // 첫 연결 시 로딩 오버레이에서 어디서 오래 걸리는지 단서를 준다.
  const [connectPhase, setConnectPhase] = useState('ticket');
  // 첫 프레임 페이드인 — connected 전환 시 CSS opacity transition 으로 화면이 갑자기 튀어나오지 않게.
  const [frameVisible, setFrameVisible] = useState(false);
  // Task 3 — VNC 비밀번호 입력. credentialsrequired 이벤트 시 입력 폼을 띄운다.
  // 비밀번호는 React state(메모리) 에만 존재 — localStorage / 탭 상태 / 서버 에 영속화하지 않는다.
  // pane 이 언마운트되면 state 도 사라진다.
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordError, setPasswordError] = useState('');
  // credentials 프롬프트를 이미 보였는지 추적 — securityfailure 시 재시도 폼으로 돌아갈지 판단.
  const credentialsShownRef = useRef(false);

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

    // 새 연결 시도 — credentials 추적 초기화.
    credentialsShownRef.current = false;
    // 진행 상태를 매번 'connecting' 으로 리셋 — 재부착 시에도 로딩 표현이 보이려면 필수.
    setStatus('connecting');
    setErrorMsg('');
    // 진행 단계 초기화 — 티켓 발급부터 시작.
    setConnectPhase('ticket');

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
        // 화질 프리셋 — settings.vncQuality → qualityLevel/compressionLevel.
        const qPreset = VNC_QUALITY_PRESETS[settings?.vncQuality] || VNC_QUALITY_PRESETS.balanced;
        // 티켓 발급 완료 → RFB 인스턴스 생성(WS 오픈 + RFB 협상) 단계로 전환.
        setConnectPhase('negotiating');
        const client = await createVncClient({
          container: containerRef.current,
          url,
          qualityLevel: qPreset.qualityLevel,
          compressionLevel: qPreset.compressionLevel,
          onConnected: () => {
            if (!cancelled) {
              setStatus('connected');
              // 첫 프레임 페이드인 — 다음 틱에서 opacity 0→1 전환 (RFB 가 이미 canvas 를 그렸음).
              requestAnimationFrame(() => { if (!cancelled) setFrameVisible(true); });
              // 연결 성공 — 비밀번호를 메모리에서 즉시 제거.
              setPasswordValue('');
              setPasswordError('');
            }
          },
          onDisconnected: () => { if (!cancelled) setStatus('disconnected'); },
          onCredentialsRequired: () => {
            // 서버가 비밀번호를 요구 — 입력 폼을 띄운다.
            if (!cancelled) {
              credentialsShownRef.current = true;
              setStatus('credentials');
              setPasswordError('');
            }
          },
          onSecurityFailure: (detail) => {
            if (!cancelled) {
              const reason = detail?.reason
                || tRef.current?.('vncSecurityFailure')
                || 'Authentication failed';
              if (credentialsShownRef.current) {
                // 비밀번호 틀림 — 재시도 폼으로 돌아간다.
                setStatus('credentials');
                setPasswordError(reason);
                setPasswordValue('');
              } else {
                // credentials 프롬프트 없이 보안 협상 자체가 실패 — 에러 표시.
                setStatus('error');
                setErrorMsg(reason);
              }
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
      // 다음 연결 시도를 위해 프레임 페이드인 상태 리셋.
      setFrameVisible(false);
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

  // Task 3 — 비밀번호 제출. rfb.sendCredentials({password}) 로 noVNC 에 전달.
  // 비밀번호는 이 함수 호출 후 즉시 state 에서 비운다 — 메모리 잔류 시간 최소화.
  const submitPassword = useCallback(() => {
    const c = clientRef.current;
    if (!c?.rfb) return;
    try {
      c.rfb.sendCredentials({ password: passwordValue });
      setStatus('connecting'); // 보안 협상 대기
      setPasswordValue('');     // 전송 후 즉시 제거
    } catch {
      setStatus('error');
      setErrorMsg('sendCredentials failed');
    }
  }, [passwordValue]);

  // Task 4 — 화질 프리셋 변경 시 즉시 반영 (재연결 없음).
  // noVNC 는 qualityLevel/compressionLevel 속성 대입으로 인코딩 파라미터를 즉시 바꾼다.
  // 화질 컨트롤 접기/펼치기 — 기본은 접힘. 화면을 가리지 않는 것이 기본값이어야 한다.
  const [controlsOpen, setControlsOpen] = useState(false);
  const vncQuality = settings?.vncQuality || 'balanced';
  useEffect(() => {
    const c = clientRef.current;
    if (!c?.rfb) return;
    const preset = VNC_QUALITY_PRESETS[vncQuality] || VNC_QUALITY_PRESETS.balanced;
    c.rfb.qualityLevel = preset.qualityLevel;
    c.rfb.compressionLevel = preset.compressionLevel;
  }, [vncQuality]);

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
      {/* RFB 캔버스가 붙는 컨테이너 — scaleViewport=true 가 이 영역에 맞춰 스케일.
          첫 프레임 도착 시 opacity transition 으로 부드럽게 나타난다 (갑작스런 팝 방지). */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: frameVisible ? 1 : 0,
          transition: 'opacity 250ms ease-out',
        }}
      />

      {/* 연결 진행 오버레이 — 매 연결(첫 연결·재부착 포함) 마다 표시.
          회색 빈 화면 대신 단계 표시 + 펄스 바 로 "무슨 일이 일어나는지" 보여준다.
          매번 보이므로 과하지 않게 — 아이콘 + 한 줄 텍스트 + 얇은 바. */}
      {status === 'connecting' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
          background: color.base,
          pointerEvents: 'none',
        }}>
          <Monitor size={32} strokeWidth={1.5} style={{ color: color.subtext }} />
          <div style={{
            fontFamily: font.sans,
            fontSize: fontSize['13'],
            color: color.subtext,
            fontWeight: fontWeight.medium,
          }}>
            {connectPhase === 'negotiating'
              ? (t?.('vncPhaseNegotiating') || 'Negotiating display…')
              : (t?.('vncPhaseConnecting') || 'Connecting to host…')}
          </div>
          {/* 펄스 바 — 기존 skeleton 패턴(term-skeleton-pulse)과 같은 CSS 애니메이션. */}
          <div style={{
            width: '120px',
            height: '3px',
            borderRadius: '2px',
            background: color.surface1,
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              background: color.accent,
              animation: 'iterm-vnc-progress 1.4s ease-in-out infinite',
            }} />
          </div>
        </div>
      )}

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
            ...(status === 'connecting' || status === 'credentials' ? {
              animation: 'iterm-vnc-pulse 1.2s ease-in-out infinite',
            } : null),
          }} />
          {t?.(`vncStatus_${status}`) || STATUS_LABEL[status]}
        </div>
      )}

      {/* 화질 프리셋 — 접이식. 원격 데스크톱은 화면 자체가 콘텐츠라 컨트롤을 상시 띄우면
          데스크탑을 가린다. 평소엔 우측 가장자리에 얇은 손잡이만 두고, 눌러야 펼친다.
          (pane … 메뉴에 넣을 수 없다 — VNC pane 은 TerminalHeader 를 렌더하지 않는다.
          Pane.jsx 의 `!isVnc` 참고.) */}
      {!controlsOpen && (
        <button
          type="button"
          onClick={() => setControlsOpen(true)}
          title={t?.('vncQuality') || 'Quality'}
          style={{
            position: 'absolute',
            top: '50%',
            right: 0,
            transform: 'translateY(-50%)',
            zIndex: 10,
            width: '14px',
            height: '44px',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `color-mix(in srgb, ${color.surface1} 60%, ${color.base})`,
            border: `1px solid ${color.border}`,
            borderRight: 'none',
            borderRadius: `${radius.md} 0 0 ${radius.md}`,
            color: color.subtext,
            opacity: 0.55,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <ChevronLeft size={11} strokeWidth={2} />
        </button>
      )}

      {controlsOpen && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: 0,
            transform: 'translateY(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'stretch',
            background: color.surface1,
            border: `1px solid ${color.border}`,
            borderRight: 'none',
            borderRadius: `${radius.md} 0 0 ${radius.md}`,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              ['sharp', t?.('vncQualitySharp') || 'Sharp'],
              ['balanced', t?.('vncQualityBalanced') || 'Balanced'],
              ['light', t?.('vncQualityLight') || 'Light'],
            ].map(([value, label]) => {
              const isOn = vncQuality === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => { updateSettings?.({ vncQuality: value }); setControlsOpen(false); }}
                  style={{
                    padding: '5px 12px',
                    background: isOn ? color.accentSubtle : 'transparent',
                    border: 'none',
                    fontFamily: font.sans,
                    fontSize: fontSize['11'],
                    fontWeight: isOn ? fontWeight.semibold : fontWeight.medium,
                    color: isOn ? color.accent : color.subtext,
                    textAlign: 'left',
                    cursor: 'pointer',
                    outline: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setControlsOpen(false)}
            title={t?.('close') || 'Close'}
            style={{
              width: '14px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderLeft: `1px solid ${color.border}`,
              color: color.subtext,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <ChevronRight size={11} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Task 3 — 비밀번호 입력 폼. credentialsrequired 이벤트 시 표시.
          비밀번호는 컴포넌트 state(메모리) 에만 존재 — 영속화하지 않는다. */}
      {status === 'credentials' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `color-mix(in srgb, ${color.base} 90%, transparent)`,
          zIndex: 20,
        }}>
          <form
            onSubmit={(e) => { e.preventDefault(); submitPassword(); }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '20px',
              background: color.surface0,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
              minWidth: '240px',
              maxWidth: '320px',
            }}
          >
            <label style={{
              fontSize: fontSize['12'],
              color: color.text,
              fontFamily: font.sans,
              fontWeight: fontWeight.semibold,
            }}>
              {t?.('vncPassword') || 'VNC Password'}
            </label>
            {passwordError && (
              <div style={{
                fontSize: fontSize['11'],
                color: color.danger,
                fontFamily: font.sans,
              }}>
                {passwordError}
              </div>
            )}
            <input
              type="password"
              autoComplete="off"
              autoFocus
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              style={{
                padding: '6px 10px',
                background: color.surface1,
                border: `1px solid ${color.border}`,
                borderRadius: radius.md,
                color: color.text,
                fontFamily: font.sans,
                fontSize: fontSize['13'],
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '6px 16px',
                background: color.accent,
                color: '#fff',
                border: 'none',
                borderRadius: radius.md,
                cursor: 'pointer',
                fontFamily: font.sans,
                fontSize: fontSize['12'],
                fontWeight: fontWeight.semibold,
              }}
            >
              {t?.('vncConnect') || 'Connect'}
            </button>
          </form>
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
        @keyframes iterm-vnc-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default VncPane;
