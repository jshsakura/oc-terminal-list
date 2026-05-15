import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const HOST = '127.0.0.1';
const PORT = 4175;
const BASE_URL = `http://${HOST}:${PORT}`;
const CHROMIUM = process.env.CHROMIUM_PATH || null;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', HOST, '--port', String(PORT)], {
  stdio: 'ignore',
  detached: true,
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error(`Vite server did not start at ${BASE_URL}`);
};

const mockApi = async (page) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path === '/api/auth/status') return json({ setup_complete: true });
    if (path === '/api/auth/verify') return json({ username: 'admin' });
    if (path === '/api/user/settings') {
      if (route.request().method() === 'PUT') return json({ ok: true });
      return json({
        settings: {
          theme: 'default',
          language: 'en',
          fontSize: 12,
          fontSizeMobile: 13,
          fontFamily: 'JetBrainsMono Nerd Font Mono',
          defaultShell: 'auto',
          autoScroll: 'smart',
          smoothScroll: true,
          useWebgl: true,
        },
      });
    }
    if (path === '/api/hosts') return json([]);
    if (path === '/api/ssh-keys') return json({ items: [] });
    if (path === '/api/sessions') return json([]);
    if (path === '/api/ws-ticket') return json({ ticket: 'smoke-ticket', ttl: 20 });
    if (path === '/api/tab-state') {
      if (route.request().method() === 'PUT') return json({ updatedAt: 'smoke' });
      return json({
        updatedAt: 'smoke',
        activeTabId: 'local:smoke-session',
        tabs: [{
          id: 'local:smoke-session',
          type: 'local',
          sessionId: 'smoke-session',
          name: 'smoke',
          panes: [{ id: 'pane-smoke', mode: 'terminal', sessionId: 'smoke-session' }],
          layout: 'single',
          splitTree: { type: 'pane', paneId: 'pane-smoke' },
          activePaneId: 'pane-smoke',
        }],
      });
    }
    if (path === '/api/tab-state/version') return json({ updatedAt: 'smoke' });
    if (path.endsWith('/clients')) return json({ attached: false, exists: true, count: 0 });
    if (path.endsWith('/cwd')) return json({ cwd: '/', workspace_relative: '', in_workspace: true });
    return json({});
  });
};

const installFakeWebSocket = async (context) => {
  await context.addInitScript(() => {
    localStorage.setItem('auth_token', 'smoke-token');
    localStorage.setItem('username', 'admin');

    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        super();
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.binaryType = 'arraybuffer';
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.({ type: 'open' });
          this.dispatchEvent(new Event('open'));
          const bytes = new TextEncoder().encode('terminal smoke\n$ ');
          this.onmessage?.({ data: bytes.buffer });
        }, 40);
      }

      send() {}

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ type: 'close', code: 1000 });
        this.dispatchEvent(new Event('close'));
      }
    }

    window.WebSocket = FakeWebSocket;
  });
};

const runViewport = async (browser, name, viewport, mobile = false) => {
  console.log(`terminal smoke: ${name}`);
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  await installFakeWebSocket(context);
  const page = await context.newPage();
  await mockApi(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForFunction(() => {
    const rows = document.querySelector('.xterm-rows');
    const canvas = document.querySelector('.xterm canvas');
    return rows?.textContent?.includes('terminal smoke') || !!canvas;
  }, null, { timeout: 15000 });

  const box = await page.locator('.xterm').boundingBox();
  if (!box || box.width < 100 || box.height < 80) {
    throw new Error(`${name}: terminal is not correctly framed`);
  }

  const canvasPixels = await page.evaluate(() => {
    const canvas = document.querySelector('.xterm canvas');
    if (!canvas) return { checked: false, nonBlank: true };
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const { data } = ctx.getImageData(0, 0, Math.min(canvas.width, 80), Math.min(canvas.height, 40));
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0 && (data[i - 1] || data[i - 2] || data[i - 3])) {
          return { checked: true, nonBlank: true };
        }
      }
      return { checked: true, nonBlank: false };
    }
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { checked: true, nonBlank: false };
    const w = Math.min(canvas.width, 80);
    const h = Math.min(canvas.height, 40);
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(0, Math.max(0, canvas.height - h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0 && (data[i - 1] || data[i - 2] || data[i - 3])) {
        return { checked: true, nonBlank: true };
      }
    }
    return { checked: true, nonBlank: false };
  });
  const terminalPng = PNG.sync.read(await page.locator('.xterm').screenshot());
  let variedPixels = 0;
  const first = [
    terminalPng.data[0],
    terminalPng.data[1],
    terminalPng.data[2],
    terminalPng.data[3],
  ];
  for (let i = 0; i < terminalPng.data.length; i += 4) {
    const diff = Math.abs(terminalPng.data[i] - first[0])
      + Math.abs(terminalPng.data[i + 1] - first[1])
      + Math.abs(terminalPng.data[i + 2] - first[2])
      + Math.abs(terminalPng.data[i + 3] - first[3]);
    if (diff > 18) variedPixels++;
    if (variedPixels > 80) break;
  }
  if (variedPixels <= 80) throw new Error(`${name}: terminal surface is visually blank`);

  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/terminal-smoke-${name}.png`, fullPage: true });
  await context.close();
};

try {
  await waitForServer();
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : null),
    args: ['--no-sandbox'],
  });
  await runViewport(browser, 'desktop', { width: 1365, height: 768 }, false);
  await runViewport(browser, 'mobile', { width: 390, height: 844 }, true);
  await browser.close();
  console.log('terminal smoke: passed');
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
