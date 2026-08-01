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
 * @param {function=} opts.onConnected - RFB 'connect' 이벤트
 * @param {function=} opts.onDisconnected - RFB 'disconnect' 이벤트 (detail.clean)
 * @param {function=} opts.onCredentialsRequired - 인증 정보 요구
 * @param {function=} opts.onSecurityFailure - 보안 협상 실패 (detail.reason)
 * @returns {Promise<{rfb: object, destroy: () => void}>}
 */
export default async function createVncClient({
  container,
  url,
  qualityLevel = 6,
  compressionLevel = 3,
  onConnected,
  onDisconnected,
  onCredentialsRequired,
  onSecurityFailure,
}) {
  // 동적 import — noVNC 는 수백 KB. 첫 VNC 접속 시점에만 로드한다.
  // package.json exports 가 "." → "./core/rfb.js" 단일 매핑이므로 루트에서 불러온다.
  const { default: RFB } = await import('@novnc/novnc');

  // wsProtocols=['binary'] — RFB 는 바이너리 프로토콜이므로 WebSocket 서브프로토콜을
  // 'binary' 로 고정한다(noVNC 표준 설정).
  const rfb = new RFB(container, url, { wsProtocols: ['binary'] });

  // scaleViewport=true: 원격 해상도를 컨테이너 크기에 맞춰 스케일(원본 해상도 유지).
  // resizeSession=true: 원격 framebuffer 해상도를 컨테이너 크기로 맞춘다(SetDesktopSize PDU).
  //   VncPane 의 ResizeObserver 가 분할 테두리 드래그 중에는 이 값을 false 로 토글해
  //   매 프레임마다 SetDesktopSize 가 날아가 Xvnc 가 흔들리는 것을 막고, 250ms 안정화 뒤
  //   다시 true 로 돌려 noVNC 가 _requestRemoteResize() 로 1회만 전송하게 한다.
  rfb.scaleViewport = true;
  rfb.resizeSession = true;

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
    try { rfb.disconnect(); } catch { /* noop — 이미 끊겼어도 안전 */ }
  };

  return { rfb, destroy };
}
