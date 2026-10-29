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

  it('searches names on the host, and opens a hit as a remote file', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/files/search')) {
        return json({ items: [{ path: '/home/u/app/main.py', name: 'main.py', type: 'file' }] });
      }
      return json({ path: '/home/u', resolved: '/home/u', items: [] });
    });
    const onFileSelect = vi.fn();
    render(<FileTree hostId="h1" onFileSelect={onFileSelect} />);
    fireEvent.click(await screen.findByTitle('searchFiles'));
    fireEvent.change(screen.getByPlaceholderText('searchFiles'), { target: { value: 'main' } });
    fireEvent.click(await screen.findByText('main.py'));
    expect(onFileSelect).toHaveBeenCalledWith('/home/u/app/main.py', 'h1');
    const searchCall = global.fetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/files/search'));
    expect(searchCall).toContain('/api/hosts/h1/files/search?q=main&mode=name&path=%2Fhome%2Fu');
  });
});
