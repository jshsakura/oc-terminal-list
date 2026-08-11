import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const BACKEND_HOST = process.env.VITE_BACKEND_HOST || 'localhost'
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '8000'

// 빌드 산출물을 미리 brotli(.br) + gzip(.gz) 로 압축해 둔다.
// 백엔드(CachedStaticFiles)가 Accept-Encoding 에 맞춰 그대로 서빙 → 매 요청 재압축 CPU 0,
// brotli 는 gzip 대비 ~15% 더 작음. 새 npm 의존성 없이 Node 내장 zlib 만 사용.
const PRECOMPRESS_EXT = /\.(js|mjs|css|svg|json|wasm|map)$/i
const PRECOMPRESS_MIN_BYTES = 1024

const OUT_DIR = path.resolve(__dirname, '../backend/static')

/**
 * sw.js 의 CACHE_VERSION 을 빌드 산출물 해시로 각인한다.
 *
 * 손으로 관리하면 배포해도 sw.js 바이트가 그대로라 브라우저가 서비스워커 업데이트를
 * 감지하지 못한다 → activate 가 다시 안 돌아 옛 캐시가 영원히 남고, 지워진 해시 청크를
 * 물고 있다가 페이지가 스스로 리로드되는 사고로 이어진다.
 *
 * 해시는 assets/ 파일명 목록(내용 해시가 이미 박혀 있다)에서 뽑는다 — 코드가 안 바뀌면
 * 값도 그대로라 불필요한 서비스워커 교체가 일어나지 않는다.
 *
 * precompressAssets 보다 **먼저** 실행돼야 한다. 순서가 뒤바뀌면 .br/.gz 만 옛 내용으로 남는다.
 */
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const swPath = path.join(OUT_DIR, 'sw.js')
      const assetsDir = path.join(OUT_DIR, 'assets')
      if (!fs.existsSync(swPath) || !fs.existsSync(assetsDir)) return

      const names = fs.readdirSync(assetsDir)
        .filter((n) => !n.endsWith('.br') && !n.endsWith('.gz'))
        .sort()
      const version = crypto.createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 12)

      const src = fs.readFileSync(swPath, 'utf8')
      const next = src.replace(/const CACHE_VERSION = "[^"]*";/, `const CACHE_VERSION = "${version}";`)
      if (next === src) {
        this.warn('sw.js 의 CACHE_VERSION 자리를 못 찾았다 — 캐시 무효화가 동작하지 않는다')
        return
      }
      fs.writeFileSync(swPath, next)
    },
  }
}

function precompressAssets() {
  return {
    name: 'precompress-assets',
    apply: 'build',
    closeBundle() {
      const outDir = OUT_DIR
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
  plugins: [react(), stampServiceWorker(), precompressAssets()],
  build: {
    outDir: OUT_DIR,
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
            // noVNC(@novnc/novnc) 는 VNC pane 최초 접속 시점에만 동적 import 된다 —
            // eager vendor 청크에 섞이면 수백 KB 가 시작 로드에 얹힌다. 전용 청크로 떼어 지연 로드 유지.
            if (id.includes('@novnc/novnc')) return 'novnc';
            // 같은 이유로 xlsx 리더(+ 그 압축/XML 의존)도 전용 청크. 스프레드시트를 연
            // 사람만 받으면 되고, eager vendor 에 섞이면 전원이 시작 로드에서 받는다.
            if (id.includes('read-excel-file') || id.includes('unzipper-esm')
              || id.includes('/fflate/') || id.includes('/saxen/') || id.includes('/worker-f/')) {
              return 'xlsx-reader';
            }
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
