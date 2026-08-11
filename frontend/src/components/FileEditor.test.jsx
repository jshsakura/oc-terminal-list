import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileEditor from './FileEditor';
import themes from '../styles/themes';

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: () => <div data-testid="monaco-editor" />,
  DiffEditor: () => <div data-testid="monaco-diff-editor" />,
  loader: { config: () => {} },
}));

// 실제 monaco 워커/번들을 끌어오지 않도록 초기화는 no-op 으로 — 테스트는 에디터 UI 만 검증.
vi.mock('../setupMonaco', () => ({
  __esModule: true,
  default: () => {},
  setupMonaco: () => {},
}));

vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../hooks/useTranslation', () => ({
  __esModule: true,
  default: () => ({ t: (key) => key }),
}));

describe('FileEditor', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: 'console.log("ok");' }),
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses glass styling for the editor shell', () => {
    const { container } = render(
      <FileEditor
        activeFile="src/app.js"
        openFiles={['src/app.js']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );

    expect(container.firstChild.style.backdropFilter).toMatch(/blur\(.*18px\)/);
  });

  it('restores persisted diff view preference', () => {
    localStorage.setItem('iterm:file-editor-diff-view:v1', JSON.stringify({ 'src/app.js': true }));

    render(
      <FileEditor
        activeFile="src/app.js"
        openFiles={['src/app.js']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );

    expect(screen.getByText('app.js')).toBeTruthy();
  });

  // 미리보기는 로컬/원격이 같은 그림을 그린다 — 갈리는 것은 raw 엔드포인트 경로뿐이다.
  it('previews a local image through the workspace raw endpoint', () => {
    const { container } = render(
      <FileEditor
        activeFile="assets/cand-1.png"
        openFiles={['assets/cand-1.png']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );

    const src = container.querySelector('img')?.getAttribute('src');
    expect(src).toContain('/api/files/raw?path=assets%2Fcand-1.png');
  });

  it('previews a remote image through that host raw endpoint', () => {
    const { container } = render(
      <FileEditor
        activeFile="remote:h1:/home/u/cand-1.png"
        openFiles={['remote:h1:/home/u/cand-1.png']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );

    const src = container.querySelector('img')?.getAttribute('src');
    expect(src).toContain('/api/hosts/h1/files/raw?path=%2Fhome%2Fu%2Fcand-1.png');
  });
});
