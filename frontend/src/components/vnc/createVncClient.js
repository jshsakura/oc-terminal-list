import { applyVncViewMode, VNC_VIEW_FIT } from '../../utils/vncResize';
import { createBurstMeter } from '../../utils/vncAdaptiveQuality';

/**
 * noVNC RFB 인스턴스를 만들어 컨테이너에 붙인다.
 * createXtermInstance 와 같은 패턴 — 여기서는 *만들기만* 한다.
 * WS 티켓/URL 라이프사이클은 호출부(VncPane)가 관리한다.
 *
 * noVNC 는 수백 KB 라 트리 최상단에서 정적 import 하면 초기 번들이 부풀고
 * 터미널만 쓰는 사용자도 함께 다운받게 된다. 따라서 동적 import() 로 첫 VNC
 * 접속 시점에만 불러온다(vite 가 별도 청크로 분리).
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container - RFB 가 캔버스를 붙일 DOM 노드
 * @param {string} opts.url - WS 터널 URL (티켓·디스플레이 쿼리 포함)
 * @param {number=} opts.qualityLevel - noVNC 화질 (0-9, 높을수록 선명). 기본 6.
 * @param {number=} opts.compressionLevel - noVNC 압축 (0-9, 높을수록 압축 강함). 기본 3.
 * @param {boolean=} opts.resizeSession - 컨테이너 크기를 원격 해상도로 통보할지. 기본 true.
 *   폰에서는 false — 폰 크기를 데스크탑에 강요하지 않는다(vncResize.js 주석 참고).
 * @param {string=} opts.viewMode - 'fit'(맞춤) | 'pan'(원본+이동). 기본 'fit'.
 * @param {function=} opts.onConnected - RFB 'connect' 이벤트
 * @param {function=} opts.onDisconnected - RFB 'disconnect' 이벤트 (detail.clean)
 * @param {function=} opts.onCredentialsRequired - 인증 정보 요구
 * @param {function=} opts.onSecurityFailure - 보안 협상 실패 (detail.reason)
 * @param {function=} opts.onThroughput - 버스트가 끝날 때 실측 대역폭 ({mbps, at, bytes}).
 *   화질 자동 적응이 이 값으로 판단한다. 없으면 측정 자체를 하지 않는다.
 * @returns {Promise<{rfb: object, destroy: () => void}>}
 */
export default async function createVncClient({
  container,
  url,
  qualityLevel = 6,
  compressionLevel = 3,
  resizeSession = true,
  viewMode = VNC_VIEW_FIT,
  onConnected,
  onDisconnected,
  onCredentialsRequired,
  onSecurityFailure,
  onThroughput,
}) {
  // 동적 import — noVNC 는 수백 KB. 첫 VNC 접속 시점에만 로드한다.
  // package.json exports 가 "." → "./core/rfb.js" 단일 매핑이므로 루트에서 불러온다.
  const { default: RFB } = await import('@novnc/novnc');

  // wsProtocols=['binary'] — RFB 는 바이너리 프로토콜이므로 WebSocket 서브프로토콜을
  // 'binary' 로 고정한다(noVNC 표준 설정).
  /* 소켓을 **우리가 만들어** 넘긴다. RFB 는 URL 대신 WebSocket 을 받으면 그대로 붙이므로
     (websock.attach), 우리는 같은 소켓에 리스너를 하나 더 달아 도착 바이트를 셀 수 있다.
     화질을 자동으로 맞추려면 이 링크가 실제로 얼마를 나르는지 알아야 하는데, noVNC 는
     처리량을 밖으로 내보내지 않는다.

     ⚠️ 두 가지를 지켜야 한다.
     1) 만들자마자 넘긴다. attach() 는 `onopen` 을 **대입**하므로, 이미 열린 뒤에 넘기면
        그 이벤트를 영영 못 받아 noVNC 가 핸드셰이크를 시작하지 못한다.
     2) 우리 리스너는 `addEventListener` 로 단다. noVNC 는 `onmessage =` 로 대입하므로
        둘은 공존한다 — 대입으로 달면 noVNC 것을 덮어써서 화면이 통째로 멎는다. */
  let socket = null;
  let meter = null;
  let onMessage = null;
  if (typeof onThroughput === 'function') {
    socket = new WebSocket(url, ['binary']);
    meter = createBurstMeter(onThroughput);
    onMessage = (e) => {
      const size = e.data?.byteLength ?? e.data?.size ?? 0;
      if (size) meter.push(size, performance.now());
    };
    socket.addEventListener('message', onMessage);
  }
  const rfb = new RFB(container, socket || url, { wsProtocols: ['binary'] });

  // 보기 모드 — fit(scaleViewport) / pan(clipViewport+dragViewport). 순서 규칙은
  // applyVncViewMode 가 안다("Scaling trumps clipping").
  applyVncViewMode(rfb, viewMode);

  // resizeSession=true: 원격 framebuffer 해상도를 컨테이너 크기로 맞춘다(SetDesktopSize PDU).
  //   VncPane 의 ResizeObserver 가 분할 테두리 드래그 중에는 이 값을 false 로 토글해
  //   매 프레임마다 SetDesktopSize 가 날아가 Xvnc 가 흔들리는 것을 막고, 250ms 안정화 뒤
  //   다시 true 로 돌려 noVNC 가 _requestRemoteResize() 로 1회만 전송하게 한다.
  // 폰에서는 false — 데스크탑을 폰 크기로 줄이면 창이 잘리고 그 해상도가 세션에 남는다.
  rfb.resizeSession = resizeSession;

  // 화질/압축 프리셋 — VncPane 이 settings.vncQuality 에서 매핑해 넘겨준다.
  // 연결 중에 바뀌면 VncPane 의 useEffect 가 rfb.qualityLevel/compressionLevel 을
  // 직접 대입한다 (재연결 불필요 — noVNC 는 속성 대입으로 즉시 반영).
  rfb.qualityLevel = qualityLevel;
  rfb.compressionLevel = compressionLevel;

  // 로컬 커서 표시 — noVNC 1.7 은 Cursor 클래스로 자동 처리하지만, showLocalCursor
  // 메서드가 있는 버전에서는 명시적으로 켠다(없으면 무시).
  if (typeof rfb.showLocalCursor === 'function') {
    try { rfb.showLocalCursor(); } catch { /* noop — 커서 표시 실패는 치명적 아님 */ }
  }

  // RFB 이벤트 → 호출부 콜백 배선. 핸들러 참조를 보관해 destroy 시 정확히 제거.
  const handlers = {
    connect: () => { onConnected?.(); },
    disconnect: (e) => { onDisconnected?.(e?.detail); },
    credentialsrequired: (e) => { onCredentialsRequired?.(e?.detail); },
    securityfailure: (e) => { onSecurityFailure?.(e?.detail); },
  };
  for (const [name, fn] of Object.entries(handlers)) {
    rfb.addEventListener(name, fn);
  }

  let destroyed = false;
  const destroy = () => {
    // 멱등 — 두 번 호출해도 안전하다(언마운트 정리 + React StrictMode 이중 호출 대응).
    if (destroyed) return;
    destroyed = true;
    for (const [name, fn] of Object.entries(handlers)) {
      try { rfb.removeEventListener(name, fn); } catch { /* noop */ }
    }
    if (socket && onMessage) {
      try { socket.removeEventListener('message', onMessage); } catch { /* noop */ }
    }
    try { rfb.disconnect(); } catch { /* noop — 이미 끊겼어도 안전 */ }
  };

  return { rfb, destroy };
}
