import { describe, it, expect } from 'vitest';
import {
  splitPaneOp, dropTabToSplitPaneOp, activatePaneOp, reorderPaneOp, dropPaneToSplitOp,
  removePaneOp, planPaneClose, extractPaneToTabOp,
} from './tabOperations';

// 이 로직은 App.jsx 안에 있는 동안 테스트가 하나도 없었다. 순수 함수로 나온 김에
// 실제로 쓰이는 전이들을 고정해 둔다.

const pane = (id, extra = {}) => ({ id, mode: 'terminal', ...extra });
const tab = (id, panes, extra = {}) => ({
  id, type: 'local', panes, layout: panes.length > 1 ? 'h' : 'single',
  activePaneId: panes[0]?.id, ...extra,
});
const filled = (id, sessionId) => pane(id, { sessionId });

describe('splitPaneOp', () => {
  it('빈 pane 을 하나 붙이고 그걸 활성으로 만든다', () => {
    const [t] = splitPaneOp([tab('t1', [filled('p1', 's1')])], { dir: 'h', targetTabId: 't1' });
    expect(t.panes).toHaveLength(2);
    expect(t.activePaneId).toBe(t.panes[1].id);
    expect(t.panes[1].sessionId).toBeUndefined();   // picker pane 이라 비어 있어야 한다
  });

  it('활성 탭이 없으면 아무것도 안 한다', () => {
    const tabs = [tab('t1', [filled('p1', 's1')])];
    expect(splitPaneOp(tabs, { dir: 'h', targetTabId: null, activeTabId: null })).toBe(tabs);
  });

  it('targetTabId 가 없으면 activeTabId 로 떨어진다', () => {
    const [t] = splitPaneOp([tab('t1', [filled('p1', 's1')])], { dir: 'h', activeTabId: 't1' });
    expect(t.panes).toHaveLength(2);
  });

  it('2x2 는 4칸까지 채우고, 이미 4칸이면 더 늘리지 않는다', () => {
    const [t] = splitPaneOp([tab('t1', [filled('p1', 's1')])], { dir: '2x2', targetTabId: 't1' });
    expect(t.panes).toHaveLength(4);
    expect(t.layout).toBe('2x2');
    const [again] = splitPaneOp([t], { dir: '2x2', targetTabId: 't1' });
    expect(again.panes).toHaveLength(4);
  });

  it('대상이 아닌 탭은 건드리지 않는다', () => {
    const other = tab('t2', [filled('p9', 's9')]);
    const [, t2] = splitPaneOp([tab('t1', [filled('p1', 's1')]), other], { dir: 'h', targetTabId: 't1' });
    expect(t2).toBe(other);
  });
});

describe('reorderPaneOp', () => {
  it('두 pane 의 자리를 맞바꾼다', () => {
    const [t] = reorderPaneOp([tab('t1', [filled('a', 's1'), filled('b', 's2')])],
      { tabId: 't1', fromPaneId: 'a', toPaneId: 'b' });
    expect(t.panes.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('같은 pane 으로 떨구면 그대로 둔다', () => {
    const tabs = [tab('t1', [filled('a', 's1'), filled('b', 's2')])];
    expect(reorderPaneOp(tabs, { tabId: 't1', fromPaneId: 'a', toPaneId: 'a' })).toBe(tabs);
  });
});

describe('dropTabToSplitPaneOp', () => {
  const noSession = () => null;

  it('center 로 점유된 pane 에 떨구면 두 세션을 맞바꾼다', () => {
    const src = tab('src', [filled('sp', 'S')]);
    const dst = tab('dst', [filled('dp', 'D')]);
    const out = dropTabToSplitPaneOp([src, dst], {
      sourceTabId: 'src', targetTabId: 'dst', targetPaneId: 'dp', dir: 'center',
      hosts: [], computePaneTmuxSession: noSession,
    });
    const byId = Object.fromEntries(out.map((t) => [t.id, t]));
    expect(byId.dst.panes[0].sessionId).toBe('S');
    expect(byId.src.panes[0].sessionId).toBe('D');   // 교환이므로 원본도 채워져 있어야
  });

  it('center 로 빈 pane 에 떨구면 채우고 원본 탭은 사라진다', () => {
    const src = tab('src', [filled('sp', 'S')]);
    const dst = tab('dst', [pane('dp')]);            // 빈 picker pane
    const out = dropTabToSplitPaneOp([src, dst], {
      sourceTabId: 'src', targetTabId: 'dst', targetPaneId: 'dp', dir: 'center',
      hosts: [], computePaneTmuxSession: noSession,
    });
    expect(out.map((t) => t.id)).toEqual(['dst']);
    expect(out[0].panes[0].sessionId).toBe('S');
  });

  it('방향 드롭은 대상 pane 을 분할하고 새 자리에 원본을 넣는다', () => {
    const src = tab('src', [filled('sp', 'S')]);
    const dst = tab('dst', [filled('dp', 'D')]);
    const out = dropTabToSplitPaneOp([src, dst], {
      sourceTabId: 'src', targetTabId: 'dst', targetPaneId: 'dp', dir: 'right',
      hosts: [], computePaneTmuxSession: noSession,
    });
    const dstOut = out.find((t) => t.id === 'dst');
    expect(dstOut.panes).toHaveLength(2);
    expect(dstOut.panes.map((p) => p.sessionId)).toContain('S');
    expect(dstOut.panes.map((p) => p.sessionId)).toContain('D');
  });

  it('원본에 활성 pane 이 없으면 그 탭만 제거한다', () => {
    const out = dropTabToSplitPaneOp([tab('src', [pane('sp')]), tab('dst', [filled('dp', 'D')])], {
      sourceTabId: 'src', targetTabId: 'dst', targetPaneId: 'dp', dir: 'center',
      hosts: [], computePaneTmuxSession: noSession,
    });
    expect(out.map((t) => t.id)).toEqual(['dst']);
  });

  it('없는 탭이면 아무것도 안 한다', () => {
    const tabs = [tab('dst', [filled('dp', 'D')])];
    expect(dropTabToSplitPaneOp(tabs, {
      sourceTabId: 'nope', targetTabId: 'dst', targetPaneId: 'dp', dir: 'center',
      hosts: [], computePaneTmuxSession: noSession,
    })).toBe(tabs);
  });
});

describe('activatePaneOp', () => {
  it('로컬 target 이면 빈 pane 에 새 세션을 만든다', () => {
    const [t] = activatePaneOp([tab('t1', [pane('p1')])], {
      tabId: 't1', paneId: 'p1', target: { type: 'local' },
      hosts: [], settings: {}, computePaneTmuxSession: () => null,
    });
    expect(t.panes[0].sessionId).toBeTruthy();
    expect(t.panes[0].hostId).toBeFalsy();
  });

  it('host target 이면 그 호스트로 붙인다', () => {
    const hosts = [{ id: 'h1', name: 'box', theme: null }];
    const [t] = activatePaneOp([tab('t1', [pane('p1')], { type: 'host' })], {
      tabId: 't1', paneId: 'p1', target: { type: 'host', hostId: 'h1' },
      hosts, settings: {}, computePaneTmuxSession: () => null,
    });
    expect(t.panes[0].hostId).toBe('h1');
  });

  it("target={type:'tab'} 이면 원본 탭을 흡수하고 목록에서 지운다", () => {
    const src = tab('src', [filled('sp', 'S')]);
    const dst = tab('dst', [pane('dp')]);
    const out = activatePaneOp([src, dst], {
      tabId: 'dst', paneId: 'dp', target: { type: 'tab', sourceTabId: 'src' },
      hosts: [], settings: {}, computePaneTmuxSession: () => null,
    });
    expect(out.map((t) => t.id)).toEqual(['dst']);
    expect(out[0].panes[0].sessionId).toBe('S');
  });

  it('흡수하려는 원본이 없으면 그대로 둔다', () => {
    const tabs = [tab('dst', [pane('dp')])];
    expect(activatePaneOp(tabs, {
      tabId: 'dst', paneId: 'dp', target: { type: 'tab', sourceTabId: 'gone' },
      hosts: [], settings: {}, computePaneTmuxSession: () => null,
    })).toBe(tabs);
  });
});

describe('dropPaneToSplitOp', () => {
  it('같은 탭 안에서 pane 을 재배치한다', () => {
    const [t] = dropPaneToSplitOp([tab('t1', [filled('a', 's1'), filled('b', 's2')])],
      { tabId: 't1', srcPaneId: 'a', destPaneId: 'b', dir: 'right' });
    expect(t.panes.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('자기 자신 위로 떨구면 그대로 둔다', () => {
    const tabs = [tab('t1', [filled('a', 's1'), filled('b', 's2')])];
    expect(dropPaneToSplitOp(tabs, { tabId: 't1', srcPaneId: 'a', destPaneId: 'a', dir: 'right' })).toBe(tabs);
  });
});

describe('불변성 (CRITICAL)', () => {
  it('입력 tabs 배열과 그 안의 탭 객체를 제자리에서 고치지 않는다', () => {
    const original = tab('t1', [filled('p1', 's1')]);
    const snapshot = JSON.parse(JSON.stringify(original));
    splitPaneOp([original], { dir: 'h', targetTabId: 't1' });
    reorderPaneOp([original], { tabId: 't1', fromPaneId: 'p1', toPaneId: 'p1' });
    expect(original).toEqual(snapshot);
  });
});

describe('removePaneOp', () => {
  it('분할에서 pane 하나를 빼고 레이아웃을 좁힌다', () => {
    const [t] = removePaneOp([tab('t1', [filled('a', 's1'), filled('b', 's2')])],
      { tabId: 't1', paneId: 'a' });
    expect(t.panes.map((p) => p.id)).toEqual(['b']);
    expect(t.layout).toBe('single');
  });

  it('마지막 하나는 남긴다 — 빈 탭이 되면 안 된다(탭 닫기가 할 일)', () => {
    const tabs = [tab('t1', [filled('a', 's1')])];
    expect(removePaneOp(tabs, { tabId: 't1', paneId: 'a' })[0].panes).toHaveLength(1);
  });

  it('닫은 pane 이 활성이었으면 세션 있는 pane 으로 활성을 옮긴다', () => {
    const src = tab('t1', [filled('a', 's1'), pane('empty'), filled('c', 's3')]);
    src.activePaneId = 'a';
    const [t] = removePaneOp([src], { tabId: 't1', paneId: 'a' });
    expect(t.activePaneId).toBe('c');   // 빈 pane 이 아니라 세션 있는 쪽
  });

  it('탭 레벨 sessionId 의 주인을 닫으면 남은 로컬 pane 이 승계한다', () => {
    // 승계 안 하면 죽은 세션을 가리키는 탭을 서버 sanitize 가 지워 분할이 풀린다.
    const src = tab('t1', [filled('a', 's1'), filled('b', 's2')], { sessionId: 's1' });
    const [t] = removePaneOp([src], { tabId: 't1', paneId: 'a' });
    expect(t.sessionId).toBe('s2');
  });

  it('다른 탭은 건드리지 않는다', () => {
    const other = tab('t2', [filled('x', 's9')]);
    const [, t2] = removePaneOp([tab('t1', [filled('a', 's1'), filled('b', 's2')]), other],
      { tabId: 't1', paneId: 'a' });
    expect(t2).toBe(other);
  });
});

describe('planPaneClose', () => {
  const hosts = [{ id: 'h1', use_remote_tmux: 1 }, { id: 'h2', use_remote_tmux: 0 }];

  it('단일 pane 이면 탭 닫기로 위임한다', () => {
    expect(planPaneClose(tab('t1', [filled('a', 's1')]), 'a', hosts).action).toBe('delegateToTab');
    expect(planPaneClose(tab('t1', [pane('a')]), 'a', hosts).action).toBe('delegateToTab');
  });

  it('멀티 중 빈 pane 은 묻지 않고 제거한다', () => {
    expect(planPaneClose(tab('t1', [pane('a'), filled('b', 's2')]), 'a', hosts).action).toBe('immediate');
  });

  it('세션이 살아있으면 확인을 받는다 — 닫기 = 세션 종료', () => {
    const p = planPaneClose(tab('t1', [filled('a', 's1'), filled('b', 's2')]), 'a', hosts);
    expect(p.action).toBe('confirm');
    expect(p.paneIndex).toBe(0);
    expect(p.willPersist).toBe(true);    // 로컬은 항상 tmux 위
  });

  it('원격 tmux 를 끈 호스트는 willPersist=false (작업이 사라진다고 알려야 한다)', () => {
    const panes = [pane('a', { hostId: 'h2' }), filled('b', 's2')];
    expect(planPaneClose(tab('t1', panes), 'a', hosts).willPersist).toBe(false);
    const panes2 = [pane('a', { hostId: 'h1' }), filled('b', 's2')];
    expect(planPaneClose(tab('t1', panes2), 'a', hosts).willPersist).toBe(true);
  });

  it('없는 pane 이면 아무것도 안 한다', () => {
    expect(planPaneClose(tab('t1', [filled('a', 's1')]), 'nope', hosts).action).toBe('none');
    expect(planPaneClose(null, 'a', hosts).action).toBe('none');
  });
});

describe('extractPaneToTabOp', () => {
  it('pane 을 새 탭으로 떼고 원본에서 지운다', () => {
    const r = extractPaneToTabOp([tab('t1', [filled('a', 's1'), filled('b', 's2')])],
      { tabId: 't1', paneId: 'a', hosts: [], now: 111 });
    expect(r.tabs).toHaveLength(2);
    expect(r.tabs[0].panes.map((p) => p.id)).toEqual(['b']);
    expect(r.tabs[1].id).toBe(r.newTabId);
    expect(r.tabs[1].panes[0].sessionId).toBe('s1');
  });

  it('새 탭을 원본 바로 뒤에 끼워넣는다', () => {
    const r = extractPaneToTabOp(
      [tab('t0', [filled('z', 's0')]), tab('t1', [filled('a', 's1'), filled('b', 's2')]), tab('t2', [filled('y', 's9')])],
      { tabId: 't1', paneId: 'a', hosts: [], now: 111 });
    expect(r.tabs.map((t) => t.id)).toEqual(['t0', 't1', r.newTabId, 't2']);
  });

  it('새 탭 이름·색은 원본 탭이 아니라 pane 의 호스트를 따른다', () => {
    // 원본 것을 복사하면 pane 이 다른 호스트로 옮겨진 뒤 분리할 때 옛 이름이 따라온다.
    const hosts = [{ id: 'h1', name: 'realbox', icon: 'srv', color_index: 5 }];
    const panes = [pane('a', { hostId: 'h1', sessionId: 's1' }), filled('b', 's2')];
    const r = extractPaneToTabOp([tab('t1', panes, { name: '옛날이름', color_index: 2 })],
      { tabId: 't1', paneId: 'a', hosts, now: 111 });
    const created = r.tabs.find((t) => t.id === r.newTabId);
    expect(created.name).toBe('realbox');
    expect(created.color_index).toBe(5);
    expect(created.hostId).toBe('h1');
  });

  it('빈 pane 은 뗄 수 없다', () => {
    expect(extractPaneToTabOp([tab('t1', [pane('a'), filled('b', 's2')])],
      { tabId: 't1', paneId: 'a', hosts: [], now: 1 })).toBe(null);
  });

  it('없는 탭/pane 이면 null', () => {
    expect(extractPaneToTabOp([], { tabId: 'x', paneId: 'y', hosts: [], now: 1 })).toBe(null);
  });
});
