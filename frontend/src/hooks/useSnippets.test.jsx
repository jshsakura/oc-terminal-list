import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useSnippets, { _resetSnippetsStore } from './useSnippets';

describe('useSnippets', () => {
  beforeEach(() => {
    _resetSnippetsStore();
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [{ id: 1, name: 'a', command: 'ls' }] }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('여러 곳에서 마운트해도 요청은 한 번만 나간다', async () => {
    const a = renderHook(() => useSnippets(true));
    const b = renderHook(() => useSnippets(true));
    const c = renderHook(() => useSnippets(true));

    await waitFor(() => expect(a.result.current.snippets).toHaveLength(1));
    expect(b.result.current.snippets).toHaveLength(1);
    expect(c.result.current.snippets).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('enabled=false 면 아무것도 안 부른다', async () => {
    renderHook(() => useSnippets(false));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('한 곳에서 만든 스니펫이 다른 구독자에게도 보인다', async () => {
    const a = renderHook(() => useSnippets(true));
    const b = renderHook(() => useSnippets(true));
    await waitFor(() => expect(a.result.current.snippets).toHaveLength(1));

    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 2, name: 'b', command: 'pwd' }) }));
    await act(async () => { await a.result.current.create({ name: 'b', command: 'pwd' }); });

    expect(b.result.current.snippets.map((s) => s.id)).toEqual([1, 2]);
  });

  it('실패하면 캐시를 남기지 않아 다음 마운트가 다시 시도한다', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    const a = renderHook(() => useSnippets(true));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    a.unmount();

    renderHook(() => useSnippets(true));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
