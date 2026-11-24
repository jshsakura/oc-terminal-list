import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FileEditor from './FileEditor';
import themes from '../styles/themes';

vi.mock('@monaco-editor/react', () => ({ default: () => <div />, DiffEditor: () => <div /> }));
vi.mock('../setupMonaco', () => ({ setupMonaco: () => {} }));
const props = { onFileSelect: vi.fn(), onClose: vi.fn(), theme: themes.catppuccin, language: 'en' };
let anchors;

beforeEach(() => {
  anchors = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    anchors.push({ href: this.getAttribute('href'), name: this.download });
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers(), json: async () => ({ content: '', exists: false }) })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('image save button', () => {
  it.each([
    ['images/한글 사진.png', '/api/files/download?path=images%2F%ED%95%9C%EA%B8%80%20%EC%82%AC%EC%A7%84.png'],
    ['remote:h1:/home/u/한글 사진.png', '/api/hosts/h1/files/download?path=%2Fhome%2Fu%2F%ED%95%9C%EA%B8%80%20%EC%82%AC%EC%A7%84.png'],
  ])('downloads the original image for %s', async (fileKey, url) => {
    render(<FileEditor {...props} activeFile={fileKey} openFiles={[fileKey]} standalone />);
    const save = screen.getByRole('button', { name: 'Save', exact: true });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(anchors).toEqual([{ href: url, name: '한글 사진.png' }]));
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'HEAD' }));
    expect(fetch.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });
  it('prevents another download while the preflight is pending', async () => {
    let finish;
    fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<FileEditor {...props} activeFile="a.png" openFiles={['a.png']} />);
    const save = screen.getByRole('button', { name: 'Save', exact: true });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true, headers: new Headers() }); });
    expect(anchors).toHaveLength(1);
    expect(save).toBeEnabled();
  });
  it('shows a failed download and permits retry', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });
    render(<FileEditor {...props} activeFile="a.png" openFiles={['a.png']} />);
    const save = screen.getByRole('button', { name: 'Save', exact: true });
    fireEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('404');
    expect(anchors).toHaveLength(0);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(anchors).toHaveLength(1));
  });
});
