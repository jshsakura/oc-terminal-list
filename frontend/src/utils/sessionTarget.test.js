import { describe, it, expect } from 'vitest';
import {
  buildSshAddr, buildAttachCmd, buildSendCmd,
  formatServerAddr, formatSessionTarget, formatSessionTargetLabel,
} from './sessionTarget';

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

/* tmux `-t` 는 prefix/fnmatch 다 — 이름만 주면 다른 세션에 붙을 수 있다. `=` 로 정확
   일치를 강제하고, send-keys 는 **pane** 타깃이라 `=name` 만으로는 "can't find pane"
   이 난다(실측: display-message -t '=X' 의 #{pane_id} 는 빈 값, '=X:' 는 %31). */
describe('명령 형태 — 정확 일치 타깃', () => {
  it('attach 는 세션 타깃이라 =name 이면 된다', () => {
    expect(buildAttachCmd('abc', 'iterminallist-app'))
      .toBe("tmux -L iterminallist-app attach -t '=abc'");
  });

  it('소켓을 모르면 -L 없이 만든다(기본 소켓)', () => {
    expect(buildAttachCmd('abc')).toBe("tmux attach -t '=abc'");
  });

  it('send-keys 는 pane 타깃이라 =name: 이어야 한다', () => {
    expect(buildSendCmd('abc', 'sock')).toContain("send-keys -t '=abc:'");
    expect(buildSendCmd('abc', 'sock')).not.toContain("send-keys -t '=abc'");
  });

  /* 텍스트를 -l 없이 보내면 "Enter"·"C-c" 같은 단어가 키로 해석된다. 그래서 본문은
     -l 로, Enter 는 키로 따로 — 두 명령이고, `\;` 대신 `;` 라 ssh "…" 로 감싸도 그대로다. */
  it('본문은 -l, Enter 는 따로 — 그리고 ssh 로 감쌀 수 있게 ; 로 잇는다', () => {
    expect(buildSendCmd('abc', 'sock'))
      .toBe("tmux -L sock send-keys -t '=abc:' -l 'TEXT'; tmux -L sock send-keys -t '=abc:' Enter");
  });

  it('세션이 없으면 빈 문자열', () => {
    expect(buildAttachCmd('')).toBe('');
    expect(buildSendCmd('')).toBe('');
  });
});

describe('formatSessionTarget', () => {
  /* 받는 쪽은 다른 터미널의 LLM 이다 — **첫 단어가 정체를 말하고**, 이어지는 명령을 그대로
     실행할 수 있어야 한다. 예전 형식(`2.3  tmux:abc  /w`)은 우리 규칙을 아는 사람에게만
     뜻이 통했고, pane 번호는 pane 을 닫으면 밀려 가리키는 대상이 바뀌었다. */
  it('로컬 세션은 소켓까지 넣어 붙는 명령과 보내는 명령을 만든다', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc', socket: 'iterminallist-app' }))
      .toBe("tmux session 'abc' — reach it with tmux only (it is a terminal, not an agent channel)."
        + " attach: tmux -L iterminallist-app attach -t '=abc'"
        + " · send: tmux -L iterminallist-app send-keys -t '=abc:' -l 'TEXT';"
        + " tmux -L iterminallist-app send-keys -t '=abc:' Enter");
  });

  /* 받는 에이전트가 "session" 만 보고 자기 에이전트 채널부터 뒤지다 헤맸다 — 다른 하네스는
     그 채널에 안 보인다. 그래서 tmux 로만 닿는다고 문장으로 못 박는다. */
  it('tmux 로만 닿는다고 문장으로 말한다', () => {
    const out = formatSessionTarget({ tmuxSession: 'abc', socket: 'sock' });
    expect(out.startsWith("tmux session 'abc'")).toBe(true);
    expect(out).toContain('not an agent channel');
  });

  it('경로는 넣지 않는다 — 명령이 묻히고 알려주는 것도 없다', () => {
    const out = formatSessionTarget({
      server: 'a1-ubuntu', tmuxSession: 'abc', socket: 'sock', cwd: '/w',
    });
    expect(out).not.toContain('cwd');
    expect(out).not.toContain('/w');
  });

  it('원격은 ssh 를 거치고 우리 소켓 이름은 붙이지 않는다', () => {
    // 원격 세션은 그 머신의 tmux 다 — 우리 소켓 이름을 붙이면 없는 소켓을 가리킨다.
    const out = formatSessionTarget({
      server: 'pi@10.0.0.5', tmuxSession: 'mobile-xx',
      socket: 'iterminallist-app', remote: true,
    });
    expect(out).toBe("tmux session 'mobile-xx' on pi@10.0.0.5"
      + ' — reach it with tmux over ssh only (it is a terminal, not an agent channel).'
      + ' attach: ssh pi@10.0.0.5 -t "tmux attach -t \'=mobile-xx\'"'
      + ' · send: ssh pi@10.0.0.5 "tmux send-keys -t \'=mobile-xx:\' -l \'TEXT\';'
      + ' tmux send-keys -t \'=mobile-xx:\' Enter"');
    expect(out).not.toContain('iterminallist-app');
  });

  /* ssh "…" 안에 들어가는 명령은 전부 홑따옴표만 쓴다 — 겹따옴표가 섞이면 그 자리에서 닫힌다. */
  it('원격 명령의 겹따옴표는 바깥 한 쌍뿐이다', () => {
    const out = formatSessionTarget({
      server: 'pi@10.0.0.5', tmuxSession: 'mobile-xx', remote: true,
    });
    expect((out.match(/"/g) || []).length).toBe(4);
  });

  it('pane 번호는 넣지 않는다 — 이 앱 밖에서는 가리키는 게 없다', () => {
    expect(formatSessionTarget({ address: '2.3', tmuxSession: 'abc' })).not.toContain('2.3');
  });

  it('세션이 없으면 호스트라도 말한다', () => {
    expect(formatSessionTarget({ server: 'ubuntu@nas' })).toBe('host ubuntu@nas');
  });

  it('아무것도 없으면 빈 문자열', () => {
    expect(formatSessionTarget({})).toBe('');
    expect(formatSessionTarget()).toBe('');
  });
});

describe('formatServerAddr — 로컬 세션이 어느 기계인지', () => {
  it('테일스케일이면 IP 에 tailscale 을 명시한다', () => {
    expect(formatServerAddr({ hostname: 'a1-ubuntu', ip: '100.109.62.68', ipKind: 'tailscale' }))
      .toBe('a1-ubuntu 100.109.62.68 (tailscale)');
  });

  /* 두 주소는 바꿔 쓸 수 없다 — tailnet 주소는 어디서든, LAN 주소는 같은 망에서만 닿는다.
     받는 쪽이 그 차이를 모르면 안 되는 곳에서 붙게 된다. */
  it('LAN 이면 lan 으로 구분한다', () => {
    expect(formatServerAddr({ hostname: 'a1-ubuntu', ip: '192.168.0.5', ipKind: 'lan' }))
      .toBe('a1-ubuntu 192.168.0.5 (lan)');
  });

  it('아는 것만 넣는다 — IP 를 못 구해도 호스트명은 남긴다', () => {
    expect(formatServerAddr({ hostname: 'a1-ubuntu' })).toBe('a1-ubuntu');
    expect(formatServerAddr({ ip: '10.0.0.2' })).toBe('10.0.0.2');
    expect(formatServerAddr({})).toBe('');
    expect(formatServerAddr()).toBe('');
  });
});

describe('로컬 세션 핸들에 기계 주소', () => {
  it('주소를 붙이되 ssh 로 감싸지는 않는다 (로그인 유저를 모른다)', () => {
    const out = formatSessionTarget({
      server: 'a1-ubuntu 100.109.62.68 (tailscale)',
      tmuxSession: 'abc', socket: 'iterminallist-app',
    });
    expect(out).toContain("tmux session 'abc' on a1-ubuntu 100.109.62.68 (tailscale)");
    expect(out).not.toContain('ssh ');
  });

  it('주소를 못 구하면 예전처럼 주소 없이 낸다', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc', socket: 'sock' }))
      .toContain("tmux session 'abc' — ");
  });
});

describe('formatSessionTargetLabel', () => {
  it('is just the session name — the toast says what was copied, not the command', () => {
    expect(formatSessionTargetLabel({ server: 'pi@10.0.0.5', tmuxSession: 'mobile-8db1f9a' }))
      .toBe('mobile-8db1f9a');
  });

  it('falls back to the address when there is no session', () => {
    expect(formatSessionTargetLabel({ server: 'pi@10.0.0.5' })).toBe('pi@10.0.0.5');
  });

  it('is empty when there is nothing to name', () => {
    expect(formatSessionTargetLabel({})).toBe('');
  });
});
