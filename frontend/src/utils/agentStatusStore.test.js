import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  reportTerminalTitle,
  applyAgentStatusChanges,
  hydrateAgentStatus,
  forgetAgentStatus,
  subscribeAgentStatus,
  getAgentStatusSnapshot,
  _resetAgentStatus,
} from './agentStatusStore';

beforeEach(() => _resetAgentStatus());

describe('xterm 타이틀 관측', () => {
  it('상태와 표시용 타이틀을 세운다', () => {
    reportTerminalTitle('s1', '⠂ 폴더 로더 수정');
    expect(getAgentStatusSnapshot().s1).toMatchObject({
      status: 'working',
      title: '폴더 로더 수정',
    });
  });

  it('스피너 프레임만 바뀌면 리렌더를 유발하지 않는다', () => {
    const listener = vi.fn();
    subscribeAgentStatus(listener);

    reportTerminalTitle('s1', '⠂ 폴더 로더 수정');
    expect(listener).toHaveBeenCalledTimes(1);

    // 초당 10~12회 들어오는 프레임들 — 전부 흡수돼야 한다.
    reportTerminalTitle('s1', '⠴ 폴더 로더 수정');
    reportTerminalTitle('s1', '⣾ 폴더 로더 수정');
    reportTerminalTitle('s1', '⠋ 폴더 로더 수정');
    expect(listener).toHaveBeenCalledTimes(1);

    // 작업 내용이 바뀌면 그건 진짜 변경이다.
    reportTerminalTitle('s1', '⠴ 다른 작업');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('working → idle 전이를 잡는다', () => {
    reportTerminalTitle('s1', '⠂ 작업중');
    reportTerminalTitle('s1', '✳ 작업중');
    expect(getAgentStatusSnapshot().s1.status).toBe('idle');
  });

  it('평범한 셸 타이틀은 상태가 없다', () => {
    reportTerminalTitle('s1', '~/app/front');
    expect(getAgentStatusSnapshot().s1.status).toBe(null);
  });

  it('sessionId 가 없으면 무시한다', () => {
    reportTerminalTitle(null, '⠂ 작업중');
    expect(getAgentStatusSnapshot()).toEqual({});
  });
});

describe('백엔드 SSE 변경분', () => {
  it('적용된다', () => {
    applyAgentStatusChanges([
      { sessionId: 's1', status: 'working', title: '작업중', rawTitle: '⠂ 작업중' },
    ]);
    expect(getAgentStatusSnapshot().s1.status).toBe('working');
  });

  it('gone 이면 지운다 — 죽은 세션이 영원히 working 으로 남으면 안 된다', () => {
    reportTerminalTitle('s1', '⠂ 작업중');
    applyAgentStatusChanges([{ sessionId: 's1', gone: true }]);
    expect(getAgentStatusSnapshot().s1).toBeUndefined();
  });

  it('같은 내용이면 리렌더하지 않는다', () => {
    const listener = vi.fn();
    reportTerminalTitle('s1', '⠂ 작업중');
    subscribeAgentStatus(listener);
    applyAgentStatusChanges([
      { sessionId: 's1', status: 'working', title: '작업중', rawTitle: '⠂ 작업중' },
    ]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('빈 배열/비배열은 무시한다', () => {
    const listener = vi.fn();
    subscribeAgentStatus(listener);
    applyAgentStatusChanges([]);
    applyAgentStatusChanges(null);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('하이드레이션', () => {
  it('비어 있으면 스냅샷으로 채운다', () => {
    hydrateAgentStatus({ s1: { status: 'idle', title: '대기', command: 'claude' } });
    expect(getAgentStatusSnapshot().s1.status).toBe('idle');
  });

  it('라이브 관측이 이미 있으면 덮어쓰지 않는다', () => {
    // 폴링 스냅샷은 최대 5s 뒤처질 수 있다 — 방금 본 걸 되돌리면 안 된다.
    reportTerminalTitle('s1', '✳ 방금 끝남');
    hydrateAgentStatus({ s1: { status: 'working', title: '낡은 상태' } });
    expect(getAgentStatusSnapshot().s1.status).toBe('idle');
  });
});

describe('구독 해제', () => {
  it('unsubscribe 후엔 안 불린다', () => {
    const listener = vi.fn();
    const off = subscribeAgentStatus(listener);
    off();
    reportTerminalTitle('s1', '⠂ 작업중');
    expect(listener).not.toHaveBeenCalled();
  });

  it('forgetAgentStatus 로 지운다', () => {
    reportTerminalTitle('s1', '⠂ 작업중');
    forgetAgentStatus('s1');
    expect(getAgentStatusSnapshot().s1).toBeUndefined();
  });
});
