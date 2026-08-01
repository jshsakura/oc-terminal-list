import { describe, it, expect, vi, beforeEach } from 'vitest';

// createVncClient: noVNC RFB 인스턴스 생성 + 이벤트 배선 + 멱등 destroy.
// 이게 틀리면 VNC 가 안 켜지거나, 언마운트해도 WS 가 안 끊겨 백엔드에 좀비 세션이 쌓인다.

// 가짜 RFB — 생성자 인자·프로퍼티 대입·이벤트 리스너·disconnect 호출을 기록한다.
// 진짜 noVNC 를 불러오면 수백 KB 코드가 테스트에 끌려들어와 느려지고 취약해진다.
let lastRfb;
class FakeRFB {
  constructor(container, url, opts) {
    this.container = container;
    this.url = url;
    this.opts = opts;
    this.listeners = {};
    this.scaleViewport = null;
    this.resizeSession = null;
    this.qualityLevel = null;
    this.compressionLevel = null;
    this.disconnected = false;
    this._listenersRemoved = false;
    lastRfb = this;
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeEventListener(name, fn) {
    delete this.listeners[name];
    this._listenersRemoved = true;
  }
  disconnect() { this.disconnected = true; }
}

describe('createVncClient', () => {
  let createVncClient;

  beforeEach(async () => {
    lastRfb = null;
    vi.doMock('@novnc/novnc', () => ({ default: FakeRFB }));
    // doMock 후 모듈 캐시를 지워야 새 mock 이 잡힌다.
    vi.resetModules();
    ({ default: createVncClient } = await import('./createVncClient'));
  });

  const baseOpts = () => ({
    container: { appendChild: vi.fn() },
    url: 'wss://host/ws/vnc/host1?display=0&client_id=abc',
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onCredentialsRequired: vi.fn(),
    onSecurityFailure: vi.fn(),
  });

  it('new RFB(container, url, { wsProtocols: ["binary"] }) 로 생성한다', async () => {
    const opts = baseOpts();
    await createVncClient(opts);
    expect(lastRfb).toBeTruthy();
    expect(lastRfb.container).toBe(opts.container);
    expect(lastRfb.url).toBe(opts.url);
    expect(lastRfb.opts).toEqual({ wsProtocols: ['binary'] });
  });

  it('scaleViewport = true, resizeSession = true 로 설정한다 (핵심: resizeSession 토글)', async () => {
    // resizeSession=true 여야 VncPane 의 ResizeObserver 가 드래그 중 false 로 토글할 수 있다.
    await createVncClient(baseOpts());
    expect(lastRfb.scaleViewport).toBe(true);
    expect(lastRfb.resizeSession).toBe(true);
  });

  it('qualityLevel / compressionLevel 을 rfb 에 적용한다 (Task 4)', async () => {
    await createVncClient({ ...baseOpts(), qualityLevel: 9, compressionLevel: 0 });
    expect(lastRfb.qualityLevel).toBe(9);
    expect(lastRfb.compressionLevel).toBe(0);
  });

  it('qualityLevel / compressionLevel 기본값은 balanced (6, 3)', async () => {
    await createVncClient(baseOpts());
    expect(lastRfb.qualityLevel).toBe(6);
    expect(lastRfb.compressionLevel).toBe(3);
  });

  it('connect/disconnect/credentialsrequired/securityfailure 리스너를 건다', async () => {
    await createVncClient(baseOpts());
    expect(typeof lastRfb.listeners.connect).toBe('function');
    expect(typeof lastRfb.listeners.disconnect).toBe('function');
    expect(typeof lastRfb.listeners.credentialsrequired).toBe('function');
    expect(typeof lastRfb.listeners.securityfailure).toBe('function');
  });

  it('connect 이벤트 → onConnected 호출', async () => {
    const opts = baseOpts();
    await createVncClient(opts);
    lastRfb.listeners.connect();
    expect(opts.onConnected).toHaveBeenCalledTimes(1);
  });

  it('disconnect 이벤트 → onDisconnected 에 detail 전달', async () => {
    const opts = baseOpts();
    await createVncClient(opts);
    const ev = { detail: { clean: true } };
    lastRfb.listeners.disconnect(ev);
    expect(opts.onDisconnected).toHaveBeenCalledWith({ clean: true });
  });

  it('credentialsrequired 이벤트 → onCredentialsRequired 에 detail 전달', async () => {
    const opts = baseOpts();
    await createVncClient(opts);
    const ev = { detail: { types: ['vnc'] } };
    lastRfb.listeners.credentialsrequired(ev);
    expect(opts.onCredentialsRequired).toHaveBeenCalledWith({ types: ['vnc'] });
  });

  it('securityfailure 이벤트 → onSecurityFailure 에 detail 전달', async () => {
    const opts = baseOpts();
    await createVncClient(opts);
    const ev = { detail: { reason: 'bad password' } };
    lastRfb.listeners.securityfailure(ev);
    expect(opts.onSecurityFailure).toHaveBeenCalledWith({ reason: 'bad password' });
  });

  it('destroy() 는 모든 리스너를 제거하고 rfb.disconnect() 를 부른다', async () => {
    const { destroy } = await createVncClient(baseOpts());
    destroy();
    expect(lastRfb._listenersRemoved).toBe(true);
    expect(lastRfb.disconnected).toBe(true);
  });

  it('destroy() 는 멱원이다 — 두 번째 호출은 no-op (StrictMode 이중 호출 대응)', async () => {
    const { destroy } = await createVncClient(baseOpts());
    destroy();
    // 두 번째 호출 전 상태 스냅샷 — disconnect 가 중복으로 불리지 않는지 확인 위해
    // 리스너를 다시 달아두고 destroy 가 건드리지 않는지 본다.
    lastRfb.disconnected = false;
    lastRfb._listenersRemoved = false;
    expect(() => destroy()).not.toThrow();
    expect(lastRfb.disconnected).toBe(false);
    expect(lastRfb._listenersRemoved).toBe(false);
  });

  it('{ rfb, destroy } 형태로 반환한다', async () => {
    const result = await createVncClient(baseOpts());
    expect(result.rfb).toBe(lastRfb);
    expect(typeof result.destroy).toBe('function');
  });
});
