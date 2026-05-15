import { describe, it, expect } from 'vitest';
import { appendPaneAsSplit } from './tabPaneOpen';

describe('appendPaneAsSplit', () => {
  it('adds a mobile-created pane inside the same tab as sub-tab state', () => {
    const tab = {
      id: 'tab-1',
      panes: [{ id: 'pane-1', sessionId: 's1' }],
      activePaneId: 'pane-1',
      layout: 'single',
      splitTree: { type: 'pane', paneId: 'pane-1' },
    };

    const next = appendPaneAsSplit(
      tab,
      { id: 'pane-2', sessionId: 's2', cwd: 'src' },
      { afterPaneId: 'pane-1', dir: 'right', viewMode: 'tabs' },
    );

    expect(next.id).toBe('tab-1');
    expect(next.panes).toHaveLength(2);
    expect(next.activePaneId).toBe('pane-2');
    expect(next.viewMode).toBe('tabs');
    expect(next.layout).toBe('h');
    expect(JSON.stringify(next.splitTree)).toContain('pane-1');
    expect(JSON.stringify(next.splitTree)).toContain('pane-2');
  });

  it('uses vertical layout for down/up insertion', () => {
    const tab = {
      id: 'tab-1',
      panes: [{ id: 'pane-1', sessionId: 's1' }],
      activePaneId: 'pane-1',
    };

    const next = appendPaneAsSplit(tab, { id: 'pane-2', sessionId: 's2' }, { dir: 'down' });

    expect(next.layout).toBe('v');
  });
});
