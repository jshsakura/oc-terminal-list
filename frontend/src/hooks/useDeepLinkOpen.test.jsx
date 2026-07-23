import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import useDeepLinkOpen from './useDeepLinkOpen';

/** ?open= 을 심고 훅을 렌더한다. setTabs 는 updater 를 tabs 에 적용해 되돌려준다. */
function setup(search, tabs) {
  window.history.replaceState({}, '', search ? `/?open=${search}` : '/');
  let current = tabs;
  const setActiveTabId = vi.fn();
  const setTabs = vi.fn((updater) => { current = updater(current); });
  const view = renderHook(
    ({ t, ready }) => useDeepLinkOpen({ tabs: t, setActiveTabId, setTabs, ready }),
    { initialProps: { t: tabs, ready: true } },
  );
  return { setActiveTabId, setTabs, getTabs: () => current, view };
}

describe('useDeepLinkOpen', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));

  it('activates the tab and pane holding the target session', () => {
    const tabs = [
      { id: 'tA', panes: [{ id: 'p1', sessionId: 's-other' }] },
      { id: 'tB', activePaneId: 'p2', panes: [{ id: 'p2', sessionId: 's-x' }, { id: 'p3', sessionId: 's-y' }] },
    ];
    const { setActiveTabId, getTabs } = setup('s-y', tabs);

    expect(setActiveTabId).toHaveBeenCalledWith('tB');
    expect(getTabs().find((t) => t.id === 'tB').activePaneId).toBe('p3');
  });

  it('clears the open param from the URL after a match', () => {
    const tabs = [{ id: 'tA', panes: [{ id: 'p1', sessionId: 's-x' }] }];
    setup('s-x', tabs);
    expect(window.location.search).toBe('');
  });

  it('does nothing and gives up when the session is gone (ready)', () => {
    const tabs = [{ id: 'tA', panes: [{ id: 'p1', sessionId: 's-x' }] }];
    const { setActiveTabId } = setup('s-missing', tabs);
    expect(setActiveTabId).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');   // 포기해도 파라미터는 정리
  });

  it('waits for restore: not-ready + missing keeps the param for a retry', () => {
    window.history.replaceState({}, '', '/?open=s-late');
    const setActiveTabId = vi.fn();
    const setTabs = vi.fn();
    const { rerender } = renderHook(
      ({ t, ready }) => useDeepLinkOpen({ tabs: t, setActiveTabId, setTabs, ready }),
      { initialProps: { t: [], ready: false } },
    );
    // 아직 복원 전 — 못 찾았지만 파라미터를 지우지 않는다.
    expect(window.location.search).toBe('?open=s-late');

    // 복원이 끝나 탭이 들어오면 활성화된다.
    rerender({ t: [{ id: 'tZ', panes: [{ id: 'pz', sessionId: 's-late' }] }], ready: true });
    expect(setActiveTabId).toHaveBeenCalledWith('tZ');
    expect(window.location.search).toBe('');
  });

  it('does nothing without an open param', () => {
    const { setActiveTabId } = setup('', [{ id: 'tA', panes: [{ id: 'p1', sessionId: 's-x' }] }]);
    expect(setActiveTabId).not.toHaveBeenCalled();
  });
});
