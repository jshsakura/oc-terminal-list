import { describe, it, expect } from 'vitest';
import { deriveTabAgentStatus, isNotableAgentStatus } from './tabAgentStatus';

const tab = (...sessionIds) => ({ panes: sessionIds.map((sessionId) => ({ sessionId })) });

describe('deriveTabAgentStatus', () => {
  it('단일 pane 상태를 그대로 쓴다', () => {
    expect(deriveTabAgentStatus(tab('a'), { a: { status: 'working' } })).toBe('working');
  });

  it('permission 이 working 을 이긴다 — 손이 필요한 쪽이 우선', () => {
    const map = { a: { status: 'working' }, b: { status: 'permission' } };
    expect(deriveTabAgentStatus(tab('a', 'b'), map)).toBe('permission');
    expect(deriveTabAgentStatus(tab('b', 'a'), map)).toBe('permission');
  });

  it('working 이 idle 을 이긴다', () => {
    expect(deriveTabAgentStatus(tab('a', 'b'), {
      a: { status: 'idle' }, b: { status: 'working' },
    })).toBe('working');
  });

  it('에이전트가 없으면 null', () => {
    expect(deriveTabAgentStatus(tab('a'), { a: { status: null } })).toBe(null);
    expect(deriveTabAgentStatus(tab('a'), {})).toBe(null);
  });

  it('빈 입력에 터지지 않는다', () => {
    expect(deriveTabAgentStatus(null, {})).toBe(null);
    expect(deriveTabAgentStatus(tab(), {})).toBe(null);
    expect(deriveTabAgentStatus({ panes: [null] }, {})).toBe(null);
  });
});

describe('isNotableAgentStatus', () => {
  it('idle 은 뱃지를 띄우지 않는다 — 상시 점은 노이즈다', () => {
    expect(isNotableAgentStatus('idle')).toBe(false);
    expect(isNotableAgentStatus(null)).toBe(false);
  });

  it('working / permission 만 띄운다', () => {
    expect(isNotableAgentStatus('working')).toBe(true);
    expect(isNotableAgentStatus('permission')).toBe(true);
  });
});
