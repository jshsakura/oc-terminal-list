import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'
import zlib from 'node:zlib'

const BACKEND_HOST = process.env.VITE_BACKEND_HOST || 'localhost'
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '8000'

// 빌드 산출물을 미리 brotli(.br) + gzip(.gz) 로 압축해 둔다.
// 백엔드(CachedStaticFiles)가 Accept-Encoding 에 맞춰 그대로 서빙 → 매 요청 재압축 CPU 0,
// brotli 는 gzip 대비 ~15% 더 작음. 새 npm 의존성 없이 Node 내장 zlib 만 사용.
const PRECOMPRESS_EXT = /\.(js|mjs|css|svg|json|wasm|map)$/i
const PRECOMPRESS_MIN_BYTES = 1024

function precompressAssets() {
  return {
    name: 'precompress-assets',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, '../backend/static')
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { walk(full); continue }
          if (!PRECOMPRESS_EXT.test(entry.name)) continue
          if (entry.name.endsWith('.br') || entry.name.endsWith('.gz')) continue
          const buf = fs.readFileSync(full)
          if (buf.length < PRECOMPRESS_MIN_BYTES) continue
          fs.writeFileSync(`${full}.br`, zlib.brotliCompressSync(buf, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
          }))
          fs.writeFileSync(`${full}.gz`, zlib.gzipSync(buf, { level: 9 }))
        }
      }
      if (fs.existsSync(outDir)) walk(outDir)
    },
  }
}

export default defineConfig({
  plugins: [react(), precompressAssets()],
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
            // react-markdown/unified/remark 는 유일 consumer 가 FileEditor(lazy) 뿬.
            // 별도 chunk 도, 공통 vendor chunk 도 아니게 → undefined 반환으로
            // rolldown 이 자동 분할하게 두면 FileEditor chunk 에 inline 된다.
            // entry 에 re-export 링크가 생기는 것도 막고, terminal-only 모바일
            // 경로에서 ~45KB(gz) 가 빠진다.
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('unified') || id.includes('micromark') || id.includes('mdast')) return undefined;
            // prettier 는 포맷 실행 시점에만 동적 import 된다 — eager vendor 청크에 섞이면
            // ~600KB 가 시작 로드에 얹힌다. 전용 청크로 떼어 지연 로드 유지.
            if (id.includes('/prettier/')) return 'prettier';
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
