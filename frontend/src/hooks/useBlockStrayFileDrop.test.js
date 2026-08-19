import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../components/terminal/terminalHelpers', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadFileAndGetPath: vi.fn(async (file) => ({ path: `/ws/.pasted/${file.name}` })),
}));

import useBlockStrayFileDrop from './useBlockStrayFileDrop';
import attachTerminalFileDrop from '../components/terminal/attachTerminalFileDrop';
import { uploadFileAndGetPath } from '../components/terminal/terminalHelpers';

/* 터미널을 조준하다 빗맞은 드롭 → 브라우저가 파일을 열며 앱 이탈(탭 상태 전부 소실).
   이 가드가 그걸 삼킨다. 대가로 진짜 드롭 존까지 죽이면 안 된다 — 둘 다 검증한다. */

const makeDataTransfer = (types = ['Files'], files = []) => ({
  types,
  dropEffect: '',
  files,
  items: files.map((file) => ({
    kind: 'file',
    getAsFile: () => file,
    webkitGetAsEntry: () => ({ isDirectory: false }),
  })),
});

const fire = (target, type, dataTransfer) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
  return event;
};

describe('useBlockStrayFileDrop', () => {
  let rendered;

  beforeEach(() => {
    uploadFileAndGetPath.mockClear();
    rendered = renderHook(() => useBlockStrayFileDrop());
  });

  afterEach(() => rendered.unmount());

  it('아무도 안 받는 파일 드롭은 삼킨다 — 안 그러면 브라우저가 파일을 열고 앱을 떠난다', () => {
    const stray = document.createElement('div'); // 탭 바·여백 같은 비-드롭존
    document.body.appendChild(stray);

    const dragover = fire(stray, 'dragover', makeDataTransfer());
    expect(dragover.defaultPrevented).toBe(true);

    const drop = fire(stray, 'drop', makeDataTransfer());
    expect(drop.defaultPrevented).toBe(true);

    stray.remove();
  });

  it('여기엔 못 놓는다고 커서로 알린다', () => {
    const dt = makeDataTransfer();
    fire(document.body, 'dragover', dt);
    expect(dt.dropEffect).toBe('none');
  });

  it('탭 드래그(내부 MIME)는 건드리지 않는다 — 탭 재정렬이 죽지 않게', () => {
    const dt = makeDataTransfer(['application/x-iterminallist-tab']);
    const event = fire(document.body, 'dragover', dt);
    expect(event.defaultPrevented).toBe(false);
    expect(dt.dropEffect).toBe('');
  });

  it('터미널 드롭은 그대로 살아있다 — 가드가 진짜 드롭 존을 삼키면 안 된다', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const term = { paste: vi.fn(), focus: vi.fn() };
    const handle = attachTerminalFileDrop({
      term,
      container,
      logger: { error: vi.fn(), warn: vi.fn() },
      setDropActive: vi.fn(),
      setImagePasteState: vi.fn(),
    });

    const dt = makeDataTransfer(['Files'], [{ name: 'a.png', size: 1 }]);
    fire(container, 'dragover', dt);
    expect(dt.dropEffect).toBe('copy'); // 가드의 'none' 이 덮어쓰지 않았다

    fire(container, 'drop', dt);
    await vi.waitFor(() => expect(term.paste).toHaveBeenCalledWith('/ws/.pasted/a.png '));

    handle.detach();
    container.remove();
  });

  it('언마운트하면 리스너를 걷는다', () => {
    rendered.unmount();
    const event = fire(document.body, 'drop', makeDataTransfer());
    expect(event.defaultPrevented).toBe(false);
  });
});
