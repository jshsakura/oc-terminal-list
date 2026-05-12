import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const BACKEND_HOST = process.env.VITE_BACKEND_HOST || 'localhost'
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '8000'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../backend/static'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xterm/xterm')) return 'xterm-core';
            if (id.includes('@xterm/addon-webgl')) return 'xterm-webgl';
            if (id.includes('@xterm/')) return 'xterm-addons';
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'monaco-vendor';
            if (id.includes('lucide-react')) return 'icons-vendor';
            if (id.includes('react-dom') || id.includes('react/')) return 'react-vendor';
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('unified') || id.includes('micromark') || id.includes('mdast')) return 'markdown-vendor';
            return 'vendor';
          }
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
