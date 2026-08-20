/**
 * 막힌 업로드는 붙잡고 다시 시도한다 — 사용자의 이미지를 잃지 않기 위해.
 *
 * 실제 사고(2026-08-20): 원격 pane 에 이미지를 붙여넣었는데 실패했다. 서버·터널 어디에도
 * 요청 흔적이 없었고(공유 HTTP/2 연결이 막혀 나가질 못했다), 그 순간 blob 이 그대로
 * 버려져 사용자가 다시 복사해 오는 수밖에 없었다. 새로고침하니 같은 이미지가 10초 만에
 * 올라갔다 — 파일도 호스트도 멀쩡했다는 뜻이다.
 */
import { describe, it, expect, vi } from 'vitest';
import { uploadWithRetry, RETRY_DELAYS_MS } from './uploadRetry';

const blocked = () => Object.assign(new Error('blocked'), { kind: 'blocked' });
const serverErr = () => Object.assign(new Error('nope'), { kind: 'server' });

const fast = [1, 1, 1];

describe('uploadWithRetry', () => {
  it('막힌 뒤에 살아나면 사용자는 이미지를 잃지 않는다', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(blocked())
      .mockRejectedValueOnce(blocked())
      .mockResolvedValue({ path: '/tmp/x.webp' });
    const states = [];
    const out = await uploadWithRetry({
      attempt, onState: (s) => states.push(s), delays: fast,
    });
    expect(out).toEqual({ path: '/tmp/x.webp' });
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(states).toContain('retrying');
    expect(states.at(-1)).toBe('done');
  });

  it('서버가 거절한 것은 붙잡지 않는다 — 다시 보내도 같은 답이다', async () => {
    // 원격 /tmp 가 찼는데 60초를 더 두드리는 건 사용자 시간만 버리는 짓이다.
    const attempt = vi.fn().mockRejectedValue(serverErr());
    const states = [];
    const out = await uploadWithRetry({ attempt, onState: (s) => states.push(s), delays: fast });
    expect(out).toBeNull();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('error');
  });

  it('끝내 막혀 있으면 blocked 로 끝난다 — 영영 재시도하지 않는다', async () => {
    const attempt = vi.fn().mockRejectedValue(blocked());
    const states = [];
    const out = await uploadWithRetry({ attempt, onState: (s) => states.push(s), delays: fast });
    expect(out).toBeNull();
    expect(attempt).toHaveBeenCalledTimes(fast.length + 1);
    expect(states.at(-1)).toBe('blocked');
  });

  it('대상이 사라졌으면 즉시 그만둔다', async () => {
    const attempt = vi.fn().mockRejectedValue(blocked());
    const out = await uploadWithRetry({
      attempt, onState: () => {}, delays: fast, isStale: () => true,
    });
    expect(out).toBeNull();
    expect(attempt).not.toHaveBeenCalled();
  });

  it('기본 사다리는 유한하고 오름차순이다', () => {
    expect(RETRY_DELAYS_MS.length).toBeGreaterThan(0);
    expect(RETRY_DELAYS_MS.length).toBeLessThanOrEqual(6);
    const sorted = [...RETRY_DELAYS_MS].sort((a, b) => a - b);
    expect(RETRY_DELAYS_MS).toEqual(sorted);
    // 총 대기가 1분을 크게 넘으면 그건 재시도가 아니라 방치다.
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60000);
  });
});
