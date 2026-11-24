/**
 * xterm.js 가 만드는 DOM 에 거는 전역 CSS. 문서에 한 번만 주입한다(id 로 멱등).
 * pane 마다 Terminal 이 여러 개 떠도 style 태그는 하나.
 */

// xterm 의 숨은 입력창이 브라우저 스크롤을 유발하지 않게 터미널 상단에 못박는다.
// (모바일에서 키보드가 올라올 때 화면이 통째로 밀리던 원인)
const MOBILE_FIX_ID = 'xterm-mobile-fix';
const MOBILE_FIX_CSS = `
  .xterm .xterm-helper-textarea {
    top: 0 !important;
    left: 0 !important;
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    z-index: -1 !important;
    opacity: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
  }
`;

// 스크롤바 완전 제거 — 두 종류가 있다:
//   1) .xterm-viewport 의 네이티브 브라우저 스크롤바
//   2) .xterm-scrollable-element > .scrollbar — xterm 자체 DOM 오버레이(스크롤 시 .visible 붙음)
// 마지막 블록은 iOS 가 .xterm-viewport 를 네이티브 스크롤하게 둔다 — xterm 의 _handleScroll 이
// scrollTop 변화에 반응해 캔버스를 다시 그리므로 별도 터치 핸들러가 필요 없다.
const SCROLLBAR_FIX_ID = 'xterm-scrollbar-fix-v2';
const SCROLLBAR_FIX_CSS = `
  .xterm .xterm-viewport {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    overflow-x: hidden !important;
  }
  .xterm .xterm-viewport::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
    display: none !important;
    background: transparent !important;
  }
  .xterm-scroll-area {
    scrollbar-width: none !important;
  }
  .xterm-scroll-area::-webkit-scrollbar {
    display: none !important;
  }
  .xterm .xterm-scrollable-element > .scrollbar {
    display: none !important;
  }
  .xterm .xterm-scrollable-element > .shadow {
    display: none !important;
  }
  .xterm .xterm-viewport {
    -webkit-overflow-scrolling: touch;
  }
`;

const NAMED_LINKS_CSS = `
  .terminal-named-links {
    position: absolute;
    pointer-events: none;
    overflow: hidden;
    z-index: 5;
  }
  .terminal-named-link-mask, .terminal-named-link-label {
    position: absolute;
    box-sizing: border-box;
  }
  .terminal-named-link-mask { background: var(--terminal-link-bg); }
  .terminal-named-link-label {
    border-bottom: 1px solid var(--terminal-link-fg);
    background: var(--terminal-link-bg);
    color: var(--terminal-link-fg);
    white-space: pre;
  }
  .terminal-named-link-icon {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    background: var(--terminal-link-bg);
    color: var(--terminal-link-fg);
  }
  .terminal-named-link-icon svg { max-width: 100%; max-height: 100%; }
  .terminal-named-link-open {
    position: absolute;
    pointer-events: auto;
    min-width: 24px;
    padding: 0;
    border: 0;
    background: var(--terminal-link-bg);
    color: var(--terminal-link-fg);
    font: inherit;
    cursor: pointer;
  }
  .terminal-named-link-open:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
  .terminal-link-target {
    position: absolute;
    box-sizing: border-box;
    z-index: 6;
    overflow: auto;
    font: inherit;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .terminal-link-target[hidden] { display: none; }

`;

const injectOnce = (id, css) => {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.innerHTML = css;
  document.head.appendChild(style);
};

const ensureXtermGlobalStyles = () => {
  injectOnce(MOBILE_FIX_ID, MOBILE_FIX_CSS);
  injectOnce('terminal-named-links-style', NAMED_LINKS_CSS);
  // v2 로 올리면서 옛 id 는 걷어낸다(캐시된 옛 스타일이 남아 겹치지 않게).
  if (!document.getElementById(SCROLLBAR_FIX_ID)) {
    document.getElementById('xterm-scrollbar-fix')?.remove();
  }
  injectOnce(SCROLLBAR_FIX_ID, SCROLLBAR_FIX_CSS);
};

export default ensureXtermGlobalStyles;
