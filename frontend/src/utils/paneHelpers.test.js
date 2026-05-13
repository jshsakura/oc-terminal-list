import { describe, it, expect } from 'vitest';
import { makePaneFromContext } from '../utils/paneHelpers';

describe('makePaneFromContext', () => {
  it('creates local pane with new sessionId from active local pane', () => {
    const tab = { type: 'local', cwd: '/home/user/project' };
    const activePane = { sessionId: 'existing-session-id', themeOverride: 'catppuccin' };
    const result = makePaneFromContext(tab, activePane);

    expect(result.id).toBeTruthy();
    expect(result.mode).toBe('terminal');
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId).not.toBe('existing-session-id');
    expect(result.hostId).toBeUndefined();
    expect(result.themeOverride).toBe('catppuccin');
    expect(result.cwd).toBe('/home/user/project');
  });

  it('creates host pane with same hostId from active host pane', () => {
    const tab = { type: 'host', hostId: 'h1', cwd: '/remote/path' };
    const activePane = { hostId: 'h1', themeOverride: 'dracula' };
    const hosts = [{ id: 'h1', theme: 'nord' }];

    const result = makePaneFromContext(tab, activePane, hosts);

    expect(result.id).toBeTruthy();
    expect(result.mode).toBe('terminal');
    expect(result.hostId).toBe('h1');
    expect(result.sessionId).toBeUndefined();
    // pane.themeOverride takes priority over host.theme
    expect(result.themeOverride).toBe('dracula');
    expect(result.cwd).toBe('/remote/path');
  });

  it('uses host theme when pane has no themeOverride', () => {
    const tab = { type: 'host', hostId: 'h1' };
    const activePane = { hostId: 'h1' };
    const hosts = [{ id: 'h1', theme: 'nord' }];

    const result = makePaneFromContext(tab, activePane, hosts);

    expect(result.themeOverride).toBe('nord');
  });

  it('uses localTheme fallback for local pane without themeOverride', () => {
    const tab = { type: 'local' };
    const activePane = { sessionId: 'abc' };

    const result = makePaneFromContext(tab, activePane, [], 'tokyo');

    expect(result.themeOverride).toBe('tokyo');
  });

  it('falls back to tab hostId when active pane is empty', () => {
    const tab = { type: 'host', hostId: 'h2', cwd: '/home' };
    const activePane = {};
    const hosts = [{ id: 'h2', theme: 'gruvbox' }];

    const result = makePaneFromContext(tab, activePane, hosts);

    expect(result.hostId).toBe('h2');
    expect(result.themeOverride).toBe('gruvbox');
  });

  it('falls back to local session when both pane and tab have no context', () => {
    const tab = { type: 'local' };
    const activePane = {};

    const result = makePaneFromContext(tab, activePane);

    expect(result.sessionId).toBeTruthy();
    expect(result.hostId).toBeUndefined();
  });

  it('does not copy tmuxSessionName from host pane', () => {
    const tab = { type: 'host', hostId: 'h1' };
    const activePane = { hostId: 'h1', tmuxSessionName: 'my-session' };
    const hosts = [{ id: 'h1' }];

    const result = makePaneFromContext(tab, activePane, hosts);

    expect(result.tmuxSessionName).toBeUndefined();
  });

  it('always produces a pane with sessionId or hostId — never empty', () => {
    const cases = [
      [{ type: 'local' }, { sessionId: 'x' }],
      [{ type: 'host', hostId: 'h1' }, { hostId: 'h1' }],
      [{ type: 'local' }, {}],
      [{ type: 'host', hostId: 'h1' }, {}],
      [{}, {}],
    ];

    for (const [tab, pane] of cases) {
      const result = makePaneFromContext(tab, pane, [{ id: 'h1' }], 'localTheme');
      expect(
        result.sessionId || result.hostId,
        `Expected sessionId or hostId for tab=${JSON.stringify(tab)} pane=${JSON.stringify(pane)}`
      ).toBeTruthy();
    }
  });

  it('prefers pane.cwd over tab.cwd', () => {
    const tab = { type: 'local', cwd: '/tab-cwd' };
    const activePane = { sessionId: 'x', cwd: '/pane-cwd' };

    const result = makePaneFromContext(tab, activePane);

    expect(result.cwd).toBe('/pane-cwd');
  });

  it('preserves empty string cwd as workspace root', () => {
    const tab = { type: 'local', cwd: '/tab-cwd' };
    const activePane = { sessionId: 'x', cwd: '' };

    const result = makePaneFromContext(tab, activePane);

    expect(result.cwd).toBe('');
  });

  it('uses tab.cwd when pane has no cwd', () => {
    const tab = { type: 'local', cwd: '/tab-cwd' };
    const activePane = { sessionId: 'x' };

    const result = makePaneFromContext(tab, activePane);

    expect(result.cwd).toBe('/tab-cwd');
  });

  it('generates unique ids across calls', () => {
    const tab = { type: 'local' };
    const activePane = { sessionId: 'x' };

    const a = makePaneFromContext(tab, activePane);
    const b = makePaneFromContext(tab, activePane);

    expect(a.id).not.toBe(b.id);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
