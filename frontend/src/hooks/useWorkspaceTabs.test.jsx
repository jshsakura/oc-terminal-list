import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useWorkspaceTabs from './useWorkspaceTabs';

/**
 * 회귀 방지 대상 — 기기 두 대(PC + 폰)를 동시에 열어두면 tab-state 가 서로를 되받아치며
 * 1초 주기로 PUT 이 오가던 에코 루프. 내용이 같으면 아무 요청도 나가면 안 된다.
 */

const tab = (id) => ({
  id, type: 'local', name: id, sessionId: id, panes: [{ id: `${id}-p0`, mode: 'terminal', sessionId: id }],
  layout: 'single', splitTree: { type: 'leaf', paneId: `${id}-p0` }, activePaneId: `${id}-p0`,
});

// 테스트가 직접 메시지를 흘릴 수 있는 EventSource 스텁 (jsdom 엔 없다).
const sseInstances = [];
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.close = vi.fn();
    sseInstances.push(this);
  }
  emit(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

const setupFetch = (initialServerState) => {
  const calls = { put: [], state: initialServerState };
  global.fetch = vi.fn(async (url, options = {}) => {
    if (url === '/api/tab-state' && options.method === 'PUT') {
      calls.put.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ status: 'saved', updatedAt: `v${calls.put.length}` }) };
    }
    if (url === '/api/tab-state') return { ok: true, status: 200, json: async () => calls.state };
    if (url === '/api/sessions') return { ok: true, status: 200, json: async () => [] };
    if (url.startsWith('/api/sse-ticket')) return { ok: true, status: 200, json: async () => ({ ticket: 't' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  return calls;
};

describe('useWorkspaceTabs 서버 동기화', () => {
  beforeEach(() => {
    localStorage.clear();
    sseInstances.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.EventSource = FakeEventSource;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const flushSave = async () => {
    await act(async () => { vi.advanceTimersByTime(1000); });
  };

  it('서버 상태를 그대로 복원했으면 되받아치는 PUT 을 보내지 않는다', async () => {
    // Arrange — 서버(=다른 기기가 저장한 것)와 로컬 캐시가 같은 내용
    const serverTabs = [tab('a'), tab('b')];
    localStorage.setItem('tabs_v2', JSON.stringify(serverTabs));
    const calls = setupFetch({ tabs: serverTabs, activeTabId: 'a', updatedAt: 'v0' });

    // Act
    const { result } = renderHook(() => useWorkspaceTabs({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.isRestoringWorkspace).toBe(false));
    await flushSave();

    // Assert
    expect(calls.put).toHaveLength(0);
    expect(result.current.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('실제 탭 변경은 한 번만 PUT 하고, 그 뒤 조용하다', async () => {
    const serverTabs = [tab('a')];
    const calls = setupFetch({ tabs: serverTabs, activeTabId: 'a', updatedAt: 'v0' });
    const { result } = renderHook(() => useWorkspaceTabs({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.isRestoringWorkspace).toBe(false));
    await flushSave();

    act(() => result.current.setTabs((prev) => [...prev, tab('b')]));
    await flushSave();
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0].tabs.map((t) => t.id)).toEqual(['a', 'b']);

    // 같은 내용으로 다시 setTabs (배열 참조만 새로) — 보낼 게 없다
    act(() => result.current.setTabs((prev) => [...prev]));
    await flushSave();
    expect(calls.put).toHaveLength(1);
  });

  it('복원 시 이 기기가 보던 탭을 유지한다 (다른 기기 활성 탭에 끌려가지 않음)', async () => {
    localStorage.setItem('active_tab_id', 'b');
    setupFetch({ tabs: [tab('a'), tab('b')], activeTabId: 'a', updatedAt: 'v0' });

    const { result } = renderHook(() => useWorkspaceTabs({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.isRestoringWorkspace).toBe(false));

    expect(result.current.activeTabId).toBe('b');
  });

  it('이 기기가 보던 탭이 서버 상태에 없으면 서버 활성 탭을 채택한다', async () => {
    localStorage.setItem('active_tab_id', 'gone');
    setupFetch({ tabs: [tab('a'), tab('b')], activeTabId: 'b', updatedAt: 'v0' });

    const { result } = renderHook(() => useWorkspaceTabs({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.isRestoringWorkspace).toBe(false));

    expect(result.current.activeTabId).toBe('b');
  });

  it('다른 기기의 SSE 변경을 받아 적용해도 되받아치는 PUT 을 보내지 않는다', async () => {
    const calls = setupFetch({ tabs: [tab('a')], activeTabId: 'a', updatedAt: 'v0' });
    const { result } = renderHook(() => useWorkspaceTabs({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.isRestoringWorkspace).toBe(false));
    await flushSave();
    await waitFor(() => expect(sseInstances).toHaveLength(1));

    // 다른 기기가 탭을 하나 추가함
    calls.state = { tabs: [tab('a'), tab('b')], activeTabId: 'b', updatedAt: 'remote-1' };
    await act(async () => { sseInstances[0].emit({ updatedAt: 'remote-1' }); });
    await flushSave();

    expect(result.current.tabs.map((t) => t.id)).toEqual(['a', 'b']);   // 적용은 됐고
    expect(calls.put).toHaveLength(0);                                   // 되받아치진 않는다

    // 같은 내용을 다시 push (서버가 무의미하게 버전만 올린 경우) — 역시 조용해야 한다
    calls.state = { ...calls.state, updatedAt: 'remote-2' };
    await act(async () => { sseInstances[0].emit({ updatedAt: 'remote-2' }); });
    await flushSave();
    expect(calls.put).toHaveLength(0);
  });

  it('보던 탭이 사라지면 첫 탭이 아니라 그 자리 이웃으로 간다', async () => {
    setupFetch({ tabs: [tab('a'), tab('b'), tab('c')], activeTabId: 'c', updatedAt: 'v0' });
    const { result } = renderHook(() => useWorkspaceTabs({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.isRestoringWorkspace).toBe(false));
    act(() => result.current.setActiveTabId('c'));
    expect(result.current.activeTabId).toBe('c');

    // 다른 기기가 마지막 탭을 닫음
    act(() => result.current.setTabs([tab('a'), tab('b')]));

    expect(result.current.activeTabId).toBe('b');
  });
});
