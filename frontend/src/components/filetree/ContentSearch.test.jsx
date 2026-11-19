import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContentSearch from './ContentSearch';
import FileTree from '../FileTree';

vi.mock('../../hooks/useGitChanges', () => ({
  __esModule: true,
  default: () => ({ items: [], branch: '', repo: '', repos: [], error: null, refresh: () => {}, loading: false }),
}));
vi.mock('../../hooks/useTranslation', () => ({
  __esModule: true,
  default: () => ({ t: (key) => key }),
}));

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

describe('ContentSearch with a custom endpoint', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('queries the url from buildUrl and lists name hits without a snippet row', async () => {
    global.fetch = vi.fn(() => json({ items: [{ path: '/home/u/reports', name: 'reports', type: 'directory' }] }));
    const buildUrl = (q) => `/api/hosts/h1/files/search?q=${q}`;
    render(<ContentSearch query="rep" t={(k) => k} buildUrl={buildUrl} onOpen={() => {}} />);
    await screen.findByText('reports');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/hosts/h1/files/search?q=rep');
  });

  it('passes the whole item to onOpen so callers can tell folders from files', async () => {
    global.fetch = vi.fn(() => json({ items: [{ path: '/home/u/reports', name: 'reports', type: 'directory' }] }));
    const onOpen = vi.fn();
    render(<ContentSearch query="rep" t={(k) => k} buildUrl={(q) => `/x?q=${q}`} onOpen={onOpen} />);
    fireEvent.click(await screen.findByText('reports'));
    expect(onOpen).toHaveBeenCalledWith('/home/u/reports', undefined, expect.objectContaining({ type: 'directory' }));
  });
});

describe('FileTree remote search', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('filters names in the current host folder instantly, without a remote search', async () => {
    global.fetch = vi.fn(() => json({ path: '/home/u', resolved: '/home/u', items: [
      { path: '/home/u/main.py', name: 'main.py', type: 'file' },
      { path: '/home/u/readme.md', name: 'readme.md', type: 'file' },
    ] }));
    const onFileSelect = vi.fn();
    render(<FileTree hostId="h1" onFileSelect={onFileSelect} />);
    await screen.findByText('readme.md');
    fireEvent.click(screen.getByTitle('searchFiles'));
    fireEvent.change(screen.getByPlaceholderText('searchFiles'), { target: { value: 'main' } });
    expect(screen.queryByText('readme.md')).toBeNull();
    // Tree rows select on click and open on double-click.
    fireEvent.doubleClick(screen.getByText('main.py'));
    expect(onFileSelect).toHaveBeenCalledWith('/home/u/main.py', 'h1');
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/files/search'))).toBe(false);
  });
});
