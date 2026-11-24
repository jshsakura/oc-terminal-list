import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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



describe('mobile documents open directly in a new tab', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each([['docs/guide.md', null], ['/images/photo.png', 'host1']])('opens %s without adding an embedded editor', (path, hostId) => {
    const popup = { opener: window, focus: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const { result } = renderHook(() => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: 'A', openInWindow: true }));
    act(() => result.current.handleFileOpen(path, hostId));
    const key = hostId ? `remote:${hostId}:${path}` : path;
    expect(open.mock.calls[0][0]).toBe(`/?document=${encodeURIComponent(key)}`);
    expect(result.current.openFiles).toEqual([]);
    expect(result.current.activeFile).toBeNull();
    expect(popup.opener).toBeNull();
  });

  it('falls back to the embedded editor and explains a blocked popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const notify = vi.fn();
    const { result } = renderHook(() => useEditorTabs({ t: noopT, setNotification: notify, activeTabId: 'A', openInWindow: true }));
    act(() => result.current.handleFileOpen('guide.md'));
    expect(result.current.activeFile).toBe('guide.md');
    expect(notify).toHaveBeenCalledWith({ isOpen: true, message: 'documentPopupBlocked', type: 'info' });
  });

  it('keeps desktop files embedded', () => {
    const open = vi.spyOn(window, 'open');
    const { result } = renderHook(() => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: 'A' }));
    act(() => result.current.handleFileOpen('guide.md'));
    expect(result.current.activeFile).toBe('guide.md');
    expect(open).not.toHaveBeenCalled();
  });
});


it('opens named file links in a new tab on desktop too', () => {
  localStorage.clear();
  const popup = { opener: window, focus: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  const { result } = renderHook(() => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: 'A' }));
  act(() => result.current.handleFileOpen('images/photo.png', null, { newTab: true }));
  expect(open).toHaveBeenCalledExactlyOnceWith('/?document=images%2Fphoto.png', '_blank');
  expect(result.current.activeFile).toBeNull();
  open.mockRestore();
});

it('routes named file links into app tabs before considering browser popups', () => {
  const onOpenDocument = vi.fn();
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const { result } = renderHook(() => useEditorTabs({ t: noopT, setNotification: noopNotify, activeTabId: 'A', onOpenDocument, openInWindow: true }));
  act(() => result.current.handleFileOpen('guide.md', null, { newTab: true }));
  expect(onOpenDocument).toHaveBeenCalledWith('guide.md');
  expect(open).not.toHaveBeenCalled();
  expect(result.current.openFiles).toEqual([]);
  open.mockRestore();
});
