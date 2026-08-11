import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('offers one control to close every open file', () => {
    // 사진 여러 장을 열어보면 탭이 금세 쌓인다 — 하나씩 X 를 누르는 것 말고 길이 있어야 한다.
    const onCloseAll = vi.fn();
    render(
      <FileEditor
        activeFile="a/1.png"
        openFiles={['a/1.png', 'a/2.png', 'a/3.png']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={onCloseAll}
        theme={themes.catppuccin}
      />
    );

    // 레일 버튼은 아이콘 + 개수 배지 — 라벨은 title 에 있다(상단 탭바와 같은 어휘).
    fireEvent.click(screen.getByTitle('closeAllFiles (3)'));
    expect(onCloseAll).toHaveBeenCalledTimes(1);
  });

  it('keeps the close-all rail in place for a single file too', () => {
    // 개수에 따라 나타났다 사라지면 그 자리를 믿을 수 없다 — 한 개일 때가 정리하려던 순간이다.
    const onCloseAll = vi.fn();
    render(
      <FileEditor
        activeFile="a/1.png"
        openFiles={['a/1.png']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={onCloseAll}
        theme={themes.catppuccin}
      />
    );
    fireEvent.click(screen.getByTitle('closeAllFiles (1)'));
    expect(onCloseAll).toHaveBeenCalledTimes(1);
  });

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

  it('renders a CSV as a table when preview is toggled on', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: 'name,qty\n"Kim, J",2' }),
    }));

    render(
      <FileEditor
        activeFile="data/orders.csv"
        openFiles={['data/orders.csv']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );

    // t() is mocked to echo keys, so the toggle button reads 'preview'.
    fireEvent.click(await screen.findByText('preview'));

    // The quoted comma stays inside one cell — that is the parser doing its job.
    expect(await screen.findByText('Kim, J')).toBeTruthy();
    expect(screen.getByText('qty')).toBeTruthy();
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
