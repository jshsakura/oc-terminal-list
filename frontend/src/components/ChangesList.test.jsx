import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangesList from './ChangesList';

const mockT = (key) => key;

vi.mock('../hooks/useGitChanges', () => ({
  __esModule: true,
  default: () => ({
    items: [],
    branch: '',
    repo: null,
    error: null,
    refresh: () => {},
    loading: false,
  }),
}));

describe('ChangesList skeleton loading', () => {
  it('shows skeleton rows while loading with no items', () => {
    vi.doMock('../hooks/useGitChanges', () => ({
      __esModule: true,
      default: () => ({
        items: [],
        branch: '',
        repo: null,
        error: null,
        refresh: () => {},
        loading: true,
      }),
    }));

    const { container } = render(<ChangesList t={mockT} />);
    const list = container.querySelector('[style*="min-height"]');
    expect(list).toBeTruthy();
  });

  it('has min-height on the list container', () => {
    const { container } = render(<ChangesList t={mockT} />);
    const list = container.querySelector('[style*="min-height"]');
    expect(list).toBeTruthy();
  });

  it('uses glass section styling for the changes header', () => {
    const { container } = render(<ChangesList t={mockT} />);
    const header = container.querySelector('[style*="backdrop-filter"]') ||
      container.querySelector('[style*="color-mix"]');
    expect(header).toBeTruthy();
  });

  it('treats empty string gitContextPath as valid (not "no active terminal")', () => {
    const { container } = render(
      <ChangesList t={mockT} gitContextPath="" sharedGitChanges={{ items: [], branch: '', repo: null, repos: [], error: null, refresh: () => {}, loading: false }} />
    );
    // With empty string path, should show "no git here" not "no active terminal"
    expect(container.textContent).not.toContain('noActiveTerminal');
  });

  it('reveals a changed file parent folder from the context menu', () => {
    const onRevealInFiles = vi.fn();
    render(
      <ChangesList
        t={mockT}
        gitContextPath=""
        sharedGitChanges={{
          items: [{ path: 'src/App.jsx', kind: 'modified', staged: false }],
          branch: 'main',
          repo: '/workspace/repo',
          repos: [],
          error: null,
          refresh: () => {},
          loading: false,
        }}
        onRevealInFiles={onRevealInFiles}
      />
    );

    fireEvent.contextMenu(screen.getByText('App.jsx').closest('button'), { clientX: 80, clientY: 90 });
    fireEvent.click(screen.getByText('showInFileExplorer'));

    expect(onRevealInFiles).toHaveBeenCalledWith('src', null, 'src/App.jsx');
  });

  it('opens changed files and shows diffs from the context menu', async () => {
    const onOpenFile = vi.fn();
    const fetchDiff = vi.fn().mockResolvedValue({ patch: 'diff --git a/src/App.jsx b/src/App.jsx' });

    render(
      <ChangesList
        t={mockT}
        gitContextPath=""
        sharedGitChanges={{
          items: [{ path: 'src/App.jsx', kind: 'modified', staged: false }],
          branch: 'main',
          repo: '/workspace/repo',
          repos: [],
          error: null,
          refresh: () => {},
          loading: false,
          fetchDiff,
        }}
        onOpenFile={onOpenFile}
      />
    );

    const row = screen.getByText('App.jsx').closest('button');
    fireEvent.contextMenu(row, { clientX: 80, clientY: 90 });
    fireEvent.click(screen.getByText('openInEditor'));
    expect(onOpenFile).toHaveBeenCalledWith('src/App.jsx', null);

    fireEvent.contextMenu(row, { clientX: 80, clientY: 90 });
    fireEvent.click(screen.getByText('viewDiff'));

    await waitFor(() => expect(fetchDiff).toHaveBeenCalledWith('src/App.jsx', false));
    expect(await screen.findByText('diff --git a/src/App.jsx b/src/App.jsx')).toBeTruthy();
  });
});
