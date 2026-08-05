import { describe, expect, it } from 'vitest';
import { attachPaneTargets, findPaneForSession, normalizeCwd } from './llmSessionPane';

const tab = (id, cwd, panes) => ({ id, cwd, panes });

describe('normalizeCwd', () => {
  it('drops a trailing slash so /a/b and /a/b/ are the same place', () => {
    expect(normalizeCwd('/a/b/')).toBe('/a/b');
    expect(normalizeCwd('/a/b')).toBe('/a/b');
  });

  it('keeps root as a single slash', () => {
    expect(normalizeCwd('/')).toBe('/');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizeCwd('/a//b')).toBe('/a/b');
  });

  it('treats missing or non-string input as no path', () => {
    expect(normalizeCwd(undefined)).toBe('');
    expect(normalizeCwd(null)).toBe('');
    expect(normalizeCwd(42)).toBe('');
  });
});

describe('findPaneForSession', () => {
  it('matches a local session to a pane with no hostId', () => {
    const tabs = [tab('t1', '/home/me/proj', [{ id: 'p1' }])];
    expect(findPaneForSession({ host_id: 'local', cwd: '/home/me/proj' }, tabs))
      .toEqual({ tabId: 't1', paneId: 'p1' });
  });

  it('matches a remote session on its own host', () => {
    const tabs = [tab('t1', '/srv/app', [{ id: 'p1', hostId: 'h9' }])];
    expect(findPaneForSession({ host_id: 'h9', cwd: '/srv/app' }, tabs))
      .toEqual({ tabId: 't1', paneId: 'p1' });
  });

  it('does not match the same path on a different host', () => {
    const tabs = [tab('t1', '/srv/app', [{ id: 'p1', hostId: 'h9' }])];
    expect(findPaneForSession({ host_id: 'other', cwd: '/srv/app' }, tabs)).toBeNull();
  });

  it('does not confuse a local pane with a remote one at the same path', () => {
    const tabs = [tab('t1', '/srv/app', [{ id: 'p1' }])];
    expect(findPaneForSession({ host_id: 'h9', cwd: '/srv/app' }, tabs)).toBeNull();
  });

  it("prefers the pane's own cwd over the tab's", () => {
    const tabs = [tab('t1', '/tab/path', [
      { id: 'p1', cwd: '/pane/path' },
      { id: 'p2', cwd: '/other' },
    ])];
    expect(findPaneForSession({ host_id: 'local', cwd: '/pane/path' }, tabs))
      .toEqual({ tabId: 't1', paneId: 'p1' });
    // 탭 경로로는 안 잡힌다 — pane 이 자기 경로를 들고 있으면 그게 진실이다.
    expect(findPaneForSession({ host_id: 'local', cwd: '/tab/path' }, tabs)).toBeNull();
  });

  it('ignores non-terminal panes — agents do not run in vnc or editor panes', () => {
    const tabs = [tab('t1', '/a', [
      { id: 'v1', mode: 'vnc' },
      { id: 'e1', mode: 'editor' },
      { id: 'p1', mode: 'terminal' },
    ])];
    expect(findPaneForSession({ host_id: 'local', cwd: '/a' }, tabs))
      .toEqual({ tabId: 't1', paneId: 'p1' });
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(findPaneForSession({ host_id: 'local', cwd: '/nope' }, [tab('t1', '/a', [{ id: 'p1' }])]))
      .toBeNull();
  });

  it('returns null when the session carries no cwd to join on', () => {
    expect(findPaneForSession({ host_id: 'local' }, [tab('t1', '/a', [{ id: 'p1' }])])).toBeNull();
  });

  it('survives malformed tab data', () => {
    expect(findPaneForSession({ host_id: 'local', cwd: '/a' }, null)).toBeNull();
    expect(findPaneForSession({ host_id: 'local', cwd: '/a' }, [{ id: 't1' }])).toBeNull();
  });
});

describe('attachPaneTargets', () => {
  it('adds a pane target to each session, null where none exists', () => {
    const tabs = [tab('t1', '/a', [{ id: 'p1' }])];
    const out = attachPaneTargets([{ cwd: '/a' }, { cwd: '/b' }], tabs);
    expect(out[0].pane).toEqual({ tabId: 't1', paneId: 'p1' });
    expect(out[1].pane).toBeNull();
  });

  it('does not mutate the input rows', () => {
    const rows = [{ cwd: '/a' }];
    attachPaneTargets(rows, [tab('t1', '/a', [{ id: 'p1' }])]);
    expect(rows[0]).toEqual({ cwd: '/a' });
  });

  it('returns an empty list for malformed input', () => {
    expect(attachPaneTargets(null, [])).toEqual([]);
  });
});
