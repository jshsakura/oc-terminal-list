import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const BACKEND_HOST = process.env.VITE_BACKEND_HOST || 'localhost'
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '8000'

export default defineConfig({
  plugins: [react()],
  build: {
    // 백엔드(FastAPI)가 바로 서빙하는 폴더로 출력 → frontend/dist 와 backend/static 분리되던 sync 누락 방지
    outDir: path.resolve(__dirname, '../backend/static'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor';
          if (id.includes('/@xterm/xterm/')) return 'xterm-core';
          if (id.includes('/@xterm/addon-webgl/')) return 'xterm-webgl';
          if (id.includes('/@xterm/')) return 'xterm-addons';
          if (id.includes('/@monaco-editor/') || id.includes('/monaco-editor/')) return 'monaco-vendor';
          if (id.includes('/lucide-react/')) return 'icons-vendor';
          if (id.includes('/react-markdown/') || id.includes('/remark-gfm/')) return 'markdown-vendor';
          return 'vendor';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'term.jshsakura.com',
      '.jshsakura.com',
    ],
    proxy: {
      '/api': {
        target: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://${BACKEND_HOST}:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
})
