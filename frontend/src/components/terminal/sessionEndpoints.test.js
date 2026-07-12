import { describe, it, expect } from 'vitest';
import { buildWsUrl, wsPathFor } from './sessionEndpoints';

// WS URL 은 백엔드와의 계약이다 — 조용히 틀어지면 "연결은 되는데 엉뚱한 세션" 이 된다.
const base = {
  origin: 'wss://example.com',
  ticket: 'tkt',
  sessionId: 'sess1',
  cols: 100,
  rows: 30,
  clientId: 'client-9',
};

const query = (url) => new URL(url).searchParams;

describe('buildWsUrl', () => {
  it('로컬 세션은 /ws/<sessionId> 에 셸을 실어 연결한다', () => {
    const url = buildWsUrl({ ...base, shell: 'zsh' });

    expect(url.startsWith('wss://example.com/ws/sess1?')).toBe(true);
    const q = query(url);
    expect(q.get('ticket')).toBe('tkt');
    expect(q.get('cols')).toBe('100');
    expect(q.get('rows')).toBe('30');
    expect(q.get('shell')).toBe('zsh');
    expect(q.get('client_id')).toBe('client-9');
  });

  it('호스트 세션은 /ws/host/<hostId> 로 가고 셸은 싣지 않는다', () => {
    // 원격 셸은 호스트 설정이 정한다 — 로컬 defaultShell 을 보내면 안 된다.
    const url = buildWsUrl({ ...base, hostId: 'h1', shell: 'zsh' });

    expect(url.startsWith('wss://example.com/ws/host/h1?')).toBe(true);
    expect(query(url).get('shell')).toBeNull();
  });

  it('명시적 tmux 세션명을 그대로 넘긴다 (Home 의 이어하기)', () => {
    const url = buildWsUrl({ ...base, hostId: 'h1', tmuxSessionName: 'my work' });
    expect(query(url).get('tmux_session_name')).toBe('my work');
  });

  it('탭별 tmux suffix 를 넘긴다', () => {
    const url = buildWsUrl({ ...base, hostId: 'h1', tmuxSuffix: 'tab2' });
    expect(query(url).get('tmux_suffix')).toBe('tab2');
  });

  it('tmux 관련 파라미터는 호스트 세션에만 붙는다', () => {
    const url = buildWsUrl({ ...base, tmuxSuffix: 'tab2', tmuxSessionName: 'work', paneIndex: 3 });
    const q = query(url);
    expect(q.get('tmux_suffix')).toBeNull();
    expect(q.get('tmux_session_name')).toBeNull();
    expect(q.get('pane_index')).toBeNull();
  });

  it('paneIndex 는 0 이면 생략한다', () => {
    expect(query(buildWsUrl({ ...base, hostId: 'h1', paneIndex: 0 })).get('pane_index')).toBeNull();
    expect(query(buildWsUrl({ ...base, hostId: 'h1', paneIndex: 2 })).get('pane_index')).toBe('2');
  });

  it('공백·슬래시가 든 cwd 를 안전하게 인코딩한다', () => {
    const url = buildWsUrl({ ...base, cwd: '/home/me/my dir' });
    expect(url).not.toContain(' ');
    expect(query(url).get('cwd')).toBe('/home/me/my dir');
  });

  it('cwd 가 없으면 아예 안 붙인다', () => {
    expect(query(buildWsUrl({ ...base, cwd: null })).get('cwd')).toBeNull();
  });

  // create=0 = "없으면 만들지 말고 실패하라". 기존 셸에만 재연결할 때 쓴다 —
  // 이게 빠지면 재연결이 조용히 새 셸을 만들어 사용자의 작업이 사라진 것처럼 보인다.
  it('createIfMissing=false 일 때만 create=0 을 붙인다', () => {
    expect(query(buildWsUrl({ ...base, createIfMissing: false })).get('create')).toBe('0');
    expect(query(buildWsUrl({ ...base, createIfMissing: true })).get('create')).toBeNull();
  });

  it('티켓의 특수문자를 인코딩한다', () => {
    const url = buildWsUrl({ ...base, ticket: 'a+b/c=d' });
    expect(query(url).get('ticket')).toBe('a+b/c=d');
  });
});

describe('wsPathFor', () => {
  it('티켓 발급 경로가 실제 연결 경로와 같다', () => {
    // 다르면 서버가 발급한 티켓의 스코프가 안 맞아 연결이 거부된다.
    expect(wsPathFor({ sessionId: 's1' })).toBe('/ws/s1');
    expect(wsPathFor({ sessionId: 's1', hostId: 'h1' })).toBe('/ws/host/h1');

    const url = buildWsUrl({ ...base, hostId: 'h1' });
    expect(new URL(url).pathname).toBe(wsPathFor({ sessionId: base.sessionId, hostId: 'h1' }));
  });
});
