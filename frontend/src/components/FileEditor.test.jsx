import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import FileEditor from './FileEditor';
import themes from '../styles/themes';

// value 를 실제로 그린다 — 그래야 "에디터가 열렸는데 비어 있다" 를 테스트가 볼 수 있다.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }) => <div data-testid="monaco-editor">
    {value}
    <input aria-label="editor-input" value={value || ''} onChange={(event) => onChange(event.target.value)} />
  </div>,
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

  it.each(['a.txt', 'remote:h1:/home/u/a.txt'])('keeps edits made while saving %s dirty', async (fileKey) => {
    let finishSave;
    global.fetch = vi.fn((url, options) => {
      if (options?.method === 'POST') {
        return new Promise((resolve) => { finishSave = resolve; });
      }
      return Promise.resolve({ ok: true, json: async () => ({ content: 'original', revision: 'rev-1' }) });
    });
    render(<FileEditor activeFile={fileKey} openFiles={[fileKey]} onFileSelect={vi.fn()} onClose={vi.fn()} theme={themes.catppuccin} />);
    await screen.findByText('original');
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'sent' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'newer edit' } });
    await act(async () => { finishSave({ ok: true, json: async () => ({ revision: 'rev-2' }) }); });
    expect(screen.getByLabelText('editor-input')).toHaveValue('newer edit');
    expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
  });

  it.each(['a.txt', 'remote:h1:/home/u/a.txt'])('sends and advances the file revision for %s', async (fileKey) => {
    global.fetch = vi.fn((url, options) => Promise.resolve({
      ok: true,
      json: async () => options?.method === 'POST' ? { revision: 'rev-2' } : { content: 'original', revision: 'rev-1' },
    }));
    render(<FileEditor activeFile={fileKey} openFiles={[fileKey]} onFileSelect={vi.fn()} onClose={vi.fn()} theme={themes.catppuccin} />);
    await screen.findByText('original');
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'save' })).toBeDisabled());
    const firstWrite = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(firstWrite[1].body).expectedRevision).toBe('rev-1');
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const writes = global.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(JSON.parse(writes[1][1].body).expectedRevision).toBe('rev-2');
  });

  it('preserves edits and permits retry after a revision conflict', async () => {
    global.fetch = vi.fn((url, options) => Promise.resolve(options?.method === 'POST'
      ? { ok: false, status: 409, json: async () => ({ detail: '파일이 변경되었습니다' }) }
      : { ok: true, json: async () => ({ content: 'original', revision: 'rev-1' }) }));
    render(<FileEditor activeFile="a.txt" openFiles={['a.txt']} onFileSelect={vi.fn()} onClose={vi.fn()} theme={themes.catppuccin} />);
    await screen.findByText('original');
    fireEvent.change(screen.getByLabelText('editor-input'), { target: { value: 'my edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByText('파일이 변경되었습니다')).toBeTruthy();
    expect(screen.getByLabelText('editor-input')).toHaveValue('my edit');
    expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
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

  it('원격 텍스트 파일의 내용을 실제로 보여준다', async () => {
    /* 회귀: `loadFile` 만 상태를 **path** 로 저장하고 나머지 전부가 **fileKey** 로 읽었다.
       로컬은 fileKey === path 라 우연히 맞았고 원격만 어긋나서, 읽기는 200 인데 에디터가
       빈 화면이었다. 게다가 "아직 안 읽었다" 가 영원히 참이라 5초마다 SSH 왕복을 다시 태웠다. */
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ content: 'REMOTE_FILE_BODY' }),
    }));
    render(
      <FileEditor
        activeFile="remote:h1:/home/u/app/main.py"
        openFiles={['remote:h1:/home/u/app/main.py']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );
    expect(await screen.findByText('REMOTE_FILE_BODY')).toBeTruthy();
  });

  it('원격 파일을 한 번 읽으면 다시 읽지 않는다 — 키가 어긋나면 무한히 다시 읽는다', async () => {
    let reads = 0;
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/files/read')) reads += 1;
      return Promise.resolve({ ok: true, json: async () => ({ content: 'BODY' }) });
    });
    const { rerender } = render(
      <FileEditor
        activeFile="remote:h1:/home/u/a.txt"
        openFiles={['remote:h1:/home/u/a.txt']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );
    await screen.findByText('BODY');
    const after = reads;
    // 렌더가 몇 번 더 돌아도 읽기는 늘지 않아야 한다(폴링 타이머는 별개 경로).
    rerender(
      <FileEditor
        activeFile="remote:h1:/home/u/a.txt"
        openFiles={['remote:h1:/home/u/a.txt']}
        onFileSelect={vi.fn()}
        onClose={vi.fn()}
        theme={themes.catppuccin}
      />
    );
    expect(reads).toBe(after);
  });

  it.each(['missing.txt', 'remote:h1:/missing.txt'])('stops polling a missing file and resumes after manual recovery: %s', async (fileKey) => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reads = 0;
    let available = false;
    global.fetch = vi.fn(async url => {
      if (String(url).includes('/files/read')) {
        reads += 1;
        return available
          ? { ok: true, json: async () => ({ content: 'recovered' }) }
          : { ok: false, status: 404, json: async () => ({ detail: 'File not found' }) };
      }
      return { ok: true, json: async () => ({ exists: false }) };
    });
    try {
      render(<FileEditor activeFile={fileKey} openFiles={[fileKey]} onFileSelect={vi.fn()} onClose={vi.fn()} theme={themes.catppuccin} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(reads).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(65000); });
      expect(reads).toBe(1);
      expect(screen.getByText('File not found')).toBeTruthy();
      available = true;
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'reset' })); });
      expect(screen.getByLabelText('editor-input')).toHaveValue('recovered');
      expect(reads).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
      expect(reads).toBeGreaterThan(2);
    } finally {
      vi.useRealTimers();
      log.mockRestore();
    }
  });

  it('원격 폴링은 로컬보다 느리다 — 폴 하나가 SSH 왕복이다', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/files/read')) reads += 1;
        return Promise.resolve({ ok: true, json: async () => ({ content: 'BODY' }) });
      });
      render(
        <FileEditor
          activeFile="remote:h1:/home/u/a.txt"
          openFiles={['remote:h1:/home/u/a.txt']}
          onFileSelect={vi.fn()}
          onClose={vi.fn()}
          theme={themes.catppuccin}
        />
      );
      await vi.advanceTimersByTimeAsync(0);
      const afterLoad = reads;
      // 로컬 주기(5s)가 여러 번 지나도 원격은 아직 안 묻는다.
      await vi.advanceTimersByTimeAsync(20000);
      expect(reads).toBe(afterLoad);
      // 원격 주기(30s)가 지나면 한 번 묻는다.
      await vi.advanceTimersByTimeAsync(11000);
      expect(reads).toBeGreaterThan(afterLoad);
    } finally {
      vi.useRealTimers();
    }
  });

  it('원격 파일을 닫으면 그 파일키가 그대로 올라간다', async () => {
    /* 닫기 경로가 다루는 값도 **fileKey** 다. 여기서 경로로 착각하면 원격 파일을 닫아도
       상태가 남아, 같은 경로의 로컬 파일을 열었을 때 남의 내용이 붙는다. */
    const onClose = vi.fn();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: async () => ({ content: 'BODY' }),
    }));
    render(
      <FileEditor
        activeFile="remote:h1:/home/u/a.txt"
        openFiles={['remote:h1:/home/u/a.txt']}
        onFileSelect={vi.fn()}
        onClose={onClose}
        theme={themes.catppuccin}
      />
    );
    await screen.findByText('BODY');
    // t() 는 키를 그대로 돌려주므로 닫기 버튼의 title 은 'close' 다.
    // ⚠️ 못 찾으면 여기서 던져야 한다 — 조건부로 넘어가면 아무것도 검증하지 않고 통과한다.
    const closeBtn = document.querySelector('button[title="close"]');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledWith('remote:h1:/home/u/a.txt');
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
