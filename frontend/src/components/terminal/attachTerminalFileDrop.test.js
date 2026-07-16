import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./terminalHelpers', () => ({
  uploadFileAndGetPath: vi.fn(async (file) => ({ path: `/ws/.pasted/${file.name}` })),
}));

import attachTerminalFileDrop, {
  collectDroppedFiles,
  quotePathForShell,
} from './attachTerminalFileDrop';
import { isFileDrag } from '../../utils/fileDrag';
import { uploadFileAndGetPath } from './terminalHelpers';

/* PC 파일 드롭 → 업로드 → 경로 삽입.
   preventDefault 를 놓치면 브라우저가 파일을 열어 세션이 통째로 날아간다 — 거기부터 검증한다. */

const makeFile = (name) => ({ name, size: 10 });

// DataTransfer 는 jsdom 에 없다. 실제로 쓰는 표면만 흉내낸다.
const makeDataTransfer = ({ types = ['Files'], entries = [] } = {}) => ({
  types,
  dropEffect: '',
  files: entries.filter((e) => !e.isDirectory).map((e) => e.file),
  items: entries.map((e) => ({
    kind: 'file',
    getAsFile: () => e.file,
    webkitGetAsEntry: () => ({ isDirectory: !!e.isDirectory }),
  })),
});

const fire = (container, type, dataTransfer, extra = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.assign(event, extra);
  container.dispatchEvent(event);
  return event;
};

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('attachTerminalFileDrop', () => {
  let container;
  let term;
  let setDropActive;
  let setImagePasteState;
  let logger;
  let handle;

  beforeEach(() => {
    vi.useFakeTimers();
    // mockClear 로는 부족하다 — 앞 테스트의 mockRejectedValue 가 구현으로 남아 다음 테스트로 샌다.
    uploadFileAndGetPath.mockReset();
    uploadFileAndGetPath.mockImplementation(async (file) => ({ path: `/ws/.pasted/${file.name}` }));
    container = document.createElement('div');
    document.body.appendChild(container);
    term = { paste: vi.fn(), focus: vi.fn() };
    setDropActive = vi.fn();
    setImagePasteState = vi.fn();
    logger = { error: vi.fn(), warn: vi.fn() };
    handle = attachTerminalFileDrop({ term, container, logger, setDropActive, setImagePasteState });
  });

  afterEach(() => {
    handle.detach();
    container.remove();
    vi.useRealTimers();
  });

  describe('순수 헬퍼', () => {
    it('Files 타입이 있어야 파일 드래그로 친다', () => {
      expect(isFileDrag({ types: ['Files'] })).toBe(true);
      expect(isFileDrag({ types: ['application/x-iterminallist-tab'] })).toBe(false);
      expect(isFileDrag(null)).toBe(false);
    });

    it('평범한 경로는 그대로, 공백/따옴표가 있으면 감싼다', () => {
      expect(quotePathForShell('/ws/.pasted/a-1_b.png')).toBe('/ws/.pasted/a-1_b.png');
      expect(quotePathForShell('/my ws/a.png')).toBe("'/my ws/a.png'");
      expect(quotePathForShell("/ws/it's.png")).toBe("'/ws/it'\\''s.png'");
    });

    it('폴더는 걸러내고 개수를 센다', () => {
      const dt = makeDataTransfer({
        entries: [
          { file: makeFile('a.png') },
          { file: makeFile('docs'), isDirectory: true },
        ],
      });
      const { files, skippedDirs } = collectDroppedFiles(dt);
      expect(files.map((f) => f.name)).toEqual(['a.png']);
      expect(skippedDirs).toBe(1);
    });

    it('items 가 없는 브라우저는 files 로 폴백한다', () => {
      const { files } = collectDroppedFiles({ types: ['Files'], items: [], files: [makeFile('a.png')] });
      expect(files.map((f) => f.name)).toEqual(['a.png']);
    });
  });

  describe('드래그 하이라이트', () => {
    it('dragover 는 기본동작을 막는다 — 안 막으면 브라우저가 파일을 열어버린다', () => {
      const dt = makeDataTransfer();
      const event = fire(container, 'dragover', dt);
      expect(event.defaultPrevented).toBe(true);
      expect(dt.dropEffect).toBe('copy');
      expect(setDropActive).toHaveBeenCalledWith(true);
    });

    it('탭 드래그(내부 MIME)는 건드리지 않는다', () => {
      const event = fire(container, 'dragover', makeDataTransfer({ types: ['application/x-iterminallist-tab'] }));
      expect(event.defaultPrevented).toBe(false);
      expect(setDropActive).not.toHaveBeenCalled();
    });

    it('자식 위를 지나는 dragleave 로는 꺼지지 않는다(깜빡임 방지)', () => {
      const child = document.createElement('span');
      container.appendChild(child);
      fire(container, 'dragleave', makeDataTransfer(), { relatedTarget: child });
      expect(setDropActive).not.toHaveBeenCalledWith(false);

      fire(container, 'dragleave', makeDataTransfer(), { relatedTarget: document.body });
      expect(setDropActive).toHaveBeenCalledWith(false);
    });
  });

  describe('드롭 → 업로드 → 삽입', () => {
    it('파일 하나: 경로 + 뒤 공백을 붙여넣고, 엔터는 치지 않는다', async () => {
      const event = fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('a.png') }] }));
      expect(event.defaultPrevented).toBe(true);
      expect(setDropActive).toHaveBeenCalledWith(false);
      expect(setImagePasteState).toHaveBeenCalledWith('uploading');
      await flush();

      expect(term.paste).toHaveBeenCalledWith('/ws/.pasted/a.png ');
      expect(term.paste.mock.calls[0][0]).not.toContain('\r');
      expect(setImagePasteState).toHaveBeenCalledWith('done');
    });

    it('여러 파일: 순차 업로드 후 경로를 공백으로 이어 한 번에 넣는다', async () => {
      fire(container, 'drop', makeDataTransfer({
        entries: [{ file: makeFile('a.png') }, { file: makeFile('b.txt') }],
      }));
      await flush();

      expect(uploadFileAndGetPath).toHaveBeenCalledTimes(2);
      expect(term.paste).toHaveBeenCalledTimes(1);
      expect(term.paste).toHaveBeenCalledWith('/ws/.pasted/a.png /ws/.pasted/b.txt ');
    });

    it('일부 실패해도 성공한 경로는 넣고 error 를 띄운다', async () => {
      uploadFileAndGetPath.mockRejectedValueOnce(new Error('413'));
      fire(container, 'drop', makeDataTransfer({
        entries: [{ file: makeFile('big.iso') }, { file: makeFile('b.txt') }],
      }));
      await flush();

      expect(term.paste).toHaveBeenCalledWith('/ws/.pasted/b.txt ');
      expect(setImagePasteState).toHaveBeenCalledWith('error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('전부 실패하면 아무것도 안 넣는다', async () => {
      uploadFileAndGetPath.mockRejectedValue(new Error('boom'));
      fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('a.png') }] }));
      await flush();

      expect(term.paste).not.toHaveBeenCalled();
      expect(setImagePasteState).toHaveBeenCalledWith('error');
    });

    it('폴더만 드롭하면 업로드하지 않고 전용 안내를 띄운다', async () => {
      fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('docs'), isDirectory: true }] }));
      await flush();

      expect(uploadFileAndGetPath).not.toHaveBeenCalled();
      expect(setImagePasteState).toHaveBeenCalledWith('folder');
    });

    it('업로드 중 두 번째 드롭은 무시한다 — 경로가 뒤섞이지 않게', async () => {
      let release;
      uploadFileAndGetPath.mockImplementationOnce(() => new Promise((r) => { release = () => r({ path: '/ws/.pasted/a.png' }); }));
      fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('a.png') }] }));
      await flush();

      fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('b.txt') }] }));
      await flush();
      expect(uploadFileAndGetPath).toHaveBeenCalledTimes(1);

      release();
      await flush();
      expect(term.paste).toHaveBeenCalledWith('/ws/.pasted/a.png ');
    });

    it('토스트는 잠시 뒤 스스로 사라진다', async () => {
      fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('a.png') }] }));
      await flush();
      setImagePasteState.mockClear();
      vi.advanceTimersByTime(1200);
      expect(setImagePasteState).toHaveBeenCalledWith(null);
    });
  });

  it('detach 후엔 드롭에 반응하지 않는다', async () => {
    handle.detach();
    const event = fire(container, 'drop', makeDataTransfer({ entries: [{ file: makeFile('a.png') }] }));
    await flush();
    expect(event.defaultPrevented).toBe(false);
    expect(uploadFileAndGetPath).not.toHaveBeenCalled();
  });
});
