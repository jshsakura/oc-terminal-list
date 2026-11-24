import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DocumentWindow from './DocumentWindow';

const auth = vi.hoisted(() => ({ isLoading: false, isAuthenticated: true, needsSetup: false, login: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ default: () => auth }));
vi.mock('./Login', () => ({ default: () => <div>Sign in first</div> }));
vi.mock('./FileEditor', () => ({ default: (props) => <div>
  <span>{props.activeFile}</span>
  <span>{props.standalone ? 'standalone' : 'inline'}</span>
  <button onClick={() => props.onFileSelect('/img/a.png', 'h1')}>Open remote</button>
</div> }));

beforeEach(() => {
  auth.isAuthenticated = true;
  window.history.replaceState(null, '', '/?document=docs%2Fa.md');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ settings: { language: 'en' } }) })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('independent document window', () => {
  it('loads only document settings and restores the document from its URL', async () => {
    render(<DocumentWindow />);
    expect(await screen.findByText('docs/a.md')).toBeTruthy();
    expect(screen.getByText('standalone')).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('a.md — Terminal List'));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/user/settings']);
    expect(fetch.mock.calls.every(([, options]) => !options.method)).toBe(true);
    fireEvent.click(screen.getByText('Open remote'));
    expect(screen.getByText('remote:h1:/img/a.png')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('document')).toBe('remote:h1:/img/a.png');
  });
  it('requires authentication before mounting the file viewer', async () => {
    auth.isAuthenticated = false;
    render(<DocumentWindow />);
    expect(await screen.findByText('Sign in first')).toBeTruthy();
    expect(screen.queryByText('docs/a.md')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
