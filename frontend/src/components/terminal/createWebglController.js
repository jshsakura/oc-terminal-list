import { WebglAddon } from '@xterm/addon-webgl';
import { WEBGL_IDLE_RELEASE_MS } from './terminalConstants';

/**
 * WebGL 렌더러의 수명 관리.
 *
 * 왜 이렇게까지 하나: 브라우저는 WebGL 컨텍스트를 ~16개로 하드 제한한다. 탭 × 분할로
 * pane 이 10개를 넘으면 컨텍스트가 고갈되어 렌더러 OOM → **브라우저 탭이 통째로 크래시**한다.
 * 그래서 컨텍스트는 "지금 보고 있는 pane" 에만 둔다.
 *
 * 반납이 두 갈래인 이유:
 *  - 비활성 전환 → 호출부가 유예 후 detach() (빠른 탭 전환 churn 방지)
 *  - 활성인데 오래 조용함 → idle 타이머가 자동 detach. cursorBlink 로 계속 도는 GPU 렌더
 *    루프를 끊어 "밤새 켜두면 탭이 뻗는" idle GPU 고갈을 막는다.
 * 어느 쪽이든 반납 후에는 xterm 의 DOM 렌더러가 조용히 인계받는다.
 */
const createWebglController = ({ term, enabled, isActive, debug = false }) => {
  let addon = null;
  let gl = null;
  let idleTimer = null;
  let wanted = enabled;

  /* 막 부착된 WebGL 캔버스의 컨텍스트를 DOM 에서 되찾는다. getContext('webgl2') 는 이미
     만들어진 컨텍스트를 그대로 돌려주므로 새로 만들지 않는다(텍스트/커서 캔버스는 '2d' 라
     webgl2 요청에 null 을 주고 자연히 걸러진다). dispose() 만으로는 GPU 가 컨텍스트를 바로
     회수하지 않아서, 이걸 잡아뒀다가 명시적으로 반납해야 슬롯이 즉시 빈다. */
  const captureContext = () => {
    const el = term?.element;
    if (!el) return null;
    for (const canvas of el.querySelectorAll('canvas')) {
      try {
        const ctx = canvas.getContext('webgl2');
        if (ctx) return ctx;
      } catch { /* 이 캔버스는 webgl2 가 아니다 */ }
    }
    return null;
  };

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const detach = () => {
    clearIdleTimer();
    if (!addon) return;
    // dispose() 를 먼저 — 애드온이 자기 webglcontextlost 리스너를 떼므로, 이어지는
    // loseContext() 가 onContextLoss 를 재진입시키지 않는다.
    try { addon.dispose(); } catch { /* 이미 정리됨 */ }
    addon = null;
    // GPU 컨텍스트 명시 반납 — GC 의 지연 회수를 기다리지 않고 슬롯을 즉시 비운다.
    const lost = gl;
    gl = null;
    try { lost?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* noop */ }
  };

  const attach = () => {
    if (!wanted || addon || !term) return;
    try {
      const next = new WebglAddon();
      next.onContextLoss(() => {
        // GPU 컨텍스트가 죽으면 더는 못 그린다 → 정리하면 DOM 렌더러가 인계.
        try { addon?.dispose(); } catch { /* 이미 정리됨 */ }
        addon = null;
        gl = null;
      });
      term.loadAddon(next);
      addon = next;
      gl = captureContext();
    } catch (err) {
      // WebGL 이 꺼진 환경, iframe 정책 등 — 조용히 DOM 렌더러로 폴백.
      try { addon?.dispose(); } catch { /* noop */ }
      addon = null;
      gl = null;
      if (debug) console.warn('[xterm] WebGL init failed, using DOM renderer:', err);
    }
  };

  const armIdle = () => {
    if (!wanted) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      detach();
    }, WEBGL_IDLE_RELEASE_MS);
  };

  /* 활동 신호(출력·입력·포커스) — idle 로 반납돼 있었으면 즉시 재부착하고 카운트다운을 다시 건다.
     비활성/숨김 pane 은 호출부의 유예 detach 가 따로 책임지므로 여기선 아무것도 하지 않는다. */
  const noteActivity = () => {
    if (!wanted || !isActive() || document.hidden) return;
    if (!addon) attach();
    armIdle();
  };

  // 초기 부착은 활성일 때만. 비활성으로 마운트되면 활성 전환 시 호출부가 붙인다.
  if (isActive()) {
    attach();
    armIdle();
  }

  return {
    attach,
    detach,
    noteActivity,
    cancelIdle: clearIdleTimer,
    dispose: () => { wanted = false; detach(); },
  };
};

export default createWebglController;
