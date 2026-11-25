import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useDocumentTabs from './useDocumentTabs';

describe('internal document tabs', () => {
  it('deduplicates full paths while keeping local and remote files distinct', () => {
    const { result } = renderHook(() => useDocumentTabs());
    act(() => { result.current.openDocument('a.md'); result.current.openDocument('remote:h1:/a.md'); result.current.openDocument('a.md'); });
    expect(result.current.documentFiles).toEqual(['a.md', 'remote:h1:/a.md']);
    expect(result.current.activeDocument).toBe('a.md');
    act(() => result.current.leaveDocument());
    expect(result.current.activeDocument).toBeNull();
    expect(result.current.documentFiles).toHaveLength(2);
    act(() => result.current.openDocument('a.md'));
    act(() => result.current.closeDocument('a.md'));
    expect(result.current.activeDocument).toBe('remote:h1:/a.md');
    act(() => result.current.closeDocument('remote:h1:/a.md'));
    expect(result.current.activeDocument).toBeNull();
  });
});
