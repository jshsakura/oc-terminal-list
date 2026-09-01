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

/* ⚠️ **`--vvh` 는 언제나 건다.** 한때 "키보드일 때만 걸고 평소엔 CSS `100dvh` 가 재게
   두자" 로 바꿨다가 되돌린 자리다. 근거는 "JS 로 잰 값은 낡는다" 였고 그 자체는 맞지만,
   `dvh` 가 그 대안이 못 된다는 것이 **실측으로 드러났다**(iOS Safari):

     vv=556  inner=556  root=665  app=665

   가시 영역이 556 인데 `100dvh` 로 잡힌 앱은 665 였다 — 이 브라우저의 `dvh` 는 *지금*
   뷰포트가 아니라 큰 쪽을 준다. 109px 이 그대로 어긋나고, 그게 하단 빈틈이다.
   **낡을 수 있는 값과 항상 틀린 값 중에는 전자가 낫다** — 게다가 낡음은 아래의
   재측정(settle·visibilitychange·pageshow·resize)으로 이미 막는다.

   `visualViewport.height` 는 정의상 **사람이 보는 높이**라 어긋날 수가 없다. */

/* ── 실측 보고 ────────────────────────────────────────────────────────────────
 * 하단 검은 띠는 **폰에서만** 나고 기기 없이는 재현이 안 된다. 한 번은 코드만 읽고
 * 고쳤다가 안 먹었다 — 그래서 값을 추측하지 않고 받는다.
 *
 * 살아있는 WS 로 올라간다(`ws_observe` 의 `viewport` scope). 값이 **바뀔 때만**, 그리고
 * 최소 간격을 두고 보낸다 — 주소창이 접히는 동안 resize 가 연달아 오므로 그대로 흘리면
 * 로그가 그 애니메이션으로 덮인다.
 *
 * 이 블록은 진단이 끝나면 지운다. 남겨 두면 조용한 상시 비용이 된다. */
const REPORT_MIN_GAP_MS = 1500;
let lastReportAt = 0;
let lastReportKey = '';

const reportViewport = (vv, layout, keyboard, force = false) => {
  if (!window.matchMedia?.('(pointer: coarse)')?.matches) return;   // 폰에서만
  const el = document.documentElement;
  const root = document.getElementById('root');
  const app = root?.firstElementChild;
  const detail = [
    `vv=${Math.round(vv.height)}`,
    `inner=${Math.round(layout)}`,
    `ratio=${(vv.height / (layout || 1)).toFixed(3)}`,
    `kbd=${keyboard ? 1 : 0}`,
    `vvh=${el.style.getPropertyValue('--vvh') || '-'}`,
    `off=${Math.round(vv.offsetTop)}`,
    `root=${root ? Math.round(root.getBoundingClientRect().height) : '-'}`,
    `app=${app ? Math.round(app.getBoundingClientRect().height) : '-'}`,
    `vvb=${el.style.getPropertyValue('--vvb') || '-'}`,
  ].join(' ');
  /* ⚠️ **첫 측정은 반드시 흘려보낸다.** 마운트 시점에는 터미널 소켓이 아직 없어서
     이벤트가 허공에 떨어진다 — 그 뒤 뷰포트가 안 바뀌면 영영 아무것도 안 올라온다.
     실제로 그렇게 배선했다가 attach 12번에 보고 0건이었다. `force` 가 그 구멍을 막는다. */
  const now = Date.now();
  if (!force) {
    if (detail === lastReportKey) return;
    if (now - lastReportAt < REPORT_MIN_GAP_MS) return;
  }
  lastReportAt = now;
  lastReportKey = detail;
  try {
    window.dispatchEvent(new CustomEvent('iterm:client-report', {
      detail: { scope: 'viewport', kind: 'measure', detail },
    }));
  } catch { /* 관측이 기능을 망가뜨리면 안 된다 */ }
};

export default function useViewport() {
  const [isMobile, setIsMobile] = useState(() => isPhoneViewport());
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const isMobileRef = useRef(false);

  /* 소켓이 붙기 전의 측정은 허공에 떨어진다 — 초반 몇 번은 dedup 을 건너뛰고 흘린다. */
  const forceReportRef = useRef(true);

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

      /* 가시 영역을 그대로 건다 — 키보드든 주소창이든 구별할 필요가 없다.
         `visualViewport.height` 는 **둘 다 이미 반영된** 값이다. 구별하려 들었던 판이
         하단 빈틈을 만들었다(위 주석). */
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);

      /* ── 하단 빈틈의 진짜 뿌리 ──────────────────────────────────────────────
         `#root` 와 로그인 오버레이는 `position: fixed; inset: 0` 이라 **레이아웃 뷰포트**
         를 채운다. 그 안에서 자식 높이를 `visualViewport.height` 로 잡으면, 둘의 차이만큼
         **아무도 안 칠한 띠**가 남고 거기서 body 의 `#0f0f17` 이 드러난다. 그게 검은 띠다.
         (⚠️ `inset:0` + `height` 를 함께 주면 `bottom` 이 무시되고 height 가 이긴다.)

         그래서 **칠하는 면은 상자를 꽉 채우고**(height:100%), 내용만 이 값만큼 아래에서
         띄운다. 어느 브라우저가 위/아래 중 어디를 크롬으로 먹든 빈틈이 생길 수가 없다. */
      const box = document.getElementById('root');
      const boxH = box ? box.getBoundingClientRect().height : document.documentElement.clientHeight;
      const bottomGap = Math.max(0, Math.round(boxH - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--vvb', `${bottomGap}px`);

      const layout = window.innerHeight || vv.height;
      reportViewport(vv, layout, vv.height < layout * 0.7, forceReportRef.current);
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
    forceReportRef.current = false;   // 여기서부터는 평소 규칙(변할 때만·간격 두고)

    /* 소켓이 붙은 뒤에 다시 한 번씩 — 첫 화면의 값이야말로 가장 보고 싶은 것인데
       (하단 띠는 "처음 들어오면 보인다"), 그때는 아직 보낼 통로가 없다. */
    const flushTimers = [1500, 4000, 10000].map((ms) => setTimeout(() => {
      forceReportRef.current = true;
      applyViewport();
      forceReportRef.current = false;
    }, ms));

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
      flushTimers.forEach(clearTimeout);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVV);
        window.visualViewport.removeEventListener('scroll', handleVV);
      }
    };
  }, []);

  return { isMobile, viewportHeight, isMobileRef };
}
