import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted ensures mock variables exist before vi.mock factory is evaluated.
// vitest 4.x requires function/class (not arrow) for mock constructors.
const { mockDispose, mockOnContextLoss } = vi.hoisted(() => ({
  mockDispose: vi.fn(),
  mockOnContextLoss: vi.fn(),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    this.dispose = mockDispose;
    this.onContextLoss = mockOnContextLoss;
  }),
}));

vi.mock('./terminalConstants', () => ({
  WEBGL_IDLE_RELEASE_MS: 100,
}));

import { WebglAddon } from '@xterm/addon-webgl';
import createWebglController from './createWebglController';

const MockedWebglAddon = vi.mocked(WebglAddon);

// ── Helper ──────────────────────────────────────────────────────────────────

const makeTerm = (rows = 24) => ({
  rows,
  refresh: vi.fn(),
  loadAddon: vi.fn(),
  element: document.createElement('div'),
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('createWebglController', () => {
  beforeEach(() => {
    MockedWebglAddon.mockClear();
    mockDispose.mockClear();
    mockOnContextLoss.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attach() calls term.refresh(0, rows-1) after loading WebGL addon', () => {
    const term = makeTerm(30);
    createWebglController({ term, enabled: true, isActive: () => true });

    expect(term.loadAddon).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 29);
  });

  it('detach() calls term.refresh(0, rows-1) after disposing addon', () => {
    const term = makeTerm(24);
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });
    term.refresh.mockClear();

    ctrl.detach();

    expect(mockDispose).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  it('disabled controller never attaches', () => {
    const term = makeTerm();
    const ctrl = createWebglController({ term, enabled: false, isActive: () => true });

    expect(term.loadAddon).not.toHaveBeenCalled();
    ctrl.attach();
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('noteActivity does not attach when inactive', () => {
    const term = makeTerm();
    const ctrl = createWebglController({ term, enabled: true, isActive: () => false });

    ctrl.noteActivity();
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('noteActivity does not double-attach when already attached', () => {
    const term = makeTerm(20);
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });
    expect(term.loadAddon).toHaveBeenCalledOnce();

    ctrl.noteActivity();
    expect(term.loadAddon).toHaveBeenCalledOnce();
  });

  it('idle timer fires detach after WEBGL_IDLE_RELEASE_MS', () => {
    const term = makeTerm(24);
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });
    term.refresh.mockClear();

    vi.advanceTimersByTime(100);

    expect(mockDispose).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  it('cancelIdle prevents idle-driven detach', () => {
    const term = makeTerm();
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });

    ctrl.cancelIdle();
    vi.advanceTimersByTime(200);

    expect(mockDispose).not.toHaveBeenCalled();
  });

  it('dispose() calls detach and prevents re-attach', () => {
    const term = makeTerm();
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });

    ctrl.dispose();

    expect(mockDispose).toHaveBeenCalledOnce();
    const callsBefore = MockedWebglAddon.mock.calls.length;
    ctrl.attach();
    expect(MockedWebglAddon.mock.calls.length).toBe(callsBefore);
  });

  it('detach() is no-op when no addon is attached', () => {
    const term = makeTerm();
    const ctrl = createWebglController({ term, enabled: true, isActive: () => false });
    term.refresh.mockClear();

    ctrl.detach();

    expect(mockDispose).not.toHaveBeenCalled();
    expect(term.refresh).not.toHaveBeenCalled();
  });

  it('constructor attaches + arms idle when active on mount', () => {
    const term = makeTerm(40);
    createWebglController({ term, enabled: true, isActive: () => true });

    expect(term.loadAddon).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 39);
    vi.advanceTimersByTime(100);
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  // ── onContextLoss: 컨텍스트 고갈 경로 (4분할 버그의 실제 트리거) ──────────

  it('onContextLoss fires term.refresh for DOM renderer handoff', () => {
    const term = makeTerm(24);
    createWebglController({ term, enabled: true, isActive: () => true });
    term.refresh.mockClear();

    // attach 중에 등록된 onContextLoss 콜백을 직접 발화
    const handler = mockOnContextLoss.mock.calls[0][0];
    handler();

    expect(mockDispose).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  // ── try/catch 견고성: dispose 된 term 에 refresh 호출해도 정리 경로가 안 깨짐 ──

  it('refresh failure in attach does not undo the addon', () => {
    const term = makeTerm();
    term.refresh.mockImplementation(() => { throw new Error('term disposed'); });
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });

    // addon 이 여전히 부착되어 있는지 확인 — detach 가 dispose 를 호출하면 정상
    ctrl.detach();
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it('refresh failure in detach does not throw', () => {
    const term = makeTerm();
    const ctrl = createWebglController({ term, enabled: true, isActive: () => true });
    term.refresh.mockImplementation(() => { throw new Error('term disposed'); });

    expect(() => ctrl.detach()).not.toThrow();
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it('refresh failure in onContextLoss does not throw', () => {
    const term = makeTerm();
    createWebglController({ term, enabled: true, isActive: () => true });
    term.refresh.mockImplementation(() => { throw new Error('term disposed'); });

    const handler = mockOnContextLoss.mock.calls[0][0];
    expect(() => handler()).not.toThrow();
  });
});
