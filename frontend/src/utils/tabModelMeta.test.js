import { describe, it, expect } from 'vitest';
import { deriveTabMeta, tabCloseKeepsSession } from './tabModel';

// App.jsx 안에 있던 tabsWithMeta 파생 — 이제 순수 함수라 직접 검증한다.
// (App 은 렌더 테스트가 없어서, 여기서 안 잡으면 아무 데서도 안 잡힌다.)

const localTab = (extra = {}) => ({
  id: 't1', type: 'local', name: 'my-term', panes: [{ id: 'p1', sessionId: 's1' }], ...extra,
});
const hostTab = (extra = {}) => ({
  id: 't2', type: 'host', hostId: 'H', name: 'box',
  panes: [{ id: 'p1', hostId: 'H', sessionId: null }], ...extra,
});
const HOSTS = [{ id: 'H', name: 'RealBox', icon: 'srv', color_index: 5, use_remote_tmux: 1 }];

describe('deriveTabMeta — 공통 필드', () => {
  it('로컬 탭은 항상 영속(tmux 위)', () => {
    expect(deriveTabMeta(localTab(), {}).isPersistent).toBe(true);
  });

  it('use_remote_tmux 호스트는 영속, 아니면 비영속', () => {
    expect(deriveTabMeta(hostTab(), { hosts: HOSTS }).isPersistent).toBe(true);
    const noTmux = [{ id: 'H', name: 'x', use_remote_tmux: 0 }];
    expect(deriveTabMeta(hostTab(), { hosts: noTmux }).isPersistent).toBe(false);
  });

  it('agentStatus 는 계산하지 않고 인자로 받아 붙인다', () => {
    expect(deriveTabMeta(localTab(), { agentStatus: 'working' }).agentStatus).toBe('working');
    expect(deriveTabMeta(localTab(), {}).agentStatus).toBe(null);
  });
});

describe('deriveTabMeta — 이름/색은 활성 pane 정체성을 따라간다', () => {
  it('호스트 탭 이름·색은 그 호스트에서', () => {
    const meta = deriveTabMeta(hostTab(), { hosts: HOSTS });
    expect(meta.name).toBe('RealBox');
    expect(meta.color_index).toBe(5);
    expect(meta.primaryKind).toBe('host');
  });

  it('manualName 이 있으면 그게 최우선 — 호스트 이름이 덮지 않는다', () => {
    const meta = deriveTabMeta(hostTab({ manualName: true, name: '내가 지은 이름' }), { hosts: HOSTS });
    expect(meta.name).toBe('내가 지은 이름');
  });

  it('로컬 탭은 settings 의 로컬 아이콘/색 폴백', () => {
    const meta = deriveTabMeta(localTab(), { settings: { localIcon: 'term', localColorIndex: 3 } });
    expect(meta.primaryKind).toBe('local');
    expect(meta.color_index).toBe(3);
  });
});

describe('tabCloseKeepsSession', () => {
  it('로컬 pane 만 있으면 세션 유지(tmux)', () => {
    expect(tabCloseKeepsSession(localTab(), [])).toBe(true);
  });

  it('use_remote_tmux=0 호스트 pane 이 하나라도 있으면 유지 안 됨', () => {
    const tab = { panes: [{ hostId: 'H' }] };
    expect(tabCloseKeepsSession(tab, [{ id: 'H', use_remote_tmux: 0 }])).toBe(false);
    expect(tabCloseKeepsSession(tab, [{ id: 'H', use_remote_tmux: 1 }])).toBe(true);
  });

  it('빈 탭 안전', () => {
    expect(tabCloseKeepsSession(null, [])).toBe(true);
    expect(tabCloseKeepsSession({ panes: [] }, [])).toBe(true);
  });
});
