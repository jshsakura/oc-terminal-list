/**
 * 실패의 **종류**를 가른다 — 그래야 할 일이 정해진다.
 *
 * 예전에는 전부 하나의 Error 였다. 그래서 ①사용자에게 "업로드 실패" 만 말했고(파일이나
 * 호스트를 의심하게 된다) ②막힌 연결에 대고 같은 fetch 를 한 번 더 쏴 **20초를 더**
 * 태웠다. 값싼 /api/health 프로브 한 번이 그 둘을 다 없앤다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadImageAndGetPath, UploadError } from './terminalHelpers';

const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

const originalFetch = global.fetch;
const originalOnLine = Object.getOwnPropertyDescriptor(global.navigator || {}, 'onLine');

beforeEach(() => {
  // createImageBitmap 이 없으면 compressPastedImage 가 원본을 그대로 돌려준다.
  global.createImageBitmap = undefined;
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalOnLine) Object.defineProperty(global.navigator, 'onLine', originalOnLine);
  vi.restoreAllMocks();
});

const setOnLine = (value) => {
  Object.defineProperty(global.navigator, 'onLine', { value, configurable: true });
};

describe('업로드 실패 분류', () => {
  it('서버가 답하면 server — 사유를 그대로 올린다(원격 /tmp 가 찼다 등)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({ detail: 'SFTP upload failed: Failure' }),
    });
    await expect(uploadImageAndGetPath(blob(), 'host-1')).rejects.toMatchObject({
      kind: 'server', message: 'SFTP upload failed: Failure',
    });
  });

  it('네트워크에서 죽고 health 도 죽으면 blocked — 재시도하지 않는다', async () => {
    setOnLine(true);
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/health')) return Promise.reject(new TypeError('failed'));
      return Promise.reject(new TypeError('failed'));
    });
    global.fetch = fetchMock;
    await expect(uploadImageAndGetPath(blob(), null)).rejects.toMatchObject({ kind: 'blocked' });
    // 업로드 1번 + health 1번. 예전에는 여기서 업로드를 한 번 더 쏴 20초를 더 태웠다.
    const uploads = fetchMock.mock.calls.filter((c) => String(c[0]).includes('paste-image'));
    expect(uploads).toHaveLength(1);
  });

  it('네트워크에서 죽었지만 health 가 살아 있으면 한 번은 다시 시도한다', async () => {
    setOnLine(true);
    let uploads = 0;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/health')) return Promise.resolve({ ok: true });
      uploads += 1;
      if (uploads === 1) return Promise.reject(new TypeError('one-off'));
      return Promise.resolve({ ok: true, json: async () => ({ path: '/tmp/x.webp' }) });
    });
    // tokens 는 예상 청구량 — 디코드가 안 되면 0 이 아니라 null(모름) 이다.
    await expect(uploadImageAndGetPath(blob(), null))
      .resolves.toEqual({ path: '/tmp/x.webp', tokens: null });
    expect(uploads).toBe(2);
  });

  it('오프라인이면 프로브도 걸지 않는다 — 물어볼 필요가 없다', async () => {
    setOnLine(false);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('failed'));
    global.fetch = fetchMock;
    await expect(uploadImageAndGetPath(blob(), null)).rejects.toMatchObject({ kind: 'offline' });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/health'))).toHaveLength(0);
  });

  it('UploadError 는 kind 를 갖는다 — 호출부의 분기 근거다', () => {
    const e = new UploadError('blocked', 'x', 'TypeError');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('blocked');
    expect(e.detail).toBe('TypeError');
  });
});
