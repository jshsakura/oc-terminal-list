import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./terminalHelpers', () => ({
  uploadFileAndGetPath: vi.fn(async (file) => ({ path: `/ws/.pasted/${file.name}` })),
}));

import attachTerminalFileDrop, {
  collectDroppedFiles,
  quotePathForShell,
} from './attachTerminalFileDrop';
import { isFileDrag, setTreeDragPayload } from '../../utils/fileDrag';
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

  /* 파일 탐색기에서 폴더/파일을 끌어와 셸에 떨구면 **업로드 없이** 경로만 들어간다 —
     이미 그 기계에 있는 파일이다. 엔터는 여전히 치지 않는다(드롭이 곧 실행이면 사고). */
  describe('탐색기에서 끌어온 경로', () => {
    const treeDrag = (path, sourceHost = '') => ({
      types: ['application/x-filetree-path'],
      dropEffect: '',
      getData: (mime) => {
        if (mime === 'application/x-filetree-path') return path;
        if (mime === 'application/x-filetree-host') return sourceHost;
        return '';
      },
    });

    const attachWithCwd = (cwd, hostId = null) => {
      handle.detach();
      handle = attachTerminalFileDrop({
        term, container, logger, setDropActive, setImagePasteState, hostId,
        getPaneCwd: () => cwd,
      });
    };

    it('로컬 pane — 워크스페이스 상대 경로를 절대로 바꿔 넣고 업로드는 안 한다', () => {
      attachWithCwd({ isLocal: true, cwdAbs: '/w/nb/proj', cwdRel: 'proj' });

      fire(container, 'drop', treeDrag('proj/backend'));

      expect(term.paste).toHaveBeenCalledWith('/w/nb/proj/backend ');
      expect(uploadFileAndGetPath).not.toHaveBeenCalled();
      expect(term.focus).toHaveBeenCalled();
    });

    it('원격 pane — 트리 경로가 이미 절대라 그대로', () => {
      attachWithCwd({ isLocal: false, cwdAbs: '/home/pi', cwdRel: '' }, 'h1');

      fire(container, 'drop', treeDrag('/home/pi/app', 'h1'));

      expect(term.paste).toHaveBeenCalledWith('/home/pi/app ');
    });

    it('공백 든 경로는 셸 인자로 쪼개지지 않게 감싼다', () => {
      attachWithCwd({ isLocal: true, cwdAbs: '/w/nb', cwdRel: '' });

      fire(container, 'drop', treeDrag('my docs/a.txt'));

      expect(term.paste).toHaveBeenCalledWith("'/w/nb/my docs/a.txt' ");
    });

    /* 셸이 워크스페이스 밖으로 cd 했으면 루트를 역산할 수 없다. 상대 경로를 그대로
       넣으면 조용히 딴 데를 가리키므로 아무것도 넣지 않고 실패를 알린다. */
    it('절대 경로를 못 만들면 넣지 않고 실패를 알린다', () => {
      attachWithCwd({ isLocal: true, cwdAbs: '/tmp/other', cwdRel: 'proj' });

      fire(container, 'drop', treeDrag('proj/backend'));

      expect(term.paste).not.toHaveBeenCalled();
      expect(setImagePasteState).toHaveBeenCalledWith('error');
    });

    /* 분할 화면에서는 A pane 의 탐색기에서 B pane 으로 끌 수 있다. 두 pane 의 호스트가
       다르면 그 경로는 저쪽에서 아무것도 가리키지 않는다 — 조용히 넣으면 안 된다. */
    it('다른 호스트의 pane 에 떨구면 넣지 않는다', () => {
      attachWithCwd({ isLocal: false, cwdAbs: '/home/pi', cwdRel: '' }, 'h1');

      fire(container, 'drop', treeDrag('proj/backend', ''));   // 로컬 트리 → 원격 pane

      expect(term.paste).not.toHaveBeenCalled();
      expect(setImagePasteState).toHaveBeenCalledWith('error');
    });

    it('원격 → 로컬 pane 도 마찬가지로 거절한다', () => {
      attachWithCwd({ isLocal: true, cwdAbs: '/w/nb', cwdRel: '' }, null);

      fire(container, 'drop', treeDrag('/home/pi/app', 'h1'));

      expect(term.paste).not.toHaveBeenCalled();
    });

    it('같은 원격 호스트끼리는 통과한다', () => {
      attachWithCwd({ isLocal: false, cwdAbs: '/home/pi', cwdRel: '' }, 'h1');

      fire(container, 'drop', treeDrag('/home/pi/logs', 'h1'));

      expect(term.paste).toHaveBeenCalledWith('/home/pi/logs ');
    });

    /* 페이로드는 한 쌍으로만 다룬다 — 새 드래그 소스가 경로만 싣고 호스트를 빠뜨리면
       받는 쪽이 조용히 거절하거나(로컬 기본값) 더 나쁘게 통과시킨다. */
    it('setTreeDragPayload 가 경로와 호스트를 함께 싣는다', () => {
      const written = {};
      setTreeDragPayload({ setData: (k, v) => { written[k] = v; } },
        { path: '/home/pi/app', hostId: 'h1' });
      expect(written).toEqual({
        'application/x-filetree-path': '/home/pi/app',
        'application/x-filetree-host': 'h1',
      });
    });

    it('로컬은 호스트를 빈 문자열로 싣는다 (undefined 로 새지 않게)', () => {
      const written = {};
      setTreeDragPayload({ setData: (k, v) => { written[k] = v; } }, { path: 'a/b' });
      expect(written['application/x-filetree-host']).toBe('');
    });

    it('dragover 에서 preventDefault — 안 하면 drop 이 오지 않는다', () => {
      attachWithCwd({ isLocal: true, cwdAbs: '/w/nb', cwdRel: '' });

      const e = fire(container, 'dragover', treeDrag('a'));

      expect(e.defaultPrevented).toBe(true);
      expect(setDropActive).toHaveBeenCalledWith(true);
    });
  });
});
