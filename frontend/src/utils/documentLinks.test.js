import { describe, expect, it, vi, afterEach } from 'vitest';
import { documentLinkUrl, documentWindowUrl, openDocumentWindow, resolveDocumentPath } from './documentLinks';

afterEach(() => { vi.restoreAllMocks(); });

describe('server document links', () => {
  const root = '/work/projects';
  const file = 'project/docs/AUDIT.md';
  it.each([
    ['./screenshots/chart.png', 'project/docs/screenshots/chart.png'],
    ['../images/chart.webp', 'project/images/chart.webp'],
    ['screenshots/%ED%95%9C%EA%B8%80%20%231.png', 'project/docs/screenshots/한글 #1.png'],
    ['/work/projects/project/image.png', 'project/image.png'],
    ['file:///work/projects/project/image.png', 'project/image.png'],
  ])('resolves %s relative to the document', (url, expected) => {
    expect(resolveDocumentPath(url, file, root)).toEqual({ path: expected, hostId: null, fileKey: expected });
    expect(documentLinkUrl(url, 'src', file, root)).toBe(`/api/files/raw?path=${encodeURIComponent(expected)}`);
    expect(documentLinkUrl(url, 'href', file, root)).toBe(documentWindowUrl(expected));
  });
  it.each(['../../../secret.png', '/etc/passwd', '/work/projects-other/image.png', '/work/projects/../secret.png', 'javascript:alert(1)', 'data:text/html,test', 'file://other-host/etc/passwd', '%00.png', '%E0%A4%A'])('rejects %s', (url) => {
    expect(documentLinkUrl(url, 'src', file, root)).toBe('');
  });
  it.each(['https://example.com/image.png', 'http://example.com/a.png', '//example.com/a.png', '#part-1', 'mailto:a@example.com'])('preserves web and anchor links: %s', (url) => {
    expect(documentLinkUrl(url, 'href', file, root)).toBe(url);
  });
  it('uses the remote host and document directory for images', () => {
    expect(documentLinkUrl('../images/a.png', 'src', 'remote:h1:/home/u/docs/a.md'))
      .toBe('/api/hosts/h1/files/raw?path=%2Fhome%2Fu%2Fimages%2Fa.png');
    expect(documentLinkUrl('/var/images/a.png', 'href', 'remote:h1:/home/u/a.md'))
      .toBe(documentWindowUrl('remote:h1:/var/images/a.png'));
  });
  it('opens an independent popup without its opener', () => {
    const popup = { opener: window, focus: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    expect(openDocumentWindow('a/한글 #1.md')).toBe(true);
    expect(open).toHaveBeenCalledWith(documentWindowUrl('a/한글 #1.md'), '_blank', expect.stringContaining('popup,width='));
    expect(popup.opener).toBeNull();
    expect(popup.focus).toHaveBeenCalledOnce();
  });
  it('opens mobile documents without desktop popup dimensions', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    const popup = { opener: window, focus: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    expect(openDocumentWindow(file)).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(documentWindowUrl(file), '_blank');
    expect(popup.opener).toBeNull();
  });
  it('reports a blocked popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openDocumentWindow(file)).toBe(false);
  });
});
