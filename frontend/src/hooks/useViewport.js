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

/** 이 비율보다 많이 보이면 키보드가 아니라 브라우저 크롬이다. */
const KEYBOARD_MAX_VISIBLE_RATIO = 0.7;

/* ⚠️ **`--vvh` 는 키보드일 때만 건다.** 두 번 뒤집힌 자리라 이유를 남긴다.

   ① 평소에도 걸었더니(2026-09-02 오전) 값이 한 프레임 낡는 순간 그 차이가 **하단의 빈 띠**로
      남았다. iOS 는 주소창 접힘 애니메이션 중간값으로 마지막 resize 를 쏘고 끝내기도 하고,
      앱 전환·bfcache 복원은 이벤트 없이 크롬 높이를 바꿔 놓는다.
   ② `100dvh` 는 대안이 못 된다(실측: vv=556 인데 dvh 로 잡힌 앱은 665 였다).

   결론은 **아무것도 재지 않는 것**이다. `#root` 가 `position: fixed; inset: 0` 이라 iOS 에서
   보이는 영역에 붙고 크기도 그것이다 — 앱은 그 상자를 `height: 100%` 로 꽉 채우면 된다.
   낡을 값이 없으므로 띠가 생길 수가 없다.

   키보드만 예외다: 그때는 레이아웃 뷰포트가 안 줄어들어 상자가 키보드 밑까지 덮으므로
   가시 영역으로 줄여야 입력창이 안 가린다. */

export default function useViewport() {
  const [isMobile, setIsMobile] = useState(() => isPhoneViewport());
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const isMobileRef = useRef(false);

  /* 소켓이 붙기 전의 측정은 허공에 떨어진다 — 초반 몇 번은 dedup 을 건너뛰고 흘린다. */
  useEffect(() => {
    let viewportRaf = 0;
    let settleTimer = 0;
    let lastVVHeight = window.visualViewport?.height ?? window.innerHeight;
    let maxLayout = window.innerHeight || lastVVHeight;
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

      /* ⚠️ **키보드일 때만 건다.** 앱 상자(`#root`)는 fixed 라 보이는 영역에 붙어 있고
         크기도 그것이다. 평소에도 이 값으로 상자를 줄이면, 값이 한 프레임이라도 낡았을 때
         그 차이가 그대로 하단의 빈 띠가 된다 — 그게 이 병의 원래 증상이었다.
         키보드는 다르다: 그때는 레이아웃 뷰포트가 안 줄어들어 상자가 키보드 밑까지 덮으므로
         가시 영역으로 줄여야 입력창이 안 가린다.
         ⚠️ 판정은 픽셀이 아니라 **비율**이다. "150px 이상 벌어지면 키보드" 로 잡았다가
         첫 진입의 펼쳐진 주소창(79.6%)이 걸렸다. 크롬은 80% 이상 남기고 키보드는 60% 아래로
         떨어뜨린다. */
      /* ⚠️ 기준은 **지금까지 본 가장 큰 레이아웃 뷰포트**다. 전환 중에는 `innerHeight` 가
         함께 줄어 보고되는 순간이 있어(실측: vv=364 inner=507, 페이지가 158 밀린 상태)
         그 값으로 비율을 재면 0.718 이 나와 키보드를 놓친다. 레이아웃 뷰포트는 키보드로
         줄지 않으므로 최대값이 곧 참값이다. 회전하면 다시 잰다. */
      maxLayout = Math.max(maxLayout, window.innerHeight || 0, vv.height);
      if (vv.height < maxLayout * KEYBOARD_MAX_VISIBLE_RATIO) {
        document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      } else {
        document.documentElement.style.removeProperty('--vvh');
      }

      /* ⚠️ **`--vvb`(레이아웃 뷰포트와 가시 영역의 차이만큼 아래를 밀던 값)는 없앴다.**
         그 값은 `position: fixed` 상자를 전제로 한 보정인데, iOS 의 fixed 상자는 위쪽이
         화면 밖이었다 — 아래를 밀어봐야 내용은 그대로 잘린 자리에 있었다. 지금은 상자
         자체가 정적 배치(레이아웃 뷰포트)라 보정할 차이가 없다. App.jsx 의 `#root` 주석. */

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
    /* 회전하면 레이아웃 뷰포트가 통째로 달라진다 — 최대값을 들고 있으면 안 된다. */
    const handleOrientation = () => { maxLayout = 0; handleVV(); };
    window.addEventListener('orientationchange', handleOrientation);
    /* 앱을 전환했다 돌아오는 길 — iOS 는 bfcache 복원이나 탭 재활성화에서 **resize 를
       안 쏘고도** 크롬 높이가 달라져 있을 수 있다. 그때 옛 `--vvh` 가 그대로 굳으면
       하단에 검은 띠가 남는다. "자꾸" 생기는 쪽은 대개 여기다 — 이벤트가 없는 변화. */
    /* ⚠️ 선언이 등록보다 **먼저**여야 한다 — const 는 TDZ 라 위에서 부르면 마운트가 죽는다. */
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      handleVV();
    };

    const handlePageShow = () => handleVV();
    window.addEventListener('pageshow', handlePageShow);
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
      window.removeEventListener('orientationchange', handleOrientation);
      window.removeEventListener('pageshow', handlePageShow);
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
