import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// GitHub Pages 는 docs/ 를 main 브랜치에서 그대로 서빙한다(legacy Pages source, 이미 설정됨 —
// docs/index.html 이 그 랜딩 페이지). 데모는 그 사이트의 /demo/ 서브패스로 함께 배포되므로
// base 도 그 경로와 일치해야 한다. `npm run build:demo:publish` 가 이 값을 넘겨준다;
// 로컬 개발/미리보기는 기본값 '/' 로 루트에서 그대로 확인.
const base = process.env.DEMO_BASE_PATH || '/'
// 기본은 frontend/dist-demo (프로덕션 빌드 backend/static 과 절대 안 섞임). 퍼블리시 시엔
// docs/demo 로 직접 뽑아 그 자리에서 커밋한다 — 별도 CI 없이 손으로 리빌드하는 이 저장소의
// docs/index.html 관례와 동일.
const outDir = process.env.DEMO_OUT_DIR
  ? path.resolve(__dirname, process.env.DEMO_OUT_DIR)
  : path.resolve(__dirname, 'dist-demo')

export default defineConfig({
  base,
  plugins: [react()],
  // 기본 publicDir(frontend/public) 을 끈다 — 그 폴더엔 실제 앱용 Nerd Font(4MB+)/Gugi/sw.js 가
  // 있는데, 데모는 시스템 모노스페이스만 쓰므로 전부 불필요하게 커밋될 정적 바이너리다.
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'demo.html'),
    },
  },
})
