import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

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
