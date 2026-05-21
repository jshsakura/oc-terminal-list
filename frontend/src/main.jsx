import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

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
  :root { --glass-blur-menu: 20px; --glass-blur-panel: 18px; --glass-blur-overlay: 5px; }
  @media (max-width: 768px), (hover: none) and (pointer: coarse) {
    :root { --glass-blur-menu: 6px; --glass-blur-panel: 6px; --glass-blur-overlay: 2px; }
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
const warmEditor = () => { import('./components/FileEditor').catch(() => {}) }
if ('requestIdleCallback' in window) {
  requestIdleCallback(warmEditor, { timeout: 5000 })
} else {
  setTimeout(warmEditor, 3000)
}
