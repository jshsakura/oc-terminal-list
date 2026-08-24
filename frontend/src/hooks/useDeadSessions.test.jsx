import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useDeadSessions from './useDeadSessions';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../utils/apiFetch';

const rows = (...alive) => ({
  ok: true,
  json: async () => alive.map((a, i) => ({ id: `s${i}`, alive: a })),
});

beforeEach(() => vi.mocked(apiFetch).mockReset());
afterEach(() => vi.restoreAllMocks());

describe('useDeadSessions', () => {
  it('죽은 행만 센다', async () => {
    vi.mocked(apiFetch).mockResolvedValue(rows(true, false, false));
    const { result } = renderHook(() => useDeadSessions(true));
    await waitFor(() => expect(result.current.count).toBe(2));
  });

  it('안 보이면 조회하지 않는다 — 홈은 두 곳에서 그려진다', async () => {
    renderHook(() => useDeadSessions(false));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('실패하면 0 이 아니라 null — "모른다" 와 "없다" 는 다른 사건이다', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useDeadSessions(true));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(result.current.count).toBeNull();
  });

  it('alive 필드가 없으면 추측하지 않는다', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, json: async () => [{ id: 'a' }] });
    const { result } = renderHook(() => useDeadSessions(true));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(result.current.count).toBeNull();
  });

  it('정리 후 다시 세어 화면을 맞춘다', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(rows(true, false, false))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ removed: 2 }) })
      .mockResolvedValueOnce(rows(true));
    const { result } = renderHook(() => useDeadSessions(true));
    await waitFor(() => expect(result.current.count).toBe(2));
    let removed;
    await act(async () => { removed = await result.current.prune(); });
    expect(removed).toBe(2);
    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it('서버가 거절하면(=tmux 판정 불가) 그대로 올린다 — 조용히 성공처럼 보이면 안 된다', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(rows(false))
      .mockResolvedValueOnce({ ok: false, json: async () => ({ detail: 'tmux 서버가 응답하지 않아 정리를 건너뜁니다' }) });
    const { result } = renderHook(() => useDeadSessions(true));
    await waitFor(() => expect(result.current.count).toBe(1));
    await expect(act(async () => { await result.current.prune(); }))
      .rejects.toThrow('tmux 서버가 응답하지 않아');
  });
});
