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
 *    (탭 생성 등 최신 뷰포트 판정이 필요한 콜백에서 사용)
 */
/** 이보다 작은 가시 영역은 실제 화면이 아니라 전환 중의 찌꺼기다(숨김·복원 순간). */
const MIN_SANE_VIEWPORT_PX = 120;

/* 키보드냐 브라우저 크롬이냐 — **픽셀이 아니라 비율로 잰다.**
   ⚠️ 한때 "150px 이상 벌어지면 키보드" 였고, 그게 틀렸다. iOS 는 주소창이 펼쳐진 첫
   화면에서 크롬만으로도 그만큼 벌어진다 → 첫 진입에 키보드로 오판 → `--vvh` 가 걸려
   하단에 띠가 남고, 스크롤해서 크롬이 접히면 저절로 사라진다("처음엔 보이는데 나중엔
   괜찮아진다" 가 정확히 이 모양이었다).

   비율은 기기 크기와 무관하다. 실측 기준으로 가운데를 잡는다:
     - 상하 크롬이 다 펼쳐져도 가시 영역은 **80% 이상** 남는다(작은 폰이 가장 불리하다).
     - 키보드가 올라오면 가시 영역은 **60% 아래**로 떨어진다(키보드가 화면의 ~40%).
   0.7 은 그 사이다. 0.8 로 잡았다가 첫 진입의 펼쳐진 주소창(79.6%)이 걸려 되돌렸다. */
const KEYBOARD_MAX_VISIBLE_RATIO = 0.7;

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

    // visualViewport — 가시 영역 높이 + offsetTop 트래킹.
    // iOS Safari 는 viewport meta 의 interactive-widget=resizes-content 를 무시한다.
    // 키보드가 올라오면 visualViewport.height 만 줄어들고 layout viewport 는 그대로라서
    // position:fixed; inset:0 가 키보드 영역까지 덮음 → CommandInput 모달이 키보드에 가림.
    // 여기서 visualViewport 값을 state/CSS 변수로 노출해 외곽 컨테이너와 모달이 가시 영역에
    // 맞춰 줄어들도록 한다.
    /* 지금의 가시 영역을 CSS 변수와 state 에 반영한다.
       ⚠️ **읽는 자리가 하나여야 한다** — 이벤트 때만 읽고 settle 에서 안 읽으면, iOS 가
       주소창 접힘 **애니메이션 중간값**으로 마지막 resize 를 쏘고 끝냈을 때 그 중간값이
       그대로 굳는다. 화면에서는 하단에 검은 띠로 남는다(컨테이너가 실제 가시 영역보다
       짧다). 그래서 settle 타이머도 이 함수를 다시 부른다. */
    const applyViewport = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      /* ⚠️ **말이 안 되는 높이는 쓰지 않는다.** 이 함수는 탭이 숨겨질 때나 복원 직후에도
         불리는데, 그 순간의 visualViewport 는 0 이나 직전 프레임의 찌꺼기를 줄 수 있다.
         그 값을 `--vvh` 에 쓰면 앱 컨테이너가 접혀 **하단 툴바가 통째로 사라진다.** */
      if (!(vv.height > MIN_SANE_VIEWPORT_PX)) return;
      setViewportHeight(vv.height);
      document.documentElement.style.setProperty('--vvt', `${vv.offsetTop}px`);

      /* ⚠️ **평소에는 `--vvh` 를 아예 걸지 않는다.** 이게 하단 빈틈의 뿌리였다.
         JS 로 잰 높이는 반드시 언젠가 낡는다 — iOS 는 주소창 접힘 애니메이션 중간값으로
         마지막 이벤트를 쏘고 끝내기도 하고, 앱 전환 복원처럼 이벤트 없이 바뀌기도 한다.
         낡은 값이 실제보다 작으면 그 차이가 그대로 검은 띠다.

         CSS `100dvh` 는 **브라우저가 매 프레임 직접 계산**하는 값이라 낡을 수가 없다.
         그래서 키보드가 없을 때는 변수를 지워 CSS 가 재게 두고, 변수는 dvh 가 모르는
         **키보드가 올라온 상태**에만 건다(dvh 는 키보드를 반영하지 않는다).

         판정은 넉넉하게: 브라우저 크롬은 120px 을 넘지 않고 키보드는 250px 을 넘는다. */
      const layout = window.innerHeight || vv.height;
      if (vv.height < layout * KEYBOARD_MAX_VISIBLE_RATIO) {
        document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      } else {
        document.documentElement.style.removeProperty('--vvh');
      }
    };

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
          applyViewport();

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
            // ⚠️ **그리고 높이를 다시 읽는다.** 위 주석 참고 — 마지막 resize 가
            // 애니메이션 중간값이면 여기서 고치지 않으면 그 값이 굳는다.
            applyViewport();
            if (grew) {
              try { window.dispatchEvent(new Event('iterm:fit-terminals')); } catch { /* noop */ }
            }
          }, 250);
        }
        check();
      });
    };
    /* ⚠️ `check` 만 달면 **isMobile 만 갱신되고 높이는 그대로다.** iOS 는 주소창이
       접히고 펴질 때 window resize 를 쏘는데 visualViewport resize 가 항상 짝을 이루지는
       않는다 — 그 어긋남이 하단 검은 띠로 남는다. 두 이벤트 다 같은 자리로 보낸다.
       ⚠️ 등록은 **`handleVV` 선언 뒤**여야 한다(const 는 TDZ 라 위에서 부르면 던진다). */
    window.addEventListener('resize', handleVV);
    window.addEventListener('orientationchange', handleVV);
    /* 앱을 전환했다 돌아오는 길 — iOS 는 bfcache 복원이나 탭 재활성화에서 **resize 를
       안 쏘고도** 크롬 높이가 달라져 있을 수 있다. 그때 옛 `--vvh` 가 그대로 굳으면
       하단에 검은 띠가 남는다. "자꾸" 생기는 쪽은 대개 여기다 — 이벤트가 없는 변화. */
    /* ⚠️ 선언이 등록보다 **먼저**여야 한다 — const 는 TDZ 라 위에서 부르면 마운트가 죽는다. */
    const handleVisible = () => {
      if (document.visibilityState === 'visible') handleVV();
    };

    window.addEventListener('pageshow', handleVV);
    // 보이게 될 때만 읽는다. 숨겨지는 순간의 값은 쓸 데도 없고 믿을 수도 없다.
    document.addEventListener('visibilitychange', handleVisible);

    // 최초 1회 — mount 시점 visualViewport 값을 CSS 변수에 반영.
    // 최초 1회도 **같은 함수**를 지난다. 여기서만 무조건 걸면 마운트 시점 값이 그대로 굳는다.
    applyViewport();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVV);
      window.visualViewport.addEventListener('scroll', handleVV);
    }

    return () => {
      window.removeEventListener('resize', handleVV);
      window.removeEventListener('orientationchange', handleVV);
      window.removeEventListener('pageshow', handleVV);
      document.removeEventListener('visibilitychange', handleVisible);
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
