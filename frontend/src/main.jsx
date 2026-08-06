import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { isPhoneViewport } from './utils/tabModel'

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
  @media (max-width: 768px), (hover: none) and (pointer: coarse) {
    :root { --glass-blur-menu: 6px; --glass-blur-panel: 6px; --glass-blur-overlay: 2px; --glass-blur-card: 5px; }
  }

  /* 메뉴 행 호버 — 앱 전체가 이 규칙 하나를 쓴다(클래스만 붙이면 된다).
     인라인 background:transparent 가 기본값이라 !important 가 필요하다.

     **면 하나로 끝낸다.** 왼쪽 액센트 막대를 덧대봤지만 줄마다 색 조각이 튀어나와
     메뉴가 시끄러워졌다 — 호버는 "이 줄" 을 말하면 되고, 그건 면이 이미 한다.
     대신 면은 불투명이어야 한다: 반투명 하이라이트는 유리 메뉴 뒤에 비치는 것과 섞여
     테마에 따라 통째로 사라진다. */
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

// Service Worker — 정적 자원 app shell 캐싱으로 모바일 콜드 로드 최소화.
// production 빌드에서만 등록. 실패해도 앱 동작엔 영향 없게 silent.
// API/WS/auth는 SW 내부에서 캐시하지 않는다(network-only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}
