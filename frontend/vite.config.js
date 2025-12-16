import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'term.jshsakura.com',
      '.jshsakura.com', // 모든 서브도메인 허용
    ],
    proxy: {
      '/api': {
        target: 'http://iterminal-backend:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://iterminal-backend:8000',
        ws: true,
      },
    },
  },
})
