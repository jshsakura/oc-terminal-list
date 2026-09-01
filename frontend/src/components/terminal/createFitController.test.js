import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeFitResize, attachFitController } from './createFitController';

// fit 컨트롤러: "언제 fit 하고 언제 resize 를 보내는가". 이게 틀리면 화면 크기가
// 백엔드와 어긋나 글자가 잘리거나 넘친다. Terminal.jsx 안에 있는 동안은 919줄
// effect 에 묻혀 직접 검증 불가였다.

describe('computeFitResize — 전송 판정', () => {
  const lastDims = { cols: 80, rows: 24 };

  it('치수가 0/음수면 fit 도 안 한다', () => {
    expect(computeFitResize({ proposed: { cols: 0, rows: 24 }, wsOpen: true, lastDims }))
      .toEqual({ fitted: false, resize: null });
    expect(computeFitResize({ proposed: null, wsOpen: true, lastDims }))
      .toEqual({ fitted: false, resize: null });
  });

  it('WS 가 안 열렸으면 fit 만 하고 전송은 안 한다', () => {
    const r = computeFitResize({ proposed: { cols: 100, rows: 30 }, wsOpen: false, lastDims });
    expect(r).toEqual({ fitted: true, resize: null });
  });

  it('치수가 직전과 같으면 전송하지 않는다 — 불필요한 resize 폭주 방지', () => {
    const r = computeFitResize({ proposed: { cols: 80, rows: 24 }, wsOpen: true, lastDims });
    expect(r).toEqual({ fitted: true, resize: null });
  });

  it('치수가 바뀌었으면 새 치수를 전송한다', () => {
    const r = computeFitResize({ proposed: { cols: 120, rows: 40 }, wsOpen: true, lastDims });
    expect(r).toEqual({ fitted: true, resize: { cols: 120, rows: 40 } });
  });
});

describe('attachFitController — 리스너 라이프사이클', () => {
  let refs, listeners, observers;

  beforeEach(() => {
    listeners = {};
    observers = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    });
    // 리스너를 우리 맵에만 기록한다(실제 window 에는 붙이지 않음 — 테스트 격리).
    vi.spyOn(window, 'addEventListener').mockImplementation((ev, fn) => {
      (listeners[ev] = listeners[ev] || []).push(fn);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((ev, fn) => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    });
    const ref = (v) => ({ current: v });
    refs = {
      fitAddonRef: ref({ proposeDimensions: () => ({ cols: 80, rows: 24 }), fit: vi.fn() }),
      wsRef: ref({ readyState: 1, send: vi.fn() }),
      lastDimsRef: ref({ cols: 80, rows: 24 }),
      predictiveEchoRef: ref({ refreshMetrics: vi.fn() }),
      resizeTimeoutRef: ref(null),
      resizeTrailingTimeoutRef: ref(null),
      isActiveRef: ref(true),
      isMobileRef: ref(false),
      fitNowRef: ref(null),
      containerRef: ref(document.createElement('div')),
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resize/fit-terminals/visualViewport 리스너를 붙이고 dispose 에서 전부 뗀다', () => {
    const dispose = attachFitController(refs);
    expect(listeners.resize?.length).toBeGreaterThan(0);
    expect(listeners['iterm:fit-terminals']?.length).toBeGreaterThan(0);
    expect(observers[0].disconnected).toBeUndefined();

    dispose();
    expect(listeners.resize?.length || 0).toBe(0);
    expect(listeners['iterm:fit-terminals']?.length || 0).toBe(0);
    expect(observers[0].disconnected).toBe(true);
  });

  it('fitNowRef 를 채워 외부가 즉시 fit 을 부를 수 있게 하고, dispose 시 비운다', () => {
    const dispose = attachFitController(refs);
    expect(typeof refs.fitNowRef.current).toBe('function');
    dispose();
    expect(refs.fitNowRef.current).toBe(null);
  });

  it('fitNow() 는 치수 변화 시 백엔드로 resize 를 보낸다', () => {
    refs.fitAddonRef.current.proposeDimensions = () => ({ cols: 120, rows: 40 });
    attachFitController(refs);
    refs.fitNowRef.current();
    expect(refs.wsRef.current.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
    );
    expect(refs.lastDimsRef.current).toEqual({ cols: 120, rows: 40 });
  });

  /* ── 클라이언트 관측 보고 ───────────────────────────────────────────────
   * 폰에서만 나는 레이아웃 병은 기기 없이 재현이 안 돼 값을 받는 것 말고 길이 없다.
   * 그런데 그 통로가 조용히 안 도는 것이 바로 그 상황에서 가장 알아채기 어렵다 —
   * 실제로 첫 배선은 attach 12번에 보고 0건이었다. 여기서 못 박는다. */
  it('client-report 를 살아있는 소켓으로 올린다', () => {
    attachFitController(refs);
    listeners['iterm:client-report'].forEach((fn) => fn({
      detail: { scope: 'viewport', kind: 'measure', detail: 'vv=700 app=600' },
    }));
    expect(refs.wsRef.current.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'client-error', scope: 'viewport', kind: 'measure', detail: 'vv=700 app=600',
    }));
  });

  it('소켓이 안 열렸으면 보고를 버린다 — 관측이 예외를 던지면 안 된다', () => {
    refs.wsRef.current = { readyState: 0, send: vi.fn() };
    attachFitController(refs);
    listeners['iterm:client-report'].forEach((fn) => fn({ detail: { scope: 'viewport' } }));
    expect(refs.wsRef.current.send).not.toHaveBeenCalled();
  });

  /* ⚠️ 모든 팬이 보내면 팬 수만큼 같은 줄이 찍혀 로그가 그걸로 덮인다. */
  it('비활성 pane 은 보고하지 않는다', () => {
    refs.isActiveRef.current = false;
    attachFitController(refs);
    listeners['iterm:client-report'].forEach((fn) => fn({ detail: { scope: 'viewport' } }));
    expect(refs.wsRef.current.send).not.toHaveBeenCalled();
  });

  it('dispose 하면 보고 리스너도 뗀다', () => {
    const dispose = attachFitController(refs);
    expect(listeners['iterm:client-report']?.length).toBeGreaterThan(0);
    dispose();
    expect(listeners['iterm:client-report']?.length || 0).toBe(0);
  });

  it('비활성 pane 이면 resize 이벤트를 무시한다 (스케줄 안 함)', () => {
    refs.isActiveRef.current = false;
    attachFitController(refs);
    listeners.resize.forEach((fn) => fn());
    expect(refs.resizeTimeoutRef.current).toBe(null);   // 스케줄되지 않음
  });
});
