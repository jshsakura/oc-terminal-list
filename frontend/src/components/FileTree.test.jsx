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

  it('can return to the previous root after going up', async () => {
    global.fetch = vi.fn((url) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path') || '/workspace/app';
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ path, items: [] }),
      });
    });

    const { container } = render(<FileTree hostId="host-1" initialPath="/workspace/app" />);

    expect(container.querySelector('[title="/workspace/app"]')).toBeTruthy();

    fireEvent.click(screen.getByTitle('goUp'));

    await waitFor(() => {
      expect(container.querySelector('[title="/workspace"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle('goDown'));

    await waitFor(() => {
      expect(container.querySelector('[title="/workspace/app"]')).toBeTruthy();
    });
  });
});
