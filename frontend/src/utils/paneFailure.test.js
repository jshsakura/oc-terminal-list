import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  reportPaneFailure, clearPaneFailure, deriveTabFailure,
  subscribePaneFailure, getPaneFailureSnapshot,
} from './paneFailure';

/**
 * 실패 카드는 **그 pane 을 보고 있을 때만** 보인다. 다른 탭에서 일하는 동안 호스트가
 * 죽으면 그 탭을 열기 전까지 아무 표시가 없었다 — 이 스토어가 그 사실을 탭 바로 올린다.
 *
 * 여기서 잠그는 것 둘: ① pane 이 사라지면 경고도 사라진다(안 그러면 영원히 남는다)
 * ② 같은 사유의 재보고는 리렌더를 만들지 않는다(실패는 재시도 주기마다 다시 보고된다).
 */
describe('paneFailure 스토어', () => {
  beforeEach(() => {
    for (const id of Object.keys(getPaneFailureSnapshot())) clearPaneFailure(id);
  });

  it('실패를 기록하고 해제한다', () => {
    reportPaneFailure('s1', '연결 실패: 응답 없음');
    expect(getPaneFailureSnapshot().s1.detail).toBe('연결 실패: 응답 없음');

    reportPaneFailure('s1', '');
    expect(getPaneFailureSnapshot().s1).toBeUndefined();
  });

  it('같은 사유를 다시 보고해도 구독자를 깨우지 않는다', () => {
    const seen = vi.fn();
    const stop = subscribePaneFailure(seen);

    reportPaneFailure('s1', '같은 사유');
    expect(seen).toHaveBeenCalledTimes(1);

    // 재시도 사다리(4→8→16→30s)가 돌 때마다 같은 사유가 다시 올라온다.
    reportPaneFailure('s1', '같은 사유');
    reportPaneFailure('s1', '같은 사유');
    expect(seen).toHaveBeenCalledTimes(1);

    // 사유가 바뀌면 그건 새 정보다.
    reportPaneFailure('s1', '다른 사유');
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });

  it('없는 세션을 해제해도 구독자를 깨우지 않는다', () => {
    const seen = vi.fn();
    const stop = subscribePaneFailure(seen);
    clearPaneFailure('없는세션');
    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it('sessionId 가 없으면 아무것도 안 한다', () => {
    reportPaneFailure('', '사유');
    reportPaneFailure(null, '사유');
    expect(Object.keys(getPaneFailureSnapshot())).toHaveLength(0);
  });
});

describe('deriveTabFailure — 탭 하나로 접기', () => {
  const tab = (...sessionIds) => ({ panes: sessionIds.map((sessionId) => ({ sessionId })) });

  it('실패한 pane 이 없으면 null', () => {
    expect(deriveTabFailure(tab('s1', 's2'), {})).toBeNull();
  });

  it('첫 사유와 **개수**를 함께 준다', () => {
    const map = { s1: { detail: '사유 A' }, s3: { detail: '사유 B' } };
    expect(deriveTabFailure(tab('s1', 's2', 's3'), map)).toEqual({ detail: '사유 A', count: 2 });
  });

  it('다른 탭의 실패는 세지 않는다', () => {
    const map = { other: { detail: '남의 탭' } };
    expect(deriveTabFailure(tab('s1'), map)).toBeNull();
  });

  it('인자가 없으면 null (렌더 중 호출돼도 안전하게)', () => {
    expect(deriveTabFailure(null, {})).toBeNull();
    expect(deriveTabFailure(tab('s1'), null)).toBeNull();
    expect(deriveTabFailure({}, {})).toBeNull();
  });
});
