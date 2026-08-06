import { describe, it, expect } from 'vitest';
import { buildSshAddr, formatSessionTarget } from './sessionTarget';

describe('buildSshAddr', () => {
  it('user@host, 22 포트는 생략', () => {
    expect(buildSshAddr({ ssh_user: 'ubuntu', hostname: '10.0.0.5', port: 22 })).toBe('ubuntu@10.0.0.5');
  });
  it('비표준 포트는 붙인다', () => {
    expect(buildSshAddr({ ssh_user: 'root', hostname: 'box.local', port: 2222 })).toBe('root@box.local:2222');
  });
  it('user 없으면 host 만', () => {
    expect(buildSshAddr({ hostname: 'nas' })).toBe('nas');
  });
  it('hostname 없으면 name 폴백', () => {
    expect(buildSshAddr({ ssh_user: 'me', name: 'pve' })).toBe('me@pve');
  });
  it('빈/없음은 빈 문자열', () => {
    expect(buildSshAddr(null)).toBe('');
    expect(buildSshAddr({ ssh_user: 'x' })).toBe('');
  });
});

describe('formatSessionTarget', () => {
  /* 받는 쪽은 다른 터미널의 LLM 이다 — **첫 단어가 정체를 말하고**, 이어지는 명령을 그대로
     실행할 수 있어야 한다. 예전 형식(`2.3  tmux:abc  /w`)은 우리 규칙을 아는 사람에게만
     뜻이 통했고, pane 번호는 pane 을 닫으면 밀려 가리키는 대상이 바뀌었다. */
  it('로컬 세션은 소켓까지 넣어 붙는 명령을 만든다', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc', socket: 'iterminallist-app', cwd: '/w' }))
      .toBe("tmux session 'abc' — attach: tmux -L iterminallist-app attach -t abc  (cwd: /w)");
  });

  it('소켓을 모르면 -L 없이 만든다(기본 소켓)', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc' }))
      .toBe("tmux session 'abc' — attach: tmux attach -t abc");
  });

  it('원격은 ssh 를 거치고 우리 소켓 이름은 붙이지 않는다', () => {
    // 원격 세션은 그 머신의 tmux 다 — 우리 소켓 이름을 붙이면 없는 소켓을 가리킨다.
    expect(formatSessionTarget({
      server: 'pi@10.0.0.5', tmuxSession: 'mobile-xx', cwd: '/home/pi',
      socket: 'iterminallist-app', remote: true,
    })).toBe('tmux session \'mobile-xx\' on pi@10.0.0.5 — attach: ssh pi@10.0.0.5 -t "tmux attach -t mobile-xx"  (cwd: /home/pi)');
  });

  it('pane 번호는 넣지 않는다 — 이 앱 밖에서는 가리키는 게 없다', () => {
    expect(formatSessionTarget({ address: '2.3', tmuxSession: 'abc' })).not.toContain('2.3');
  });

  it('세션이 없으면 호스트라도 말한다', () => {
    expect(formatSessionTarget({ server: 'ubuntu@nas' })).toBe('host ubuntu@nas');
  });

  it('cwd 만 있어도 그것만', () => {
    expect(formatSessionTarget({ cwd: '/tmp' })).toBe('(cwd: /tmp)');
  });

  it('아무것도 없으면 빈 문자열', () => {
    expect(formatSessionTarget({})).toBe('');
    expect(formatSessionTarget()).toBe('');
  });
});
