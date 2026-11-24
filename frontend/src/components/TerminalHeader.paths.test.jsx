import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TerminalHeader from './TerminalHeader';

const gitChanges = vi.hoisted(() => ({
  items: [{ path: 'note.txt', kind: 'modified', staged: false }],
  branch: 'main', repo: '/chosen', repos: [], loading: false, refresh: () => {},
}));
vi.mock('../hooks/useGitChanges', () => ({ default: () => gitChanges }));

describe('TerminalHeader file navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path') || '';
      return { ok: true, json: async () => ({ resolved: path,
        items: [{ name: `${path.split('/').pop()}.txt`, path: `${path}/item.txt`, type: 'file' }] }) };
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.removeItem('iterm:terminal-header-panel:v1:path-test');
  });

  it.each([
    { activeHostId: 'host-1', paneCwd: '/after' },
    { activeHostId: 'host-2', paneCwd: '/before' },
  ])('명시적으로 연 폴더는 경로 또는 호스트가 바뀌면 현재 터미널을 따라간다 (%j)', async (next) => {
    const props = { settings: { theme: 'catppuccin' }, t: key => key,
      terminalKey: 'path-test', activeHostId: 'host-1', paneCwd: '/before' };
    const view = render(<TerminalHeader {...props} />);
    const panelListening = new Promise(resolve => {
      const add = document.addEventListener.bind(document);
      vi.spyOn(document, 'addEventListener').mockImplementation((type, ...args) => {
        add(type, ...args);
        if (type === 'mousedown') resolve();
      });
    });
    // Git is the Changes tab inside the Files panel; the Files icon carries its count.
    fireEvent.click(screen.getByTitle('files (1)'));
    await panelListening;
    fireEvent.click(document.querySelector('[data-panel-tab="git"]'));
    fireEvent.contextMenu((await screen.findByText('note.txt')).closest('button'));
    fireEvent.mouseDown(screen.getByText('showInFileExplorer'));
    fireEvent.click(screen.getByText('showInFileExplorer'));
    await screen.findByText('chosen.txt');

    view.rerender(<TerminalHeader {...props} {...next} />);

    await screen.findByText(`${next.paneCwd.slice(1)}.txt`);
    expect(screen.queryByText('chosen.txt')).toBeNull();
  });
});
