import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { killPaneSession, restartCwdFor } from './restartSession';

const okResponse = { ok: true, status: 200 };

describe('killPaneSession', () => {
  beforeEach(() => { global.fetch = vi.fn().mockResolvedValue(okResponse); });
  afterEach(() => vi.restoreAllMocks());

  test('deletes the local tmux session by session id', async () => {
    const result = await killPaneSession({ isLocal: true, sessionId: 'sess-1' });

    expect(result).toEqual({ ok: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/sessions/sess-1');
    expect(opts.method).toBe('DELETE');
  });

  test('kills the remote tmux session by name', async () => {
    const result = await killPaneSession({
      isLocal: false, hostId: 'host-1', remoteTmuxSession: 'mobile-abc_2',
    });

    expect(result).toEqual({ ok: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/hosts/host-1/kill-tmux?session=mobile-abc_2');
    expect(opts.method).toBe('POST');
  });

  test('skips the kill for a remote host that does not use remote tmux', async () => {
    // 죽일 세션이 없다 — 재접속만으로 새 셸이 뜬다.
    const result = await killPaneSession({ isLocal: false, hostId: 'host-1', remoteTmuxSession: null });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reports a failed request instead of throwing', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await killPaneSession({ isLocal: true, sessionId: 'sess-1' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  test('reports a network error instead of throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(killPaneSession({ isLocal: true, sessionId: 'sess-1' })).resolves.toEqual({
      ok: false, error: 'offline',
    });
  });

  test('refuses to call the API without an id', async () => {
    expect(await killPaneSession({ isLocal: true, sessionId: null })).toEqual({ ok: false, error: 'missing sessionId' });
    expect(await killPaneSession({ isLocal: false, hostId: null })).toEqual({ ok: false, error: 'missing hostId' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('percent-encodes ids so a crafted session name cannot alter the path', async () => {
    await killPaneSession({ isLocal: true, sessionId: 'a/../b' });

    expect(global.fetch.mock.calls[0][0]).toBe('/api/sessions/a%2F..%2Fb');
  });
});

describe('restartCwdFor', () => {
  // 로컬은 워크스페이스 상대경로여야 한다 — 백엔드 validate_path() 가 선행 '/' 를 떼고
  // 워크스페이스에 이어붙이므로 절대경로를 주면 엉뚱한 곳을 가리킨다.
  test('uses the workspace-relative path for local panes', () => {
    expect(restartCwdFor({ isLocal: true, paneCwdRel: 'demo/src', paneCwdAbs: '/home/u/ws/demo/src' }))
      .toBe('demo/src');
  });

  test('uses the absolute path for remote panes', () => {
    expect(restartCwdFor({ isLocal: false, paneCwdRel: null, paneCwdAbs: '/srv/app' }))
      .toBe('/srv/app');
  });

  test('keeps the workspace root (empty string) rather than falling back to null', () => {
    expect(restartCwdFor({ isLocal: true, paneCwdRel: '', paneCwdAbs: '/home/u/ws' })).toBe('');
  });

  test('returns null when the local pane sits outside the workspace', () => {
    expect(restartCwdFor({ isLocal: true, paneCwdRel: null, paneCwdAbs: '/etc' })).toBeNull();
  });
});
