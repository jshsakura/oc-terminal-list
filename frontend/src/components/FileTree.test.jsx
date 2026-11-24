import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it.each([true, false])('이전 경로의 늦은 응답이 현재 폴더를 덮어쓰지 않는다 (ok=%s)', async (ok) => {
    let completeOld;
    global.fetch = vi.fn((url) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path');
      if (path === '/workspace/app') return new Promise(resolve => { completeOld = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ resolved: '/workspace',
        items: [{ name: 'current.txt', path: '/workspace/current.txt', type: 'file' }] }) });
    });
    const { container } = render(<FileTree hostId="host-1" initialPath="/workspace/app" />);
    fireEvent.click(screen.getByTitle('goUp'));
    await screen.findByText('current.txt');

    await act(async () => completeOld({ ok, status: 500, json: async () => ({ resolved: '/workspace/app',
      items: [{ name: 'old.txt', path: '/workspace/app/old.txt', type: 'file' }] }) }));

    expect(screen.getByText('current.txt')).toBeTruthy();
    expect(screen.queryByText('old.txt')).toBeNull();
    expect(container.querySelector('[title="/workspace"]')).toBeTruthy();
  });

  it('같은 폴더도 새로고침 전의 늦은 응답으로 되돌아가지 않는다', async () => {
    let completeOld;
    global.fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }))
      .mockResolvedValue({ ok: true, json: async () => ({ items: [{ name: 'current.txt', path: 'current.txt', type: 'file' }] }) });
    render(<FileTree />);
    fireEvent.click(screen.getByTitle('refresh'));
    await screen.findByText('current.txt');

    await act(async () => completeOld({ ok: true, json: async () => ({ items: [] }) }));

    expect(screen.getByText('current.txt')).toBeTruthy();
  });

  it('명시적으로 연 폴더를 마운트나 새로고침 때 터미널 cwd로 바꾸지 않는다', async () => {
    const onRefreshCwd = vi.fn().mockResolvedValue({ cwd: '/terminal' });
    global.fetch = vi.fn((url) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path');
      return Promise.resolve({ ok: true, json: async () => ({ resolved: path,
        items: [{ name: `${path.split('/').pop()}.txt`, path: `${path}/file.txt`, type: 'file' }] }) });
    });
    render(<FileTree hostId="host-1" initialPath="/chosen" onRefreshCwd={onRefreshCwd} />);
    await screen.findByText('chosen.txt');

    await act(async () => { fireEvent.click(screen.getByTitle('refresh')); });

    expect(screen.getByText('chosen.txt')).toBeTruthy();
    expect(screen.queryByText('terminal.txt')).toBeNull();
  });

  it('opens a file on double-click, not single-click', async () => {
    const onFileSelect = vi.fn();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        path: '',
        items: [{ name: 'note.txt', path: 'note.txt', type: 'file' }],
      }),
    }));

    render(<FileTree onFileSelect={onFileSelect} />);

    const row = await screen.findByText('note.txt');
    fireEvent.click(row);
    expect(onFileSelect).not.toHaveBeenCalled(); // 단일 클릭은 선택만

    fireEvent.doubleClick(row);
    expect(onFileSelect).toHaveBeenCalledWith('note.txt', null);
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
        expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }),
      );
      expect(URL.createObjectURL).not.toHaveBeenCalled();
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
        expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }),
      );
      expect(URL.createObjectURL).not.toHaveBeenCalled();
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
        expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }),
      );
      expect(URL.createObjectURL).not.toHaveBeenCalled();
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
