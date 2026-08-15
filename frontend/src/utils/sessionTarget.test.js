import { describe, it, expect } from 'vitest';
import {
  buildSshAddr, buildSshCmd, buildAttachCmd,
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

/* 주소는 보여주는 것이고 ssh 는 실행되는 것이다 — 둘을 같은 문자열로 쓰면 깨진다. */
describe('buildSshCmd — 그 호스트로 실제로 들어가는 줄', () => {
  it('비표준 포트는 -p 로 간다 (user@host:2222 는 호스트명으로 읽힌다)', () => {
    const host = { ssh_user: 'pi', hostname: 'box.local', port: 2222 };
    expect(buildSshCmd(host)).toBe('ssh -p 2222 pi@box.local');
    expect(buildSshCmd(host)).not.toContain(':2222');
  });

  it('22 포트는 아무것도 붙이지 않는다', () => {
    expect(buildSshCmd({ ssh_user: 'pi', hostname: '10.0.0.5', port: 22 })).toBe('ssh pi@10.0.0.5');
  });

  it('tty 를 요구하면 -t 를 붙인다', () => {
    expect(buildSshCmd({ ssh_user: 'pi', hostname: 'nas' }, { tty: true })).toBe('ssh -t pi@nas');
  });

  /* tailscale 호스트는 우리 ssh 자격증명이 없다 — host_manager 가 `tailscale ssh` 로 띄운다.
     plain ssh 줄을 주면 받는 쪽이 열쇠 없는 문을 두드리게 된다. */
  it('tailscale 인증 호스트는 tailscale ssh 다', () => {
    expect(buildSshCmd({ ssh_user: 'ubuntu', hostname: 'a1', auth_method: 'tailscale' }, { tty: true }))
      .toBe('tailscale ssh -t ubuntu@a1');
  });

  it('tailscale 에는 -p 가 의미 없다 — 붙이지 않는다', () => {
    expect(buildSshCmd({ ssh_user: 'ubuntu', hostname: 'a1', auth_method: 'tailscale', port: 2222 }))
      .toBe('tailscale ssh ubuntu@a1');
  });

  it('호스트가 없거나 이름이 없으면 빈 문자열', () => {
    expect(buildSshCmd(null)).toBe('');
    expect(buildSshCmd({ ssh_user: 'x' })).toBe('');
  });
});

/* `-t name` 은 prefix/fnmatch 라 다른 세션에 붙을 수 있다 → `=` 로 정확 일치.
   그리고 send-keys 는 **pane** 타깃이라 `=name` 은 "can't find pane" 이다 — 뒤의 콜론이
   같은 문자열을 attach 와 send-keys 양쪽에서 쓰게 해 준다(실측: '=X' 의 #{pane_id} 는
   빈 값, '=X:' 는 %31, attach -t '=X:' 도 해석된다). 핸들이 명령 하나로 끝나는 근거다. */
describe('buildAttachCmd — 정확 일치 + 두 명령 공용 타깃', () => {
  it('소켓과 정확 일치 타깃을 넣는다', () => {
    expect(buildAttachCmd('abc', 'iterminallist-app'))
      .toBe("tmux -L iterminallist-app attach -t '=abc:'");
  });

  it('소켓을 모르면 -L 없이(기본 소켓)', () => {
    expect(buildAttachCmd('abc')).toBe("tmux attach -t '=abc:'");
  });

  it('타깃은 send-keys 에 그대로 쓸 수 있는 형태여야 한다', () => {
    expect(buildAttachCmd('abc', 'sock')).toContain("'=abc:'");
  });

  it('세션이 없으면 빈 문자열', () => {
    expect(buildAttachCmd('')).toBe('');
  });
});

describe('formatSessionTarget — 줄 자체가 명령이다', () => {
  /* 받는 쪽은 다른 터미널의 LLM 이다. 문장으로 설명하면 산문으로 읽고 자기 에이전트 채널부터
     뒤진다(다른 하네스는 거기 안 보인다). `tmux` 로 시작하는 줄은 오해할 수가 없다. */
  it('로컬은 tmux 명령으로 시작하고 나머지는 주석이다', () => {
    expect(formatSessionTarget({
      server: 'a1-ubuntu 100.109.62.68 (tailscale)',
      tmuxSession: 'abc', socket: 'iterminallist-app',
    })).toBe("tmux -L iterminallist-app attach -t '=abc:'"
      + "  # a1-ubuntu 100.109.62.68 (tailscale) · type: send-keys -l 'TEXT' then Enter");
  });

  it('주소를 못 구해도 명령은 온전하다', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc', socket: 'sock' }))
      .toBe("tmux -L sock attach -t '=abc:'  # type: send-keys -l 'TEXT' then Enter");
  });

  /* -l 없이 보내면 "Enter"·"C-c" 같은 단어가 키로 해석된다 — 그래서 힌트에 남긴다. */
  it('입력 방법은 -l 까지 말한다', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc' })).toContain("send-keys -l 'TEXT' then Enter");
  });

  it('경로도 pane 번호도 넣지 않는다 — 프롬프트에 이미 있고, 밖에선 가리키는 게 없다', () => {
    const out = formatSessionTarget({
      server: 'a1-ubuntu', tmuxSession: 'abc', socket: 'sock', cwd: '/w', address: '2.3',
    });
    expect(out).not.toContain('/w');
    expect(out).not.toContain('cwd');
    expect(out).not.toContain('2.3');
  });

  it('원격은 ssh 로 감싸고 우리 소켓 이름은 붙이지 않는다', () => {
    // 원격 세션은 그 머신의 tmux 다 — 우리 소켓 이름을 붙이면 없는 소켓을 가리킨다.
    const out = formatSessionTarget({
      server: 'pi@10.0.0.5', tmuxSession: 'mobile-xx', socket: 'iterminallist-app',
      host: { ssh_user: 'pi', hostname: '10.0.0.5', port: 22 }, remote: true,
    });
    expect(out).toBe('ssh -t pi@10.0.0.5 "tmux attach -t \'=mobile-xx:\'"'
      + "  # type: send-keys -l 'TEXT' then Enter");
    expect(out).not.toContain('iterminallist-app');
  });

  /* ssh "…" 안은 홑따옴표만 쓴다 — 겹따옴표가 섞이면 그 자리에서 닫힌다. */
  it('원격 명령의 겹따옴표는 바깥 한 쌍뿐이다', () => {
    const out = formatSessionTarget({
      server: 'pi@10.0.0.5', tmuxSession: 'mobile-xx', remote: true,
    });
    expect((out.match(/"/g) || []).length).toBe(2);
  });

  it('원격 비표준 포트는 -p 로 나간다', () => {
    const out = formatSessionTarget({
      server: 'pi@box.local:2222', tmuxSession: 'mobile',
      host: { ssh_user: 'pi', hostname: 'box.local', port: 2222 }, remote: true,
    });
    expect(out.startsWith('ssh -p 2222 -t pi@box.local "tmux attach')).toBe(true);
    // 주소 표기(user@host:2222)가 명령으로 새어 나가면 붙을 수 없는 줄이 된다.
    expect(out).not.toContain('box.local:2222');
  });

  it('tailscale 호스트는 tailscale ssh 로 나간다', () => {
    expect(formatSessionTarget({
      server: 'ubuntu@a1', tmuxSession: 'mobile',
      host: { ssh_user: 'ubuntu', hostname: 'a1', auth_method: 'tailscale' }, remote: true,
    }).startsWith('tailscale ssh -t ubuntu@a1 "tmux attach')).toBe(true);
  });

  it('호스트 레코드가 없으면 주소로 폴백한다', () => {
    expect(formatSessionTarget({ server: 'pi@10.0.0.5', tmuxSession: 'm', remote: true }))
      .toBe('ssh -t pi@10.0.0.5 "tmux attach -t \'=m:\'"  # type: send-keys -l \'TEXT\' then Enter');
  });

  /* use_remote_tmux 가 꺼진 호스트에는 붙을 세션이 없다 — 그러면 들어가는 줄이라도 준다. */
  it('tmux 를 안 쓰는 호스트는 ssh 줄을 준다', () => {
    expect(formatSessionTarget({
      server: 'ubuntu@nas', host: { ssh_user: 'ubuntu', hostname: 'nas', port: 2222 },
    })).toBe('ssh -p 2222 -t ubuntu@nas  # no tmux session on this host');
  });

  it('세션도 호스트 레코드도 없으면 주소라도 말한다', () => {
    expect(formatSessionTarget({ server: 'ubuntu@nas' })).toBe('host ubuntu@nas');
  });

  it('아무것도 없으면 빈 문자열', () => {
    expect(formatSessionTarget({})).toBe('');
    expect(formatSessionTarget()).toBe('');
  });

  /* 한눈에 들어와야 한다 — 예전 두 명령짜리 문장형은 300자를 넘겨 명령이 묻혔다. */
  it('한 줄로 짧게 유지한다', () => {
    const out = formatSessionTarget({
      server: 'a1-ubuntu 100.109.62.68 (tailscale)',
      tmuxSession: '46aca893-d0d6-4803-ba34-485055b4f922', socket: 'iterminallist-app',
    });
    expect(out.length).toBeLessThan(180);
    expect(out.split('\n')).toHaveLength(1);
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
