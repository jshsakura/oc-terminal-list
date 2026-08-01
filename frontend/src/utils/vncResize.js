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
