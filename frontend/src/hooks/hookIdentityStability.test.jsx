import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSettings from './useSettings';
import useEditorTabs from './useEditorTabs';

/**
 * 훅이 돌려주는 **함수의 참조가 렌더마다 바뀌면** 그 아래 memo 는 전부 무력화된다.
 *
 * 실측(2026-08-31, 격리 인스턴스): App 상태 변경 40회에 PaneGrid·Pane·TerminalHeader·
 * Terminal 이 각각 80회 렌더됐다. **memo 를 네 군데 다 걸어도 80회 그대로**였다 — 원인은
 * memo 가 아니라 App 이 내려보내는 prop 중 딱 둘, `updateSettings` 와 `onFileSelect`
 * (= `handleFileOpen`) 가 매 렌더 새 함수였던 것. 두 훅을 `useEvent` 로 고정하자 같은
 * 조건에서 **0회**가 됐다.
 *
 * 그래서 이 테스트는 memo 를 검사하지 않는다. **그 위층의 전제**를 검사한다 — 여기가
 * 깨지면 아래의 memo 는 전부 장식이 되고, 아무 에러도 나지 않는다.
 */
describe('훅이 돌려주는 함수의 참조 안정성', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
  });

  it('useSettings 의 갱신 함수들이 렌더 사이에 같은 참조다', () => {
    const { result, rerender } = renderHook(() => useSettings(false));
    const first = {
      updateSetting: result.current.updateSetting,
      updateSettings: result.current.updateSettings,
      resetSettings: result.current.resetSettings,
    };
    rerender();
    rerender();
    for (const key of Object.keys(first)) {
      expect(result.current[key], `useSettings().${key} 가 매 렌더 새 함수다 → 하위 memo 가 전부 무력화된다`)
        .toBe(first[key]);
    }
  });

  it('useEditorTabs 의 핸들러들이 렌더 사이에 같은 참조다', () => {
    const props = { t: (k) => k, setNotification: () => {}, activeTabId: 'tab-1', liveTabIds: ['tab-1'] };
    const { result, rerender } = renderHook(() => useEditorTabs(props));
    const first = {
      handleFileOpen: result.current.handleFileOpen,
      handleFileClose: result.current.handleFileClose,
      handleFileCloseAll: result.current.handleFileCloseAll,
    };
    rerender();
    rerender();
    for (const key of Object.keys(first)) {
      expect(result.current[key], `useEditorTabs().${key} 가 매 렌더 새 함수다 → 하위 memo 가 전부 무력화된다`)
        .toBe(first[key]);
    }
  });

  it('참조는 고정이어도 최신 상태를 본다 (useEvent 의 요점)', () => {
    // 참조만 고정하고 stale closure 가 되면 그건 더 나쁜 버그다.
    const seen = [];
    let activeTabId = 'tab-1';
    const props = () => ({ t: (k) => k, setNotification: (n) => seen.push(n), activeTabId, liveTabIds: ['tab-1', 'tab-2'] });
    const { result, rerender } = renderHook((p) => useEditorTabs(p), { initialProps: props() });
    const open = result.current.handleFileOpen;

    activeTabId = 'tab-2';
    rerender(props());
    expect(result.current.handleFileOpen).toBe(open);   // 참조는 그대로

    // 지원하지 않는 파일 → setNotification 이 불려야 한다(최신 props 의 것으로)
    result.current.handleFileOpen('/x/a.bin');
    expect(seen.length, '고정된 참조가 옛 closure 를 붙잡고 있다').toBeGreaterThan(0);
  });
});
