/**
 * VNC 원격 해상도 자동 추적 — Phase 4.
 *
 * 전략 (resizeSession 토글):
 *   분할 테두리를 드래그하는 동안엔 매 프레임마다 SetDesktopSize PDU 가 날아가면
 *   Xvnc 가 미처 리사이즈를 끝내기 전에 다음 요청이 겹쳐 화면이 흔들린다.
 *   그래서 드래그 중에는 rfb.resizeSession = false 로 두어 noVNC 가 remote resize
 *   요청을 보내지 않게 막고, 250ms 동안 추가 변화가 없으면(=사용자가 손을 뗐다고
 *   간주) resizeSession = true 로 되돌린다. noVNC 의 resizeSession 세터는 true 로
 *   설정되는 순간 _requestRemoteResize() 를 즉시 호출해 현재 컨테이너 크기를
 *   읽어 SetDesktopSize PDU 를 **1회** 전송한다.
 *
 *   시각적 스케일링(scaleViewport/_updateScale)은 _resizeSession 이 아닌
 *   _scaleViewport 를 검사하므로 resizeSession=false 인 동안에도 컨테이너에
 *   맞춰 화면이 축소/확대된다. 즉 드래그 중에도 화면은 깨끗하게 따라오고,
 *   드래그가 끝난 뒤에야 원격 framebuffer 의 "진짜" 해상도가 바뀐다.
 *
 *   이 파일은 순수 함수만 갖는다 — React/DOM 부수효과는 VncPane 이 담당한다.
 *   createFitController.computeFitResize 와 같은 분리 패턴: "지금 보낼 resize 인가"
 *   를 DOM 없이 테스트할 수 있게 한다.
 */

/**
 * 순수 코어: 제안된 치수를 측정/반올림하고, 직전에 보낸 값과 다르면 보낼 resize 를
 * 계산한다. 반환 { measured, resize } — resize 는 { width, height } 또는 null.
 *
 * @param {object} opts
 * @param {{width:number,height:number}|null|undefined} opts.proposed
 *   getBoundingClientRect 결과(소수 포함). null/undefined 면 측정 실패로 본다.
 * @param {boolean} opts.connected - RFB 연결 여부. false 면 측정은 하되 전송은 안 한다.
 * @param {{width:number,height:number}|null} opts.lastSent - 직전에 보낸 치수(반올림값).
 *   null 이면 아직 한 번도 안 보냈다 → 첫 측정값을 무조건 보낸다.
 * @returns {{ measured: boolean, resize: {width:number,height:number}|null }}
 */
export const computeVncResize = ({ proposed, connected, lastSent }) => {
  // 측정이 안 됐거나 치수가 0/음수면 측정 실패 — measured=false 로 호출부가
  // "아직 컨테이너를 읽을 수 없다" 는 것을 알게 한다(예: 아직 마운트 전).
  if (!proposed || proposed.width <= 0 || proposed.height <= 0) {
    return { measured: false, resize: null };
  }
  // 연결이 안 됐으면 측정은 했지만 보낼 곳이 없다. measured=true 로 두어
  // 호출부가 "치수는 읽었다, 다음 연결 때 쓴다" 처리하게 한다.
  if (!connected) return { measured: true, resize: null };

  // getBoundingClientRect 는 소수를 반환한다 — framebuffer 픽셀은 정수 단위라
  // Math.round 로 맞춘다. 0.5 경계에서 ±1px 차이가 SetDesktopSize 중복 전송을
  // 유발하지 않도록 반올림 후 비교한다.
  const width = Math.round(proposed.width);
  const height = Math.round(proposed.height);

  // lastSent 가 null(첫 전송) 이거나 어느 한 축이라도 달라지면 전송.
  const changed = !lastSent
    || lastSent.width !== width
    || lastSent.height !== height;
  return {
    measured: true,
    resize: changed ? { width, height } : null,
  };
};

/**
 * 디바운스 스케줄러 — 드래그 중 연속 발화를 250ms 안정화 뒤 1회로 합친다.
 *
 * schedule(): 현재 대기 타이머를 취소하고 새로 잡는다(=trailing 디바운스).
 *   빠르게 여러 번 불려도 onApply 는 마지막 호출 기준 debounceMs 후 1회만 실행.
 * flush(): 대기 중인 타이머가 있으면 즉시 실행(언마운트/가시성 전환 정리용).
 * cancel(): 타이머만 취소하고 onApply 는 부르지 않는다.
 *
 * @param {object} opts
 * @param {() => void} opts.onApply - 안정화 후 호출할 콜백.
 * @param {number} [opts.debounceMs=250] - 대기 시간.
 * @returns {{ schedule: () => void, flush: () => void, cancel: () => void }}
 */
export const createResizeScheduler = ({ onApply, debounceMs = 250 }) => {
  let timer = null;

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onApply();
    }, debounceMs);
  };

  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    onApply();
  };

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return { schedule, flush, cancel };
};

/**
 * 데스크탑 생성 시 초기 해상도 계산 — pane/뷰포트 실측 크기를 "WxH" 문자열로 변환.
 *
 * resizeSession=true 이므로 연결 직후 SetDesktopSize 로 pane 크기가 원격에 통보되어
 * 해상도가 바뀐다. 즉 생성 시의 geometry 는 사실상 "첫 1프레임 크기" 에 불과하다.
 * 그런데 처음에 엉뚱한 비율(1280x800)로 떴다가 바뀌면 시각적으로 어색하다.
 * 이 함수는 생성 시점에 pane/뷰포트 실측 크기를 그대로 써서 왕복을 없앤다.
 *
 * 가드:
 *   - 짝수 반올림 (홀수 폭을 싫어하는 인코더가 있다).
 *   - 하한 640x480 / 상한 3840x2160 클램프.
 *   - 측정 불가(무효/0/음수) → '1280x800' 폴백.
 *   - devicePixelRatio 를 곱하지 않는다 — CSS 픽셀 기준이면 충분하다.
 *
 * @param {number|null|undefined} width - CSS 픽셀 폭.
 * @param {number|null|undefined} height - CSS 픽셀 높이.
 * @returns {string} 'WxH' (예: '1920x1080'). 폴백 '1280x800'.
 */
const _GEO_MIN_W = 640;
const _GEO_MIN_H = 480;
const _GEO_MAX_W = 3840;
const _GEO_MAX_H = 2160;
const _GEO_FALLBACK = '1280x800';

/** 폰에서 데스크탑을 만들 때 쓰는 해상도 — 폰 화면 크기를 데스크탑에 강요하지 않는다. */
export const DESKTOP_DEFAULT_GEOMETRY = _GEO_FALLBACK;

export const computeVncGeometry = (width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return _GEO_FALLBACK;
  }
  // 짝수 반올림: Math.round 후 홀수면 +1.
  const evenRound = (n) => {
    const r = Math.round(n);
    return r % 2 !== 0 ? r + 1 : r;
  };
  const w = Math.min(_GEO_MAX_W, Math.max(_GEO_MIN_W, evenRound(width)));
  const h = Math.min(_GEO_MAX_H, Math.max(_GEO_MIN_H, evenRound(height)));
  return `${w}x${h}`;
};

/* A viewport smaller than this is a window onto a desktop, not a desktop.
   Deliberately size-based rather than "is this a phone": a phone in landscape is
   844px wide and stops looking like a phone to a UA/width check, which is
   exactly when someone turns the device sideways to look at a desktop. */
export const MIN_DESKTOP_WIDTH = 1024;
export const MIN_DESKTOP_HEIGHT = 600;

/**
 * May this pane dictate the remote desktop's resolution?
 *
 * Only if it is big enough to *be* a desktop. A 400px pane pushing
 * SetDesktopSize shrinks the remote desktop until its windows and panels fall
 * off the screen — and that resolution stays in the session, so the same
 * desktop is still cropped later on a PC. Small panes look; they don't resize.
 */
export const shouldFollowPaneSize = (width, height) => (
  Number.isFinite(width) && Number.isFinite(height)
  && width >= MIN_DESKTOP_WIDTH && height >= MIN_DESKTOP_HEIGHT
);

/**
 * Resolution to create a desktop at — the measured pane, unless the pane is too
 * small to be a desktop, in which case a normal desktop size (same rule as
 * `shouldFollowPaneSize`).
 *
 * @param {object} opts
 * @param {number|null|undefined} opts.width - pane/viewport CSS pixels.
 * @param {number|null|undefined} opts.height - pane/viewport CSS pixels.
 * @returns {string} 'WxH'
 */
export const computeCreateGeometry = ({ width, height } = {}) => (
  shouldFollowPaneSize(width, height)
    ? computeVncGeometry(width, height)
    : DESKTOP_DEFAULT_GEOMETRY
);

/**
 * 모바일 보기 모드 — 'fit'(화면 맞춤) | 'pan'(원본 크기 + 끌어서 이동).
 *
 * 폰에서는 원격 해상도를 pane 에 맞추지 않으므로(위 computeCreateGeometry 참고)
 * 데스크탑이 화면보다 크다. 그 큰 화면을 어떻게 볼지가 이 모드다:
 *   fit — 통째로 축소해 다 보이게. 전체 배치를 볼 때.
 *   pan — 1:1 픽셀로 보고 손가락으로 끌어 이동. 실제로 작업할 때.
 */
export const VNC_VIEW_FIT = 'fit';
export const VNC_VIEW_PAN = 'pan';

export const normalizeVncViewMode = (mode) => (mode === VNC_VIEW_PAN ? VNC_VIEW_PAN : VNC_VIEW_FIT);

/**
 * 보기 모드 → noVNC 플래그 3종. 순수 함수 — 테스트가 DOM 없이 판정을 검증한다.
 * pan 은 clipViewport 가 켜져야 dragViewport 가 의미를 갖는다(noVNC API 규칙).
 */
export const vncViewModeFlags = (mode) => (normalizeVncViewMode(mode) === VNC_VIEW_PAN
  ? { scaleViewport: false, clipViewport: true, dragViewport: true }
  : { scaleViewport: true, clipViewport: false, dragViewport: false });

/**
 * 플래그를 rfb 에 적용한다. **순서가 중요하다** — noVNC 의 _updateClip 은
 * "Scaling trumps clipping" 이라 scaleViewport 가 켜져 있는 동안 들어온
 * clipViewport=true 를 무시한다. 그래서 항상 끄는 쪽을 먼저 대입한다.
 *
 * @returns {object|null} 적용된 플래그(테스트/디버그용). rfb 가 없으면 null.
 */
export const applyVncViewMode = (rfb, mode) => {
  if (!rfb) return null;
  const flags = vncViewModeFlags(mode);
  if (flags.scaleViewport) {
    rfb.clipViewport = flags.clipViewport;   // 먼저 끈다
    rfb.scaleViewport = true;
  } else {
    rfb.scaleViewport = false;               // 먼저 끈다
    rfb.clipViewport = flags.clipViewport;
  }
  rfb.dragViewport = flags.dragViewport;
  return flags;
};
