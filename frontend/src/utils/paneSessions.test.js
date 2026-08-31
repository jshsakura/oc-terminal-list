import { describe, it, expect } from 'vitest';
import { collectOtherPaneSessions } from './paneSessions';

// 탭/pane 최소 모형 — key 규칙만 실제 App 과 같다: local 은 sessionId, host 는 pane.id.
const makeTabs = () => [
  {
    id: 'tab-a',
    name: 'work',
    panes: [
      { id: 'p1', mode: 'terminal', sessionId: 'sess1' },            // 로컬
      { id: 'p2', mode: 'terminal', sessionId: 'sess2' },            // 로컬 2
      { id: 'p3', mode: 'terminal' },                                 // 빈 pane
      { id: 'p4', mode: 'vnc', hostId: 'h1', display: 1 },            // VNC
    ],
  },
  {
    id: 'tab-b',
    name: 'server',
    panes: [
      { id: 'p5', mode: 'terminal', hostId: 'h1', tmuxSessionName: 'mobile-1' },
      { id: 'p6', mode: 'editor' },                                   // editor pane
    ],
  },
];

describe('collectOtherPaneSessions', () => {
  it('다른 살아있는 세션만 나열한다 — 키는 sessionId || pane.id', () => {
    const out = collectOtherPaneSessions(makeTabs(), { excludePaneId: 'p1', excludeKey: 'sess1' });
    expect(out.map((s) => s.key)).toEqual(['sess2', 'p5']);
  });

  it('sessionKey 는 백엔드가 아는 신원 — 로컬은 sessionId, 원격은 tmux 세션명', () => {
    /* `key` 는 이 브라우저 안에서만 통하는 값이다(원격이면 프론트 pane id). 백엔드로
       명령을 보낼 때 그걸 주소로 쓰면 서버가 못 찾는다 — 백엔드는 sessionId /
       tmuxSessionName 정확일치로 신원을 찾는다. */
    const out = collectOtherPaneSessions(makeTabs(), { excludePaneId: 'p1', excludeKey: 'sess1' });
    expect(out.map((s) => [s.key, s.sessionKey])).toEqual([
      ['sess2', 'sess2'],
      ['p5', 'mobile-1'],
    ]);
  });

  it('현재 pane 의 세션 키를 가진 다른 pane 도 제외한다 — 자기 히스토리에서 고를 이유가 없다', () => {
    const tabs = [{ id: 't', name: 't', panes: [
      { id: 'p1', mode: 'terminal', sessionId: 'sess1' },
      { id: 'p2', mode: 'terminal', sessionId: 'sess1' },
      { id: 'p3', mode: 'terminal', sessionId: 'sess2' },
    ] }];
    const out = collectOtherPaneSessions(tabs, { excludePaneId: 'p1', excludeKey: 'sess1' });
    expect(out.map((s) => s.key)).toEqual(['sess2']);
  });

  it('같은 세션 키가 여러 pane 에 붙으면 하나만 나온다', () => {
    const tabs = [{ id: 't', name: 't', panes: [
      { id: 'pz', mode: 'terminal', sessionId: 'sess9' },
      { id: 'p1', mode: 'terminal', sessionId: 'sess1' },
      { id: 'p2', mode: 'terminal', sessionId: 'sess1' },
    ] }];
    const out = collectOtherPaneSessions(tabs, { excludePaneId: 'pz', excludeKey: 'sess9' });
    expect(out.filter((s) => s.key === 'sess1')).toHaveLength(1);
  });

  it('라벨은 derivePaneLabel 과 같은 규칙 — 호스트명/This machine 폴백', () => {
    const hosts = [{ id: 'h1', name: 'nas' }];
    const out = collectOtherPaneSessions(makeTabs(), {
      excludePaneId: 'p1', excludeKey: 'sess1', hosts, settings: {}, t: (k) => (k === 'thisMachine' ? 'This machine' : k),
    });
    expect(out.find((s) => s.key === 'p5').label).toBe('nas');
    expect(out.find((s) => s.key === 'sess2').label).toBe('This machine');
    expect(out.find((s) => s.key === 'p5').isLocal).toBe(false);
    expect(out.find((s) => s.key === 'sess2').isLocal).toBe(true);
  });

  it('같은 라벨이 여럿이면 tab 이름으로 구분할 수 있게 표시된다', () => {
    const tabs = [
      { id: 't1', name: 'alpha', panes: [{ id: 'p1', mode: 'terminal', sessionId: 's1' }] },
      { id: 't2', name: 'beta', panes: [{ id: 'p2', mode: 'terminal', sessionId: 's2' }] },
      { id: 't3', name: 'gamma', panes: [{ id: 'p3', mode: 'terminal', hostId: 'h1' }] },
    ];
    const out = collectOtherPaneSessions(tabs, {
      excludePaneId: 'p3', excludeKey: 'p3',
      hosts: [{ id: 'h1', name: 'nas' }], settings: {}, t: (k) => (k === 'thisMachine' ? 'This machine' : k),
    });
    // s1/s2 둘 다 "This machine" — 중복. nas 는 유일.
    expect(out.find((s) => s.key === 's1').labelDuplicated).toBe(true);
    expect(out.find((s) => s.key === 's2').labelDuplicated).toBe(true);
    expect(out.find((s) => s.key === 'p1' || s.key === 's1').tabName).toBe('alpha');
  });

  it('빈 배열/undefined 탭 목록도 안전하다', () => {
    expect(collectOtherPaneSessions([], { excludePaneId: 'x', excludeKey: 'y' })).toEqual([]);
    expect(collectOtherPaneSessions(undefined, {})).toEqual([]);
  });

  it('cwd 는 pane 것을 우선하고 없으면 탭의 것 — 중복 라벨 식별 맥락', () => {
    const tabs = [
      { id: 't1', name: 'alpha', cwd: '/home/u/tab-fallback', panes: [
        { id: 'p1', mode: 'terminal', sessionId: 's1' },
        { id: 'p2', mode: 'terminal', sessionId: 's2', cwd: '/home/u/proj-b/' },
      ] },
    ];
    const out = collectOtherPaneSessions(tabs, { excludePaneId: 'pz', excludeKey: 'pz' });
    expect(out.find((s) => s.key === 's1').cwd).toBe('/home/u/tab-fallback');
    expect(out.find((s) => s.key === 's2').cwd).toBe('/home/u/proj-b');
  });

  it('cwd 가 어디에도 없으면 빈 문자열', () => {
    const tabs = [{ id: 't', name: 't', panes: [{ id: 'p1', mode: 'terminal', sessionId: 's1' }] }];
    const out = collectOtherPaneSessions(tabs, { excludePaneId: 'x', excludeKey: 'x' });
    expect(out[0].cwd).toBe('');
  });

  it('tabIndex/paneIndex/address 는 원본 순번(1-based) — 빈 pane 등을 건너뛰어도 순번은 그대로', () => {
    // makeTabs 의 sess2 는 tab-a 의 두번째 pane(p2) — p3(빈)/p4(vnc) 는 목록에서 빠지지만
    // 순번은 배열 위치를 따르므로 화면의 pane 배치와 일치한다. address 는 pane 주소
    // 체계(tabIdx.paneIdx)와 같은 형식이라 탭이 몇 개든 항상 유일하다.
    const out = collectOtherPaneSessions(makeTabs(), { excludePaneId: 'p1', excludeKey: 'sess1' });
    expect(out.find((s) => s.key === 'sess2').paneIndex).toBe(2);
    expect(out.find((s) => s.key === 'p5').paneIndex).toBe(1);
    expect(out.find((s) => s.key === 'sess2')).toMatchObject({ tabIndex: 1, address: '1.2' });
    expect(out.find((s) => s.key === 'p5')).toMatchObject({ tabIndex: 2, address: '2.1' });
  });
});
