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
  let originalCreateObjectURL;
  let originalRevokeObjectURL;
  let originalAnchorClick;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
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

  it('downloads files through the authenticated download endpoint', async () => {
    global.fetch = vi.fn((url, opts = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/api/files/download?path=archive.zip')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-disposition': 'attachment; filename="archive.zip"' }),
          blob: () => Promise.resolve(new Blob(['zip'])),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          path: '',
          items: [{ name: 'archive.zip', path: 'archive.zip', type: 'file' }],
        }),
      });
    });

    render(<FileTree />);

    const row = await screen.findByText('archive.zip');
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText('download'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/files/download?path=archive.zip',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(screen.getByText('downloadStarted')).toBeTruthy();
    });
  });

  it('downloads remote files through the authenticated host download endpoint', async () => {
    global.fetch = vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/api/hosts/host-1/files/download?path=%2Ftmp%2Fremote.bin')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-disposition': "attachment; filename*=UTF-8''remote.bin" }),
          blob: () => Promise.resolve(new Blob(['remote'])),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          path: '/tmp',
          resolved: '/tmp',
          items: [{ name: 'remote.bin', path: '/tmp/remote.bin', type: 'file' }],
        }),
      });
    });

    render(<FileTree hostId="host-1" initialPath="/tmp" />);

    const row = await screen.findByText('remote.bin');
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText('download'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/hosts/host-1/files/download?path=%2Ftmp%2Fremote.bin',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(screen.getByText('downloadStarted')).toBeTruthy();
    });
  });

  it('downloads remote folders as zip through the authenticated host download endpoint', async () => {
    global.fetch = vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/api/hosts/host-1/files/download?path=%2Ftmp%2Fbundle')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-disposition': "attachment; filename*=UTF-8''bundle.zip" }),
          blob: () => Promise.resolve(new Blob(['zip'])),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          path: '/tmp',
          resolved: '/tmp',
          items: [{ name: 'bundle', path: '/tmp/bundle', type: 'directory' }],
        }),
      });
    });

    render(<FileTree hostId="host-1" initialPath="/tmp" />);

    const row = await screen.findByText('bundle');
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText('download'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/hosts/host-1/files/download?path=%2Ftmp%2Fbundle',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(screen.getByText('downloadStarted')).toBeTruthy();
    });
  });

  it('shows upload failures inline without an alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = vi.fn((url, opts = {}) => {
      if (String(url).includes('/api/files/upload')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ detail: 'disk full' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ path: '', items: [] }),
      });
    });

    const { container } = render(<FileTree />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['content'], 'note.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('uploadFailed: disk full')).toBeTruthy();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    alertSpy.mockRestore();
  });
});
