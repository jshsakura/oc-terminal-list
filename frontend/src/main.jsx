import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { isPhoneViewport } from './utils/tabModel'
import { EINK_CSS } from './styles/einkCss'
import { applyEinkAttribute, readStoredEinkMode } from './utils/einkMode'
import { SETTINGS_STORAGE_KEY } from './hooks/useSettings'

// 백스페이스로 브라우저 뒤로가기가 발생하지 않게 앱 코드에서 처리한다.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Backspace' && event.keyCode !== 8) return
  const target = event.target
  const isEditable = target?.tagName === 'INPUT'
    || target?.tagName === 'TEXTAREA'
    || target?.isContentEditable
  if (!isEditable) event.preventDefault()
})

// 브라우저 기본 우클릭 메뉴 전역 차단. 커스텀 메뉴는 컴포넌트별로 처리한다.
document.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

// 모바일에서 backdrop-filter blur 는 GPU 가 매우 비싸다 (특히 메뉴/모달이 큰 영역 위에 뜰 때).
// glass.js 의 모든 blur 호출은 var(--glass-blur, NN px) 로 통일했고, 여기서 모바일 폭에서
// 값을 작은 수치로 덮어써 jank 를 줄인다. 데스크탑은 그대로 풀 블러.
const glassBlurStyle = document.createElement('style');
glassBlurStyle.textContent = `
  :root { --glass-blur-menu: 20px; --glass-blur-panel: 18px; --glass-blur-overlay: 5px; --glass-blur-card: 12px; }
  /* How much of the surface colour a glass fill / edge keeps. Same indirection as the
     blur above, and for the same reason: the e-ink stylesheet has to turn every glass
     surface opaque at once, and it cannot reach inline styles any other way. */
  :root { --glass-fill-menu: 34%; --glass-fill-panel: 72%; --glass-fill-section: 44%; --glass-fill-card: 62%; }
  :root { --glass-line-menu: 24%; --glass-line-panel: 72%; --glass-line-section: 70%; }
  @media (max-width: 768px), (hover: none) and (pointer: coarse) {
    :root { --glass-blur-menu: 6px; --glass-blur-panel: 6px; --glass-blur-overlay: 2px; --glass-blur-card: 5px; }
  }

  /* Menu row hover - the whole app uses this one rule; a row just needs the class.
     The rule needs !important because the inline default is background: transparent.

     **One surface is enough.** A left accent bar was tried and every row grew a colour
     chip, which made menus noisy — hover only has to say "this row", and the surface
     already does. The surface must be opaque though: a translucent highlight blends
     with whatever shows through the glass menu and disappears on some themes. */
  /* Skeleton pulse and spinner — **global**. These used to be injected only while
     DashboardCards rendered, so the refresh icon silently stopped spinning the moment
     that component left the screen. */
  @keyframes iterm-skel-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.7; } }
  @keyframes dc-spin { to { transform: rotate(360deg); } }
  .dc-spin { animation: dc-spin 0.9s linear infinite; transform-origin: 50% 50%; }
  /* 숨쉬기 — "이 링크가 살아 있다" 를 말하는 아주 느린 맥동. **opacity 만** 건드려
     합성 단계에서 끝난다(레이아웃도 리페인트도 없다). 호스트 카드마다 하나씩 도는
     애니메이션이라, transform 이나 box-shadow 였다면 카드 수만큼 곱해졌을 것이다.

     느린 것이 요점이다 — 빠르면 깜빡임이 되어 눈이 그리로 끌려간다. 이건 알림이
     아니라 상태 표시다. 그리고 완전히 사라지지 않는다(하한 0.5): 0 까지 내려가면
     "꺼졌다" 로 읽히는 순간이 생긴다. */
  @keyframes iterm-breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  .iterm-breathe { animation: iterm-breathe 3.2s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .dc-spin { animation-duration: 2.4s; }
    /* 숨쉬기는 **끈다** — 장식이라 없어도 뜻이 안 변한다(색만으로 이미 켜짐을 말한다).
       느리게 만드는 것으로는 부족하다: 모션에 민감한 사람에게 3초짜리 맥동은 12초여도
       똑같이 거슬린다. 켜져 보이도록 불투명하게 고정한다. */
    .iterm-breathe { animation: none; opacity: 1; }
    [aria-busy="true"] * { animation: none !important; opacity: 0.55; }
  }

  /* Pressed feedback — **global**, because "did my tap register?" is asked of every
     control, not of a chosen few. Closing a tab has to open a confirm dialog, mount
     modal code and unmount an xterm; a tap with no acknowledgement reads as a dead app
     during that gap.

     Only transform/filter, so it stays on the compositor — no layout, no repaint, and
     nothing that could add to the very latency it is covering for. Draggable items are
     excluded: tab chips carry their own drag transform and would jump when pressed. */
  button, .iterm-pressable { transition: transform 130ms ease, filter 130ms ease; -webkit-tap-highlight-color: transparent; }
  button:not(:disabled):not([draggable="true"]):active,
  .iterm-pressable:not([aria-disabled="true"]):active {
    transform: scale(0.96);
    filter: brightness(1.18);
    transition-duration: 30ms;   /* down fast, back slow — that is what "click" feels like */
  }
  @media (prefers-reduced-motion: reduce) {
    button:not(:disabled):active, .iterm-pressable:active { transform: none; }
  }

  /* Focus rings — **global**, and only for keyboard users.

     A tap or click leaves the element focused, so a plain :focus ring stays painted on
     screen long after the press: the button looks stuck in a selected state. Every
     component was papering over this on its own (outline:none appears in dozens of style
     objects), which means the ones nobody remembered to patch still show it — that is the
     white border that keeps hanging around after a tap on mobile.

     :focus-visible is the browser's own answer to "was this focus reached by keyboard?",
     so tabbing still gets a visible ring and pointer/touch never does. The ring is drawn
     from the accent token, not white, so it belongs to the theme.

     NOTE: this block lives inside a JS template literal — no backticks in the prose. */
  :focus:not(:focus-visible) { outline: none; }
  :focus-visible {
    outline: 2px solid var(--ui-accent, #89b4fa);
    outline-offset: 2px;
    border-radius: inherit;
  }

  /* ⚠️ 지금 어디로 쳐지나 — 그 신호는 **입력칸 테두리 하나**가 진다(CommandInput).

     한때 바닥 영역의 밝기를 같이 올렸는데 요란하기만 했다. 그리고 터미널 면을 filter 로
     죽인 적도 있는데, 그건 **끊임없이 다시 그려지는 면**이라 필터가 매 프레임 다시 걸리고
     그 아래 xterm 캔버스가 합성 빠른 경로에서 떨어진다 — 폰에서 발열로 돌아왔다
     (project_webgl_context_crash · project_idle_tab_resource 근처다). 둘 다 되돌렸다.
     신호는 작을수록 좋다: 시선이 이미 가 있는 자리에 테두리 색 하나면 된다. */

  .iterm-menu-item { transition: background 120ms, color 120ms; }
  .iterm-menu-item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent, #89b4fa) 20%, var(--ui-surface2, #393949)) !important;
    color: var(--ui-text, #e4e6f1);
  }
  .iterm-menu-item-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-danger, #f38ba8) 22%, var(--ui-surface2, #393949)) !important;
    color: var(--ui-danger, #f38ba8);
  }
`;
document.head.appendChild(glassBlurStyle);

/* 이북(전자잉크) 모드 — 스타일시트는 항상 붙여 두고, `html[data-eink]` 가 켤 때만 산다.
   플래그는 **React 마운트 전에** 캐시에서 읽는다. 첫 렌더 뒤에 붙이면 전자잉크 기기는
   이 모드가 없애려던 바로 그 애니메이션 첫 페인트를 이미 한 번 다시 그린 뒤다. */
const einkStyle = document.createElement('style');
einkStyle.textContent = EINK_CSS;
document.head.appendChild(einkStyle);
applyEinkAttribute(readStoredEinkMode(SETTINGS_STORAGE_KEY));

// iOS Safari applies `:active` only on elements the page shows touch interest in.
// Without this one empty listener the pressed state above simply never appears on iPhone.
document.addEventListener('touchstart', () => {}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Monaco 에디터(~2.5MB)는 시작 경로에서 제외 — 모바일 초기 로딩바가 이걸 기다리지 않게.
// 대신 앱이 뜬 뒤 한가할 때 FileEditor 청크(=monaco-vendor)를 백그라운드로 미리 받아둔다.
// → 사용자가 에디터를 열 땐 보통 이미 캐시돼 있어 빠르게 열린다. (오프라인/실패는 무시)
// 모바일은 모바일 데이터/배터리 낭비 + 에디터를 거의 안 쓰므로 warm-up 스킵. 에디터를 열면 그때 받는다.
const warmEditor = () => { import('./components/FileEditor').catch(() => {}) }
if (!isPhoneViewport()) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(warmEditor, { timeout: 5000 })
  } else {
    setTimeout(warmEditor, 3000)
  }
}

// 확인 모달은 **모든 기기에서** 미리 받는다(1KB 도 안 된다). 탭 닫기·세션 종료 같은 흔한
// 동작이 전부 이걸 거치는데, 첫 호출 때 청크를 받느라 눌러도 한참 아무 일이 없어 보였다.
// 모바일에서 특히 티가 났다 — 에디터 warm-up 은 폰에서 건너뛰지만 이건 그러면 안 되는 이유.
const warmConfirm = () => { import('./components/ConfirmModal').catch(() => {}) }
if ('requestIdleCallback' in window) {
  requestIdleCallback(warmConfirm, { timeout: 3000 })
} else {
  setTimeout(warmConfirm, 1500)
}

// Service Worker — 정적 자원 app shell 캐싱으로 모바일 콜드 로드 최소화.
// production 빌드에서만 등록. 실패해도 앱 동작엔 영향 없게 silent.
// API/WS/auth는 SW 내부에서 캐시하지 않는다(network-only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}
