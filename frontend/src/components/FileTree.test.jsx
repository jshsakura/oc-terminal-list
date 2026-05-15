import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileTree from './FileTree';

vi.mock('../hooks/useGitChanges', () => ({
  __esModule: true,
  default: () => ({ items: [], branch: '', repo: '', repos: [], error: null, refresh: () => {}, loading: false }),
}));

vi.mock('../hooks/useTranslation', () => ({
  __esModule: true,
  default: () => ({ t: (key) => key }),
}));

describe('FileTree skeleton loading', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows skeleton bars while root is loading', async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const { container } = render(<FileTree />);

    await waitFor(() => {
      const skeletons = container.querySelectorAll('[aria-busy="true"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    resolveFetch({ ok: true, json: () => Promise.resolve({ path: '', items: [] }) });
  });

  it('applies min-height to the list container', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));

    const { container } = render(<FileTree />);

    const list = container.querySelector('[style*="min-height"]');
    expect(list).toBeTruthy();
  });

  it('keeps search collapsed until the header search action is clicked', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));

    render(<FileTree />);

    const input = screen.getByPlaceholderText('searchFiles');
    const searchBar = input.parentElement;
    expect(searchBar.style.opacity).toBe('0');
    expect(input.tabIndex).toBe(-1);

    fireEvent.click(screen.getByTitle('searchFiles'));

    expect(searchBar.style.opacity).toBe('1');
    expect(input.tabIndex).toBe(0);
  });
});
