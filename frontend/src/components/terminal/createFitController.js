/**
 * 터미널 fit/resize 클러스터 — Terminal.jsx 의 919줄 effect 에서 떼어낸다.
 *
 * 왜 안전하게 뗄 수 있나: 이 클러스터가 캡처하는 건 **전부 ref** 다(fitAddonRef,
 * wsRef, lastDimsRef, …). ref 는 stale 되지 않으므로 effect 지역 클로저 밖으로
 * 옮겨도 동작이 같다. 같은 effect 안의 connect()/onmessage 는 지역 변수(socket,
 * cancelled)를 캡처해 못 옮기지만, fit 은 WS 상태기계와 독립이고 순수 기하 계산이라
 * 옮길 수 있고 테스트도 붙는다.
 *
 * 책임: 컨테이너 크기 변화(ResizeObserver·window resize·visualViewport·전역 이벤트)를
 * 감지해 xterm 을 fit 하고, 치수가 바뀌면 백엔드에 resize 를 보낸다.
 */

/** 활성 pane 이 아니거나 pane 드래그 중이면 fit 을 건너뛴다. */
const shouldSkipFit = ({ isActive }) => (
  (typeof window !== 'undefined' && window.__paneResizingActive) || !isActive
);

/**
 * 순수 코어: 지금 치수를 재고, 직전과 다르면 보낼 resize 를 계산한다.
 * 반환 { fitted, resize } — resize 는 { cols, rows } 또는 null(변화 없음/미연결).
 *
 * 부수효과(실제 fit() 호출·WS send)는 호출부가 한다. 이 분리 덕에 "언제 보내고
 * 언제 안 보내는가" 를 DOM 없이 테스트할 수 있다.
 */
export const computeFitResize = ({ proposed, wsOpen, lastDims }) => {
  if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) {
    return { fitted: false, resize: null };
  }
  if (!wsOpen) return { fitted: true, resize: null };
  const changed = proposed.cols !== lastDims.cols || proposed.rows !== lastDims.rows;
  return { fitted: true, resize: changed ? { cols: proposed.cols, rows: proposed.rows } : null };
};

/**
 * fit 컨트롤러를 만들어 리스너를 붙인다. cleanup 함수를 반환한다.
 *
 * refs: Terminal 이 들고 있는 ref 묶음. 값이 아니라 ref 를 통째로 받아 항상 최신을 읽는다.
 *   { fitAddonRef, wsRef, lastDimsRef, predictiveEchoRef, resizeTimeoutRef,
 *     resizeTrailingTimeoutRef, isActiveRef, isMobileRef, fitNowRef, containerRef }
 */
export const attachFitController = (refs) => {
  const {
    fitAddonRef, wsRef, lastDimsRef, predictiveEchoRef,
    resizeTimeoutRef, resizeTrailingTimeoutRef, isActiveRef, isMobileRef,
    fitNowRef, containerRef,
  } = refs;

  const doFit = () => {
    const addon = fitAddonRef.current;
    if (!addon) return;
    const { fitted, resize } = computeFitResize({
      proposed: addon.proposeDimensions(),
      wsOpen: wsRef.current?.readyState === WebSocket.OPEN,
      lastDims: lastDimsRef.current,
    });
    if (!fitted) return;
    addon.fit();
    if (resize) {
      // fit() 후 실제 치수를 한 번 더 읽는다 — fit 이 셀 반올림으로 값을 바꿀 수 있다.
      const dims = addon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0
          && (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows)) {
        lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    }
  };
  // 외부(layoutSignal 등)가 즉시 fit 을 부를 수 있게 노출.
  fitNowRef.current = doFit;

  const scheduleFit = (delay = 0) => {
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = setTimeout(() => {
      resizeTimeoutRef.current = null;
      requestAnimationFrame(() => doFit());
    }, delay);
  };

  // leading(빠른 1회) + trailing(안정화 후 1회). 모바일 키보드/뷰포트는 크기가 여러 번
  // 흔들리며 안정화되므로 trailing 이 없으면 중간 크기로 굳는다.
  const scheduleLeadingAndTrailing = (leadDelay, trailDelay) => {
    scheduleFit(leadDelay);
    if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
    resizeTrailingTimeoutRef.current = setTimeout(() => doFit(), trailDelay);
  };

  const handleResize = () => {
    if (shouldSkipFit({ isActive: isActiveRef.current })) return;
    predictiveEchoRef.current?.refreshMetrics(); // 셀 크기 바뀌었을 수 있으니 재측정.
    scheduleLeadingAndTrailing(
      isMobileRef.current ? 160 : 32,
      isMobileRef.current ? 360 : 140,
    );
  };

  const handleGlobalFit = () => {
    if (shouldSkipFit({ isActive: isActiveRef.current })) return;
    scheduleLeadingAndTrailing(0, 120);
  };

  const observer = new ResizeObserver(() => handleResize());
  if (containerRef.current) observer.observe(containerRef.current);
  window.addEventListener('resize', handleResize);
  window.addEventListener('iterm:fit-terminals', handleGlobalFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
  }

  return function disposeFitController() {
    observer.disconnect();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('iterm:fit-terminals', handleGlobalFit);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', handleResize);
    }
    if (resizeTimeoutRef.current) { clearTimeout(resizeTimeoutRef.current); resizeTimeoutRef.current = null; }
    if (resizeTrailingTimeoutRef.current) { clearTimeout(resizeTrailingTimeoutRef.current); resizeTrailingTimeoutRef.current = null; }
    fitNowRef.current = null;
  };
};
