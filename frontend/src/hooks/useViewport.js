import { useState, useEffect, useRef } from 'react';
import { isPhoneViewport } from '../utils/tabModel';

/**
 * 반응형 뷰포트 상태 — 모바일 여부 + 가시영역 높이(visualViewport).
 * App.jsx 에서 로직 변경 없이 추출. iOS Safari 키보드/잔상 방어 포함.
 *
 * 반환:
 *  - isMobile: 폰 뷰포트 여부(state)
 *  - viewportHeight: visualViewport.height (키보드 올라오면 줄어듦)
 *  - isMobileRef: 콜백에서 stale closure 없이 최신 모바일 여부를 읽기 위한 ref
 *    (탭 생성 시 viewMode:'tabs' 결정 등에 사용)
 */
export default function useViewport() {
  const [isMobile, setIsMobile] = useState(() => isPhoneViewport());
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const isMobileRef = useRef(false);

  useEffect(() => {
    let viewportRaf = 0;
    let settleTimer = 0;
    let lastVVHeight = window.visualViewport?.height ?? window.innerHeight;
    const check = () => {
      const m = isPhoneViewport();
      if (isMobileRef.current !== m) setIsMobile(m);
      isMobileRef.current = m;
    };

    // iOS Safari 잔상 방어 — 키보드가 페이지를 위로 밀어 올린 채 visualViewport.offsetTop > 0
    // 으로 남아있으면, "화면 절반만 살아있고 위에는 잔상" 처럼 보인다. window.scrollTo 만으로는
    // documentElement/body 의 scrollTop 이 안 풀리는 케이스가 있어 모두 0 으로 강제.
    const forceScrollToTop = () => {
      try { window.scrollTo(0, 0); } catch { /* noop */ }
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
      if (document.body && document.body.scrollTop !== 0) document.body.scrollTop = 0;
    };

    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);

    // visualViewport — 가시 영역 높이 + offsetTop 트래킹.
    // iOS Safari 는 viewport meta 의 interactive-widget=resizes-content 를 무시한다.
    // 키보드가 올라오면 visualViewport.height 만 줄어들고 layout viewport 는 그대로라서
    // position:fixed; inset:0 가 키보드 영역까지 덮음 → CommandInput 모달이 키보드에 가림.
    // 여기서 visualViewport 값을 state/CSS 변수로 노출해 외곽 컨테이너와 모달이 가시 영역에
    // 맞춰 줄어들도록 한다.
    const handleVV = () => {
      if (viewportRaf) return;
      viewportRaf = requestAnimationFrame(() => {
        viewportRaf = 0;
        const vv = window.visualViewport;
        if (vv) {
          if (vv.offsetTop > 0 || window.scrollY > 0
              || document.documentElement.scrollTop > 0
              || (document.body && document.body.scrollTop > 0)) {
            forceScrollToTop();
          }
          setViewportHeight(vv.height);
          document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
          document.documentElement.style.setProperty('--vvt', `${vv.offsetTop}px`);

          // 잔상 방어 — viewport 가 (특히 키보드 닫혀서) 다시 커진 직후, debounce 된
          // ResizeObserver fit 만으로는 xterm WebGL canvas 의 drawing buffer 가 CSS 크기와
          // 어긋난 상태로 남는 경우가 있다. settle 후 한 번 강제로 fit-terminals 발화해
          // 모든 활성 Terminal 이 fit() → canvas drawing buffer 재동기화하게 한다.
          if (settleTimer) clearTimeout(settleTimer);
          const grew = vv.height > lastVVHeight + 4;
          lastVVHeight = vv.height;
          settleTimer = setTimeout(() => {
            settleTimer = 0;
            // 한 번 더 scroll 보정 (iOS Safari 가 settle 중 다시 미는 케이스).
            forceScrollToTop();
            if (grew) {
              try { window.dispatchEvent(new Event('iterm:fit-terminals')); } catch { /* noop */ }
            }
          }, 250);
        }
        check();
      });
    };
    // 최초 1회 — mount 시점 visualViewport 값을 CSS 변수에 반영.
    if (window.visualViewport) {
      document.documentElement.style.setProperty('--vvh', `${window.visualViewport.height}px`);
      document.documentElement.style.setProperty('--vvt', `${window.visualViewport.offsetTop}px`);
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVV);
      window.visualViewport.addEventListener('scroll', handleVV);
    }

    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      if (viewportRaf) cancelAnimationFrame(viewportRaf);
      if (settleTimer) clearTimeout(settleTimer);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVV);
        window.visualViewport.removeEventListener('scroll', handleVV);
      }
    };
  }, []);

  return { isMobile, viewportHeight, isMobileRef };
}
