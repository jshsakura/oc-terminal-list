import { createRef } from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FileEditor from './FileEditor';
import themes from '../styles/themes';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }) => <textarea aria-label="editor-input" value={value || ''} onChange={(event) => onChange(event.target.value)} />,
  DiffEditor: () => <div />,
}));
vi.mock('../setupMonaco', () => ({ setupMonaco: () => {} }));

const markdown = '# Report\n\n![chart](./images/chart.png)\n\n[Open image](/work/projects/images/large.png)\n\n[Unsafe](javascript:alert%281%29)';
const props = { activeFile: 'docs/report.md', openFiles: ['docs/report.md'], onFileSelect: vi.fn(), onClose: vi.fn(), theme: themes.catppuccin, language: 'en' };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    json: async () => url === '/api/files/workspace' ? { root: '/work/projects' } : { content: markdown, revision: 'v1', exists: false },
  })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('document viewing', () => {
  it('preserves unsaved edits when reselecting a document changed on disk', async () => {
    const { rerender } = render(<FileEditor {...props} isVisible />);
    await waitFor(() => expect(screen.getByLabelText('editor-input')).toHaveValue(markdown));
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'unsaved' } });
    rerender(<FileEditor {...props} isVisible={false} />);
    fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ content: 'disk update', revision: 'v2' }) }));
    rerender(<FileEditor {...props} isVisible />);
    await screen.findByText('External Change Detected');
    expect(screen.getByLabelText('editor-input')).toHaveValue('unsaved');
  });
  it('keeps browser-hidden polling stopped and refreshes only the selected document on return', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { rerender } = render(<FileEditor {...props} />);
    await waitFor(() => expect(screen.getByLabelText('editor-input')).toHaveValue(markdown));
    const reads = () => fetch.mock.calls.filter(([url]) => url.includes('/files/read?')).length;
    const before = reads();
    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(reads()).toBe(before);
    hidden.mockReturnValue(false);
    await act(async () => { fireEvent(document, new Event('visibilitychange')); });
    expect(reads()).toBe(before + 1);
    rerender(<FileEditor {...props} isVisible={false} />);
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(reads()).toBe(before + 1);
  });
  it.each(['docs/report.md', 'remote:h1:/report.md'])('pauses hidden polling and refreshes on selection: %s', async (fileKey) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const editorProps = { ...props, activeFile: fileKey, openFiles: [fileKey] };
    const { rerender, unmount } = render(<FileEditor {...editorProps} isVisible />);
    await waitFor(() => expect(screen.getByLabelText('editor-input')).toHaveValue(markdown));
    const reads = () => fetch.mock.calls.filter(([url]) => url.includes('/files/read?')).length;
    rerender(<FileEditor {...editorProps} isVisible={false} />);
    const before = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(reads()).toBe(before);
    fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ content: 'updated on disk', revision: 'v2' }) }));
    await act(async () => { rerender(<FileEditor {...editorProps} isVisible />); });
    expect(reads()).toBe(before + 1);
    expect(screen.getByLabelText('editor-input')).toHaveValue('updated on disk');
    await act(async () => { await vi.advanceTimersByTimeAsync(fileKey.startsWith('remote:') ? 30000 : 5000); });
    expect(reads()).toBe(before + 2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(reads()).toBe(before + 2);
  });
  it.each(['docs/prototype.html', 'docs/한글 # example.HTM'])('uses the isolated HTML preview route for %s', async (path) => {
    render(<FileEditor {...props} activeFile={path} openFiles={[path]} />);
    await waitFor(() => expect(screen.getByLabelText('editor-input')).toHaveValue(markdown));
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => {
      const frame = screen.getByTitle('HTML Preview');
      expect(frame.getAttribute('src')).toMatch(new RegExp(`^/api/files/preview\\?path=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}&_t=\\d+$`));
    });
  });
  it('opens document links internally when hosted in an app tab', async () => {
    const onOpenDocument = vi.fn();
    render(<FileEditor {...props} standalone showTabs={false} onOpenDocument={onOpenDocument} />);
    const link = await screen.findByRole('link', { name: 'Open image' });
    await waitFor(() => expect(link).toHaveAttribute('href', '/?document=images%2Flarge.png'));
    fireEvent.click(link);
    expect(onOpenDocument).toHaveBeenCalledWith('images/large.png');
  });
  it('protects unsaved changes when the app tab requests closing', async () => {
    const ref = createRef();
    const onClose = vi.fn();
    render(<FileEditor {...props} ref={ref} onClose={onClose} showTabs={false} />);
    await waitFor(() => expect(screen.getByLabelText('editor-input')).toHaveValue(markdown));
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'unsaved' } });
    act(() => ref.current.requestClose());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel', exact: true }).at(-1));
    expect(screen.getByLabelText('editor-input')).toHaveValue('unsaved');
  });
  it('renders relative embedded images and absolute image links in standalone preview', async () => {
    render(<FileEditor {...props} standalone />);
    await screen.findByRole('heading', { name: 'Report' });
    expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', '/api/files/raw?path=docs%2Fimages%2Fchart.png');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open image' })).toHaveAttribute('href', '/?document=images%2Flarge.png'));
    expect(screen.getByText('Unsafe').getAttribute('href')).toBe('');
    expect(screen.queryByLabelText('editor-input')).toBeNull();
  });
  it('shows a popup-blocked message without navigating the original document', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<FileEditor {...props} standalone />);
    await screen.findByRole('heading', { name: 'Report' });
    fireEvent.click(screen.getByRole('button', { name: 'Open in new window' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The new window was blocked');
    expect(screen.getByRole('heading', { name: 'Report' })).toBeTruthy();
  });
  it('keeps unsaved edits in the original window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<FileEditor {...props} />);
    await waitFor(() => expect(screen.getByLabelText('editor-input')).toHaveValue(markdown));
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'unsaved' } });
    const button = screen.getByRole('button', { name: 'Open in new window' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Save your changes before opening a new window');
    fireEvent.click(button);
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByLabelText('editor-input')).toHaveValue('unsaved');
  });
});
