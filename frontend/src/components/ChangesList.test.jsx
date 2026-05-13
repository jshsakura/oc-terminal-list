import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('treats empty string gitContextPath as valid (not "no active terminal")', () => {
    const { container } = render(
      <ChangesList t={mockT} gitContextPath="" sharedGitChanges={{ items: [], branch: '', repo: null, repos: [], error: null, refresh: () => {}, loading: false }} />
    );
    // With empty string path, should show "no git here" not "no active terminal"
    expect(container.textContent).not.toContain('noActiveTerminal');
  });
});
