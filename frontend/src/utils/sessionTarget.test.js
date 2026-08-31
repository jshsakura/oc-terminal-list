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

  /* ⚠️ 여기서 규칙이 한 번 뒤집혔다. 예전에는 경로를 뺐다 — **붙는 사람**은 프롬프트에서
     읽으니까. 그런데 이 줄의 용도는 붙는 것이 아니라 **넘기는 것**이고, 넘겨받은 쪽은
     그 프롬프트를 영영 보지 않는다(실제로 자기 체크아웃에서 시작했다가 멈췄다).
     pane 번호는 여전히 뺀다 — 이 앱 안에서만 뜻이 있고 pane 이 닫히면 밀린다. */
  it('경로는 넣고 pane 번호는 넣지 않는다', () => {
    const out = formatSessionTarget({
      server: 'a1-ubuntu', tmuxSession: 'abc', socket: 'sock', cwd: '/w', address: '2.3',
    });
    expect(out).toContain('/w');
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

  /* 실제로 밟은 것: `ssh -t jshsakura@100.115.177.3` 가 Permission denied 로 막혔고,
     받는 쪽이 자기 ~/.ssh/config 를 뒤져 별칭 `ubuntu-lab` 을 찾아서야 들어갔다.
     그 이름은 우리 호스트 레코드에 이미 있다 — 알려주면 첫 시도에 끝난다. */
  it('호스트 이름을 같이 알려준다 — 받는 쪽 ssh 별칭이 그 이름인 경우가 많다', () => {
    const out = formatSessionTarget({
      server: 'jshsakura@100.115.177.3', tmuxSession: 'mobile-1ea43f8888f1', remote: true,
      host: { name: 'ubuntu-lab', ssh_user: 'jshsakura', hostname: '100.115.177.3' },
    });
    expect(out).toContain('ssh -t jshsakura@100.115.177.3 "tmux attach');
    expect(out).toContain('host "ubuntu-lab"');
  });

  it('이름이 이미 명령에 들어 있으면 중복해서 말하지 않는다', () => {
    const out = formatSessionTarget({
      server: 'pi@nas', tmuxSession: 'mobile', remote: true,
      host: { name: 'nas', ssh_user: 'pi', hostname: 'nas' },
    });
    expect(out).not.toContain('host "nas"');
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

/* 받는 에이전트가 **일을 시작하는 데** 필요한 것만 주석에 싣는다 — 어느 기계, 어느
   트리, 뭐가 돌고 있나. 실제로 이게 없어서 받은 에이전트가 자기 체크아웃에서 시작했다가
   아무것도 못 찾고 멈췄다. */
describe('붙는 줄 — 그대로 붙여넣으면 도는 명령', () => {
  it('로컬 — 기계·경로·돌고 있는 것을 싣는다', () => {
    expect(formatSessionTarget({
      server: 'a1-ubuntu', tmuxSession: 'abc', socket: 'sock',
      cwd: '/home/ubuntu/work/retro-go', agent: 'claude ◐ Cx4 포팅',
    })).toBe("tmux -L sock attach -t '=abc:'"
      + '  # a1-ubuntu · /home/ubuntu/work/retro-go · claude ◐ Cx4 포팅'
      + " · type: send-keys -l 'TEXT' then Enter");
  });

  it('⚠️ 소켓은 선택이 아니다 — 우리 세션은 전용 소켓에 산다', () => {
    const out = formatSessionTarget({ tmuxSession: 'abc', socket: 'sock' });
    expect(out).toContain('-L sock');
  });

  it('원격은 ssh 로 감싼다 — 그 세션은 그쪽 기본 소켓에 있다', () => {
    const out = formatSessionTarget({
      server: 'jshsakura@100.115.177.3', tmuxSession: 'mobile-1ea43f8888f1', remote: true,
      host: { name: 'ubuntu-lab', ssh_user: 'jshsakura', hostname: '100.115.177.3' },
      cwd: '/home/jshsakura/workspace/retro-go',
    });
    expect(out).toContain('ssh -t jshsakura@100.115.177.3');
    expect(out).toContain("tmux attach -t '=mobile-1ea43f8888f1:'");
    expect(out).toContain('/home/jshsakura/workspace/retro-go');
    expect(out).not.toContain('-L ');          // 우리 소켓은 그 기계에 없다
  });

  it('긴 경로는 뒤를, 긴 제목은 앞을 남긴다 — 줄바꿈되면 아무도 안 읽는다', () => {
    const out = formatSessionTarget({
      server: 'a1', tmuxSession: 'abc', socket: 'sock',
      cwd: '/very/deep/path/that/keeps/going/and/going/until/nobody/reads/it/project',
      agent: `claude ${'가'.repeat(80)}`,
    });
    expect(out).toContain('· …');
    expect(out).toContain('/nobody/reads/it/project ·');
    expect(out).toContain('claude 가');
    expect(out.length).toBeLessThan(250);
  });

  it('주소는 세션 이름이다 — pane 을 닫아도 밀리지 않는다', () => {
    const out = formatSessionTarget({ tmuxSession: 'abc', socket: 'sock' });
    expect(out).toContain("'=abc:'");
    expect(out).not.toMatch(/\d+\.\d+/);
  });

  it('맥락이 없으면 타이핑 힌트를 남긴다 — 빈 주석은 줄만 차지한다', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc', socket: 'sock' }))
      .toBe("tmux -L sock attach -t '=abc:'  # type: send-keys -l 'TEXT' then Enter");
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
