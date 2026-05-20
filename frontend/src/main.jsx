import React from 'react'
import ReactDOM from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import App from './App.jsx'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

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
