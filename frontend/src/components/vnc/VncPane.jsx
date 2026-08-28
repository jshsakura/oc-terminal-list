/**
 * VNC pane 컨테이너 — WS 티켓 라이프사이클 + RFB 연결을 소유한다.
 * Terminal.jsx 의 WS 재연결 패턴(티켓 발급 → URL 조립 → 연결 → 정리)을 미러한다.
 *
 * 터미널과 달리 자동 재연결 로직은 단순화했다 — VNC 세션은 상태 저장 스트림이므로
 * 재연결 시 전체 화면을 다시 그려야 하며, noVNC RFB 가 내부적으로 한 번 시도한다.
 * 사용자는 상태 배지로 연결 상태를 보고 필요시 새로고침할 수 있다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, MousePointer2 } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { issueWsTicket } from '../terminal/terminalHelpers';
import createVncClient from './createVncClient';
import VncTouchpad from './VncTouchpad';
import useVncViewerGestures from './useVncViewerGestures';
import {
  computeVncResize, createResizeScheduler, shouldFollowPaneSize,
  applyVncViewMode, normalizeVncViewMode, VNC_VIEW_FIT,
} from '../../utils/vncResize';
import { clampZoom, nextZoom } from '../../utils/vncPointer';
import {
  VNC_CONTROL_EVENT, registerVncPane, unregisterVncPane,
} from './vncControlBus';
import VncSettingsModal from './VncSettingsModal';

import {
  QUALITY_STEPS, INITIAL_STEP, initialState as adaptiveInitialState, decideStep,
} from '../../utils/vncAdaptiveQuality';

const { color, font, fontSize, fontWeight, radius } = tokens;

/* 'auto' 는 프리셋 이름이 아니라 **누가 정하느냐**다: 링크가 정한다. 사람이 프리셋을
   고르는 순간 그 선택이 이기고 적응은 멈춘다 — 자동이 사람의 결정을 되돌리면 안 된다. */
const VNC_QUALITY_AUTO = 'auto';

/* VNC 화질/압축 프리셋 — 이름으로 고르고 값은 UI 에 노출하지 않는다.
 *
 * ⚠️ `qualityLevel` 은 "선명도 0~9" 같은 선형 눈금이 **아니다.** RFB 의 QualityLevel
 * pseudo-encoding 이고, 서버가 그걸 실제 JPEG 품질로 옮긴다. TurboVNC 의 매핑은:
 *
 *   레벨   0   1   2   3   4   5   6   7   8   9
 *   JPEG  15  29  41  42  62  77  79  86  92  100
 *   서브샘플링  ← 4X →  ← 2X →   ← 1X(없음) →
 *
 * 그래서 예전 기본값(6)은 **JPEG 79** 였다. 사진에는 무난하지만 안티에일리어싱된 글자에
 * JPEG 가 걸리면 눈에 띄게 뭉갠다 — 이 pane 으로 보는 것은 대개 코드와 터미널이다.
 * 8 은 JPEG 92 로 글자가 읽히면서 압축비는 20(9 는 10)이라 대역폭이 3배로 뛰지 않는다.
 * 그 사이를 기본값으로 잡는다.
 *
 * `compressionLevel` 은 zlib 세기(0-9)라 화질과 무관하다 — 대역폭 ↔ 양쪽 CPU 다.
 */
const VNC_QUALITY_PRESETS = {
  sharp: { qualityLevel: 9, compressionLevel: 0 },      // JPEG 100 — 사실상 무손실
  balanced: { qualityLevel: 8, compressionLevel: 3 },   // JPEG 92 — 글자가 읽히는 하한
  light: { qualityLevel: 3, compressionLevel: 7 },      // JPEG 42 + 2X — 느린 망 전용
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
  hostId, display, paneId = null, isActive, isFocused, settings, t,
  onReadyChange, updateSettings,
}) => {
  const containerRef = useRef(null);
  // 스크롤을 갖는 바깥 래퍼 — 확대했을 때 화면을 미는 자리이자, **진짜 pane 크기**의 기준.
  const viewportRef = useRef(null);
  const clientRef = useRef(null);
  /* 화질 자동 적응의 상태. **ref 다** — 판정은 렌더와 무관하고, state 로 두면 측정이
     올 때마다 이 pane 이 다시 그려진다(버스트마다 리렌더는 그 자체로 비용이다). */
  const adaptiveRef = useRef(null);
  /* 자동이 지금 무엇을 골랐는지. 이건 화면에 보여줘야 하므로 state 다 —
     "자동" 이라고만 적으면 왜 흐린지 알 길이 없다. */
  const [autoStep, setAutoStep] = useState(QUALITY_STEPS[INITIAL_STEP].name);
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

  // Remote-resolution tracking. lastSentRef: last framebuffer size we sent (so we
  // don't repeat a SetDesktopSize). resizeSchedulerRef: the 250ms debounce.
  const lastSentRef = useRef(null);
  const resizeSchedulerRef = useRef(null);

  /* May this pane drive the remote resolution? Decided by *measured size*, not by
     "is this a phone": rotate a phone to landscape and it is 844px wide, which no
     longer looks like a phone — and that is exactly when someone turns the device
     to look at a desktop. A pane too small to be a desktop only ever looks. */
  const canResizeRemote = useCallback(() => {
    /* ⚠️ 컨테이너가 아니라 **래퍼**를 잰다. 확대하면 컨테이너를 배율만큼 키우는데
       (그게 noVNC 의 autoscale 을 태우는 방법이다), 그걸 pane 크기로 읽으면 손가락으로
       확대한 것이 원격 해상도 변경으로 나간다 — 남의 화면을 바꾸는 사고다. */
    const el = viewportRef.current || containerRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return shouldFollowPaneSize(rect.width, rect.height);
  }, []);

  /* View mode lives in local state so a menu tap changes the picture on the same
     frame. Settings still persist it (see applyViewMode), but the RFB must not
     wait for that round trip — waiting is what made the old control rail feel
     broken. Seeded from settings, and re-seeded when settings change elsewhere. */
  const [viewMode, setViewMode] = useState(() => normalizeVncViewMode(settings?.vncViewMode));
  const viewModeRef = useRef(viewMode);

  /* 측정 하나가 도착했다 → 사다리를 한 칸 움직일지 정한다.
     판정은 순수 함수(decideStep)가 하고 여기서는 **적용만** 한다 — 그래야 임계·쿨다운·
     히스테리시스를 컴포넌트를 띄우지 않고 테스트할 수 있다. */
  const handleThroughput = useCallback((sample) => {
    const prev = adaptiveRef.current;
    if (!prev) return;
    const { state, changed, step } = decideStep(prev, sample);
    adaptiveRef.current = state;
    if (!changed) return;
    const rfb = clientRef.current?.rfb;
    if (rfb) {
      rfb.qualityLevel = step.qualityLevel;
      rfb.compressionLevel = step.compressionLevel;
    }
    setAutoStep(step.name);
  }, []);

  viewModeRef.current = viewMode;
  useEffect(() => {
    setViewMode(normalizeVncViewMode(settings?.vncViewMode));
  }, [settings?.vncViewMode]);

  /* ── 모바일 조작(터치패드 + 확대) ─────────────────────────────────────────
     보이는 기준은 "폰인가" 가 아니라 **pane 이 데스크탑을 담을 만한가** 다 —
     canResizeRemote 와 같은 잣대(shouldFollowPaneSize)를 쓴다. 그보다 작은 pane 은
     어차피 원격 해상도를 건드리지 않는 '보기만 하는' 창이고, 손가락으로 절대 좌표를
     찍기엔 배율이 너무 작다. 폰을 가로로 돌려도(844px) 이 판정은 그대로 유효하다. */
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [padOpen, setPadOpen] = useState(true);
  const smallPane = paneSize.width > 0 && !shouldFollowPaneSize(paneSize.width, paneSize.height);
  const showTouchpad = smallPane && status === 'connected';

  // 래퍼 실측 — 확대 시 컨테이너를 배율만큼 키우려면 원래 크기를 알아야 한다.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setPaneSize((prev) => (
        Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
          ? prev                        // 소수점 흔들림으로 리렌더하지 않는다
          : { width: rect.width, height: rect.height }
      ));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        /* 화질 — 사람이 고른 프리셋이 있으면 그것, 없으면(auto) 사다리의 꼭대기에서
           낙관적으로 시작한다. 링크가 못 버티면 첫 버스트가 바로 알려준다. */
        const isAuto = !VNC_QUALITY_PRESETS[settings?.vncQuality];
        const qPreset = isAuto
          ? QUALITY_STEPS[INITIAL_STEP]
          : VNC_QUALITY_PRESETS[settings.vncQuality];
        adaptiveRef.current = adaptiveInitialState(INITIAL_STEP);
        setAutoStep(QUALITY_STEPS[INITIAL_STEP].name);
        // 티켓 발급 완료 → RFB 인스턴스 생성(WS 오픈 + RFB 협상) 단계로 전환.
        setConnectPhase('negotiating');
        const client = await createVncClient({
          container: containerRef.current,
          url,
          qualityLevel: qPreset.qualityLevel,
          compressionLevel: qPreset.compressionLevel,
          resizeSession: canResizeRemote(),
          viewMode: viewModeRef.current,
          /* 측정은 auto 일 때만 건다. 사람이 고른 화질을 재봐야 할 일이 없고,
             콜백이 없으면 createVncClient 는 소켓 계측 자체를 하지 않는다. */
          onThroughput: isAuto ? handleThroughput : undefined,
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

        // Resize scheduler — block remote resizes while dragging, send one
        // SetDesktopSize once the size has been stable for 250ms.
        scheduler = createResizeScheduler({
          onApply: () => {
            const c = clientRef.current;
            if (!c?.rfb || !containerRef.current) return;
            if (!canResizeRemote()) return;   // too small to define a desktop
            const rect = (viewportRef.current || containerRef.current).getBoundingClientRect();
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
          // Stop any remote resize immediately while the size is in motion.
          // Visual scaling keeps working: noVNC checks _scaleViewport for that,
          // not _resizeSession.
          c.rfb.resizeSession = false;
          if (!canResizeRemote()) {
            // Small pane (phone, rotation, keyboard, editor open): leave the
            // remote resolution alone and only recompute scale/clip. Assigning
            // the setters is what triggers noVNC's _updateScale/_updateClip.
            applyVncViewMode(c.rfb, viewModeRef.current);
            return;
          }
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
    // Only host/display/active/visibility force a reconnect — settings and t are
    // read through refs. View mode and the resize policy are applied live below.
  }, [hostId, display, validDisplay, isActive, docHidden, canResizeRemote]);

  /* One path for "change a control": apply to the live RFB first, persist after.
     The picture must never wait for the settings PUT. */
  const applyViewMode = useCallback((next) => {
    const mode = normalizeVncViewMode(next);
    setViewMode(mode);
    applyVncViewMode(clientRef.current?.rfb, mode);
    updateSettings?.({ vncViewMode: mode });
  }, [updateSettings]);

  /* 확대는 **컨테이너를 키워** 한다. noVNC 는 자기 화면 요소(우리가 넘긴 컨테이너)를
     ResizeObserver 로 보다가 scaleViewport 면 그 크기에 맞춰 autoscale 한다 — 즉 컨테이너를
     배율만큼 키우면 캔버스가 그만큼 커지고, **좌표계도 같이 커진다.**
     CSS transform 으로 확대하면 안 되는 이유가 이것이다: noVNC 는 getBoundingClientRect 로
     좌표를 읽고 자기 내부 배율로만 나누므로, 겉만 키우면 누르는 곳이 어긋난다.
     그리고 확대는 맞춤(fit) 보기에서만 성립한다 — pan 은 이미 1:1 이다. */
  const applyZoom = useCallback((value) => {
    const next = clampZoom(value);
    setZoom(next);
    if (next > 1 && viewModeRef.current !== VNC_VIEW_FIT) {
      applyViewMode(VNC_VIEW_FIT);
    }
  }, [applyViewMode]);

  /* 화면 위 두 손가락 = 뷰어 조작(핀치 확대 · 밀어서 이동).
     noVNC 는 핀치를 원격에 Ctrl+휠로 넘길 뿐이라 화면 자체는 안 커진다 — 그래서 캔버스에
     닿기 전에 가로챈다. 작은 pane(모바일)에서만 켠다: 마우스가 있는 화면에서 두 손가락
     터치를 가로챌 이유가 없다. */
  useVncViewerGestures({
    viewportRef,
    getCanvas: useCallback(() => containerRef.current?.querySelector('canvas') || null, []),
    getZoom: useCallback(() => zoomRef.current, []),
    onZoom: applyZoom,
    enabled: smallPane && status === 'connected',
  });

  const applyQuality = useCallback((next) => {
    if (next === VNC_QUALITY_AUTO) {
      /* 자동으로 되돌린다 — 지금 화면은 그대로 두고 사다리만 여기서부터 다시 시작한다.
         꼭대기로 되돌리면 방금 사람이 겪은 느린 링크를 한 번 더 겪게 된다. */
      const at = QUALITY_STEPS.findIndex((q) => q.name === autoStep);
      adaptiveRef.current = adaptiveInitialState(at < 0 ? INITIAL_STEP : at);
      updateSettings?.({ vncQuality: VNC_QUALITY_AUTO });
      return;
    }
    const preset = VNC_QUALITY_PRESETS[next];
    if (!preset) return;
    if (clientRef.current?.rfb) {
      clientRef.current.rfb.qualityLevel = preset.qualityLevel;
      clientRef.current.rfb.compressionLevel = preset.compressionLevel;
    }
    updateSettings?.({ vncQuality: next });
  }, [updateSettings, autoStep]);

  // View mode, applied live — no reconnect, just the noVNC flags.
  // `status` is in the deps so it also runs right after the client is created.
  useEffect(() => {
    applyVncViewMode(clientRef.current?.rfb, viewMode);
  }, [viewMode, status]);

  /* Controls live in the tab menus (see vncControlBus). Apply what they ask for
     immediately, then persist — the picture must not wait for the settings PUT. */
  const quality = settings?.vncQuality || VNC_QUALITY_AUTO;
  // Settings live in a modal opened from the tab menu — never on top of the desktop.
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Remote framebuffer size, read when the modal opens. noVNC exposes no public
     getter, so this reads the private field defensively — worst case the readout
     is absent, which is why the modal treats it as optional. It answers the
     question people actually have: "why is this desktop cut off?" */
  const remoteSize = (() => {
    if (!settingsOpen) return null;
    const rfb = clientRef.current?.rfb;
    const width = Number(rfb?._fbWidth) || 0;
    const height = Number(rfb?._fbHeight) || 0;
    return width && height ? { width, height } : null;
  })();
  useEffect(() => {
    if (!paneId) return undefined;
    registerVncPane(paneId, { viewMode, quality });
    return () => unregisterVncPane(paneId);
  }, [paneId, viewMode, quality]);

  useEffect(() => {
    if (!paneId) return undefined;
    const onControl = (e) => {
      const detail = e?.detail || {};
      if (detail.paneId !== paneId) return;
      if (detail.openSettings) setSettingsOpen(true);
      if (detail.viewMode) applyViewMode(detail.viewMode);
      if (detail.quality) applyQuality(detail.quality);
    };
    window.addEventListener(VNC_CONTROL_EVENT, onControl);
    return () => window.removeEventListener(VNC_CONTROL_EVENT, onControl);
  }, [paneId, applyViewMode, applyQuality]);

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

  /* Quality changes apply without reconnecting — noVNC re-encodes on assignment.
     (Also covers a change made from another device via settings sync.)

     ⚠️ auto 일 때는 **아무것도 하지 않는다.** 여기서 프리셋을 대입하면 적응이 방금 고른
     값을 매 렌더마다 되돌려, 자동이 켜져 있는 동안 화질이 한 칸에 묶인다. 사람이 고른
     값만 강제한다 — 그게 'auto' 와 프리셋의 차이 전부다. */
  useEffect(() => {
    const preset = VNC_QUALITY_PRESETS[quality];
    if (!preset) return;
    const c = clientRef.current;
    if (!c?.rfb) return;
    c.rfb.qualityLevel = preset.qualityLevel;
    c.rfb.compressionLevel = preset.compressionLevel;
  }, [quality, status]);

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

  const zoomed = zoom > 1 && paneSize.width > 0;

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: color.base,
      overflow: 'hidden',
      // 터치패드가 붙으면 화면과 조작을 위아래로 나눈다. 폰은 세로로 길고 데스크탑은
      // 16:9 라, 맞춤 보기에서 아래쪽은 어차피 비어 있던 자리다.
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 화면 영역 = 스크롤 래퍼. 확대했을 때 여기를 밀어서 본다(네이티브 스크롤).
          래퍼가 곧 **진짜 pane 크기**이며, 원격 해상도 판정도 이 크기로 한다. */}
      <div
        ref={viewportRef}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: zoomed ? 'auto' : 'hidden',
          WebkitOverflowScrolling: 'touch',
          // 확대 중에는 브라우저 기본 제스처를 끈다 — 이동은 두 손가락으로 우리가 민다.
          touchAction: zoomed ? 'none' : 'auto',
        }}
      >
        {/* RFB 캔버스가 붙는 컨테이너 — scaleViewport=true 가 **이 영역**에 맞춰 스케일한다.
            그래서 확대는 이 상자를 배율만큼 키우는 것으로 끝난다(CSS transform 금지 —
            겉만 키우면 noVNC 가 읽는 좌표가 어긋난다).
            첫 프레임 도착 시 opacity transition 으로 부드럽게 나타난다. */}
        <div
          ref={containerRef}
          data-testid="vnc-screen"
          style={{
            width: zoomed ? `${Math.round(paneSize.width * zoom)}px` : '100%',
            height: zoomed ? `${Math.round(paneSize.height * zoom)}px` : '100%',
            opacity: frameVisible ? 1 : 0,
            transition: 'opacity 250ms ease-out',
          }}
        />
      </div>

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
          background: `color-mix(in srgb, ${color.surface1} var(--glass-fill, 85%)%, transparent)`,
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

      {/* Nothing is drawn over the desktop. Settings open from the tab menu
          (vncControlBus) into this modal, which is the only chrome this pane has. */}
      <VncSettingsModal
        isOpen={settingsOpen}
        remoteSize={remoteSize}
        onClose={() => setSettingsOpen(false)}
        viewMode={viewMode}
        quality={quality}
        autoStep={autoStep}
        onViewMode={applyViewMode}
        onQuality={applyQuality}
        t={t}
      />


      {/* Task 3 — 비밀번호 입력 폼. credentialsrequired 이벤트 시 표시.
          비밀번호는 컴포넌트 state(메모리) 에만 존재 — 영속화하지 않는다. */}
      {status === 'credentials' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `color-mix(in srgb, ${color.base} var(--glass-fill, 90%)%, transparent)`,
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

      {/* 모바일 조작 바 — 화면 아래. 접어두면 손잡이만 남는다(원격 데스크톱은 화면 자체가
          콘텐츠라, 상시로 자리를 먹는 컨트롤을 두지 않는다는 이 pane 의 규칙 그대로). */}
      {showTouchpad && (padOpen ? (
        <VncTouchpad
          getContainer={() => containerRef.current}
          zoom={zoom}
          canZoom
          onZoomStep={(dir) => applyZoom(nextZoom(zoom, dir))}
          onZoomSet={applyZoom}
          onZoomReset={() => applyZoom(1)}
          onCollapse={() => setPadOpen(false)}
          t={t}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPadOpen(true)}
          style={{
            flexShrink: 0,
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: color.surface0,
            border: 'none',
            borderTop: `1px solid ${color.border}`,
            color: color.subtext,
            fontFamily: font.sans,
            fontSize: fontSize['10'],
            cursor: 'pointer',
          }}
        >
          <MousePointer2 size={12} strokeWidth={1.8} />
          {t?.('vncShowTouchpad') || 'Touchpad'}
        </button>
      ))}

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
