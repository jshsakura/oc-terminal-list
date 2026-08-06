import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../terminal/terminalHelpers', () => ({ uploadImageAndGetPath: vi.fn() }));
import { uploadImageAndGetPath } from '../terminal/terminalHelpers';
import useImageAttach from './useImageAttach';

// 여러 pane 에 동시 전송하면 **각 pane 의 호스트마다** 이미지를 올려야 한다.
// 한 경로가 서로 다른 머신에서 동시에 유효할 수 없으므로, 전송이 pane 별로
// 나가는 걸 이용해 경로도 pane 별로 다르게 끼운다.

const PANES = [
  { key: 'p-local', hostId: null },
  { key: 'p-a', hostId: 'A' },
  { key: 'p-b', hostId: 'B' },
  { key: 'p-a2', hostId: 'A' },
];

const attach = async (result, blob) => {
  await act(async () => { await result.current.handlePaste(makePasteEvent(blob)); });
};
const makePasteEvent = (blob) => ({
  clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => blob }] },
  preventDefault: () => {},
});

beforeEach(() => {
  uploadImageAndGetPath.mockReset();
  uploadImageAndGetPath.mockImplementation((_blob, hostId) =>
    Promise.resolve({ path: `/tmp/iterminallist-paste/img-${hostId || 'local'}.webp` }));
});

describe('첨부 없음', () => {
  it('바꿀 게 없으면 빈 맵 — 업로드도 안 한다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    const out = await result.current.resolveTextForTargets('ls -al', ['p-a', 'p-b'], PANES);
    expect(out).toEqual({});
    expect(uploadImageAndGetPath).not.toHaveBeenCalled();
  });
});

describe('호스트별 경로 치환', () => {
  it('4개 pane 이 서로 다른 호스트면 각 호스트로 올려 경로를 갈아끼운다', async () => {
    const inserted = [];
    const { result } = renderHook(() => useImageAttach((s) => inserted.push(s), null));
    await attach(result, new Blob(['x'], { type: 'image/png' }));

    // 붙여넣는 순간엔 보고 있는 pane(로컬)에 한 번만 올라간다.
    expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1);
    expect(inserted[0]).toContain('img-local.webp');

    const text = `분석해줘 ${'/tmp/iterminallist-paste/img-local.webp'} `;
    const out = await result.current.resolveTextForTargets(
      text, ['p-local', 'p-a', 'p-b', 'p-a2'], PANES);

    expect(out['p-local']).toContain('img-local.webp');
    expect(out['p-a']).toContain('img-A.webp');
    expect(out['p-b']).toContain('img-B.webp');
    expect(out['p-a2']).toContain('img-A.webp');
    // 나머지 텍스트는 그대로.
    expect(out['p-b'].startsWith('분석해줘 ')).toBe(true);
  });

  it('같은 호스트 pane 이 둘이어도 그 호스트엔 한 번만 올린다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    await attach(result, new Blob(['x'], { type: 'image/png' }));
    uploadImageAndGetPath.mockClear();

    await result.current.resolveTextForTargets(
      '/tmp/iterminallist-paste/img-local.webp', ['p-a', 'p-a2'], PANES);
    // A 로 한 번만 (로컬은 이미 있음)
    expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1);
    expect(uploadImageAndGetPath).toHaveBeenCalledWith(expect.anything(), 'A');
  });

  it('대상이 전부 붙여넣은 호스트면 추가 업로드가 없다 — 흔한 경우 비용 0', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    await attach(result, new Blob(['x'], { type: 'image/png' }));
    uploadImageAndGetPath.mockClear();

    await result.current.resolveTextForTargets(
      '/tmp/iterminallist-paste/img-local.webp', ['p-local'], PANES);
    expect(uploadImageAndGetPath).not.toHaveBeenCalled();
  });

  it('한 호스트 업로드가 실패해도 나머지 pane 은 보낸다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    await attach(result, new Blob(['x'], { type: 'image/png' }));
    uploadImageAndGetPath.mockImplementation((_b, hostId) => (hostId === 'B'
      ? Promise.reject(new Error('SFTP 실패'))
      : Promise.resolve({ path: `/tmp/iterminallist-paste/img-${hostId || 'local'}.webp` })));

    const text = '/tmp/iterminallist-paste/img-local.webp';
    const out = await result.current.resolveTextForTargets(text, ['p-a', 'p-b'], PANES);
    expect(out['p-a']).toContain('img-A.webp');     // 성공한 쪽은 정상
    expect(out['p-b']).toBe(text);                  // 실패한 쪽은 원래 경로 유지
  });

  it('원격 pane 에서 붙여넣었으면 그쪽이 기준이 된다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), 'A'));
    await attach(result, new Blob(['x'], { type: 'image/png' }));
    const out = await result.current.resolveTextForTargets(
      '/tmp/iterminallist-paste/img-A.webp', ['p-local', 'p-b'], PANES);
    expect(out['p-local']).toContain('img-local.webp');
    expect(out['p-b']).toContain('img-B.webp');
  });
});

describe('전송 후 정리', () => {
  it('첨부 기록을 비운다 — 다음 명령에 옛 경로가 딸려가면 안 된다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    await attach(result, new Blob(['x'], { type: 'image/png' }));
    act(() => result.current.clearAttachments());
    const out = await result.current.resolveTextForTargets('다음 명령', ['p-a'], PANES);
    expect(out).toEqual({});
  });
});

// 모바일 갤러리는 여러 장 선택이 기본 동작이다. 한 장만 받으면 사용자는 피커를
// 다섯 번 열어야 하고, 대개는 "안 되는구나" 하고 그냥 참고 쓴다.
describe('여러 장 한 번에', () => {
  const makeChangeEvent = (files) => ({ target: { files, value: 'x' } });
  const img = (name) => Object.assign(new Blob([name], { type: 'image/png' }), { name });

  it('고른 순서대로 전부 올리고 경로를 순서대로 끼워넣는다', async () => {
    const inserted = [];
    const { result } = renderHook(() => useImageAttach((s) => inserted.push(s), null));
    const order = [];
    uploadImageAndGetPath.mockImplementation(async (blob) => {
      order.push(await blob.text());
      return { path: `/tmp/iterminallist-paste/${await blob.text()}.webp` };
    });

    await act(async () => {
      await result.current.handleFileChange(makeChangeEvent([img('a'), img('b'), img('c')]));
    });

    expect(order).toEqual(['a', 'b', 'c']);          // 동시가 아니라 순차 — 순서가 보장된다
    expect(inserted).toHaveLength(3);
    expect(inserted[0]).toContain('a.webp');
    expect(inserted[2]).toContain('c.webp');
  });

  it('이미지가 아닌 파일은 걸러낸다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    const pdf = new Blob(['p'], { type: 'application/pdf' });
    await act(async () => {
      await result.current.handleFileChange(makeChangeEvent([img('a'), pdf]));
    });
    expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1);
  });

  it('중간 한 장이 실패해도 나머지는 올라간다', async () => {
    const inserted = [];
    const { result } = renderHook(() => useImageAttach((s) => inserted.push(s), null));
    uploadImageAndGetPath.mockImplementation(async (blob) => {
      const name = await blob.text();
      if (name === 'b') throw new Error('업로드 실패');
      return { path: `/tmp/iterminallist-paste/${name}.webp` };
    });

    await act(async () => {
      await result.current.handleFileChange(makeChangeEvent([img('a'), img('b'), img('c')]));
    });

    expect(inserted).toHaveLength(2);               // a, c 는 살아남는다
    expect(inserted[1]).toContain('c.webp');
    expect(result.current.uploadState).toBe('error');
  });

  it('클립보드에 이미지가 여럿이면 전부 받는다', async () => {
    const { result } = renderHook(() => useImageAttach(vi.fn(), null));
    const item = (b) => ({ kind: 'file', type: 'image/png', getAsFile: () => b });
    await act(async () => {
      await result.current.handlePaste({
        clipboardData: { items: [item(img('a')), item(img('b'))] },
        preventDefault: () => {},
      });
    });
    expect(uploadImageAndGetPath).toHaveBeenCalledTimes(2);
  });
});
