import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useEditorTabs from './useEditorTabs';

const noopT = (k) => k;
const noopNotify = () => {};

describe('useEditorTabs per-tab scoping', () => {
  beforeEach(() => localStorage.clear());

  it('opening a file in tab A does not leak into tab B', () => {
    let activeTabId = 'A';
    const { result, rerender } = renderHook(
      ({ tabId }) => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: tabId }),
      { initialProps: { tabId: activeTabId } },
    );

    // Open a file while on tab A
    act(() => result.current.handleFileOpen('/work/a.txt'));
    expect(result.current.activeFile).toBe('/work/a.txt');
    expect(result.current.openFiles).toEqual(['/work/a.txt']);

    // Switch to tab B — should be empty
    rerender({ tabId: 'B' });
    expect(result.current.activeFile).toBeNull();
    expect(result.current.openFiles).toEqual([]);

    // Switch back to A — file still there
    rerender({ tabId: 'A' });
    expect(result.current.activeFile).toBe('/work/a.txt');
  });

  it('each tab keeps its own active file', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: tabId }),
      { initialProps: { tabId: 'A' } },
    );
    act(() => result.current.handleFileOpen('/work/a.txt'));
    rerender({ tabId: 'B' });
    act(() => result.current.handleFileOpen('/work/b.txt'));
    expect(result.current.activeFile).toBe('/work/b.txt');
    rerender({ tabId: 'A' });
    expect(result.current.activeFile).toBe('/work/a.txt');
  });
});

describe('useEditorTabs bulk close', () => {
  beforeEach(() => localStorage.clear());

  const setup = () => renderHook(
    () => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: 'A' }),
  );

  it('close-all empties this tab only', () => {
    const { result } = setup();
    act(() => result.current.handleFileOpen('/w/1.png'));
    act(() => result.current.handleFileOpen('/w/2.png'));
    act(() => result.current.handleFileCloseAll());

    expect(result.current.openFiles).toEqual([]);
    expect(result.current.activeFile).toBeNull();
  });

  it('close-all on an empty tab is a no-op, not a crash', () => {
    const { result } = setup();
    act(() => result.current.handleFileCloseAll());
    expect(result.current.openFiles).toEqual([]);
  });
});

