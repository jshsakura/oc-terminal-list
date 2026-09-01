import { describe, it, expect } from 'vitest';
import { buildItlHandle, itlHandleLabel, clampTail, TEXT_PLACEHOLDER } from './itlHandle';

describe('buildItlHandle', () => {
  /* 이 한 줄이 이 기능의 전부다: 받는 에이전트가 **붙여넣은 그대로** 돌릴 수 있어야 한다. */
  it('명령으로 시작한다 — 산문으로 읽히면 안 된다', () => {
    const out = buildItlHandle({ addr: '1.2' });
    expect(out.startsWith('itl send 1.2 ')).toBe(true);
    expect(out).toContain(`'${TEXT_PLACEHOLDER}'`);
  });

  it('나머지는 전부 # 뒤로 간다', () => {
    const out = buildItlHandle({ addr: '1.2', server: 'ubuntu-lab', cwd: '/home/j/workspace/sn-ninja' });
    const [command, note] = out.split('  # ');
    expect(command).toBe(`itl send 1.2 '${TEXT_PLACEHOLDER}'`);
    expect(note).toBe('ubuntu-lab · /home/j/workspace/sn-ninja');
  });

  /* 소켓 이름·멀티플렉서 종류·ssh 주소는 옛 핸들의 짐이었다. itl 이 알아서 풀므로
     여기 실을 이유가 없고, 실으면 그만큼 주석이 줄바꿈돼 아무도 안 읽는다. */
  it('tmux·herdr·ssh 같은 구현 세부를 싣지 않는다', () => {
    const out = buildItlHandle({ addr: '2.1', server: 'rpi5', cwd: '/home/pi' });
    for (const noise of ['tmux', 'herdr', 'ssh', 'attach', 'send-keys', '-L ']) {
      expect(out).not.toContain(noise);
    }
  });

  it('주소가 없으면 핸들도 없다 — 틀린 주소를 건네느니 안 건넨다', () => {
    expect(buildItlHandle({ addr: '' })).toBe('');
    expect(buildItlHandle({ addr: '   ' })).toBe('');
    expect(buildItlHandle({})).toBe('');
    expect(buildItlHandle()).toBe('');
  });

  it('부가 정보가 없으면 주석도 안 붙인다', () => {
    expect(buildItlHandle({ addr: '1.1' })).toBe(`itl send 1.1 '${TEXT_PLACEHOLDER}'`);
  });

  it('긴 경로는 꼬리를 남긴다 — 식별하는 부분이 거기다', () => {
    const long = '/home/jshsakura/workspace/very/deeply/nested/project/that/keeps/going/src';
    const out = buildItlHandle({ addr: '1.2', cwd: long });
    expect(out).toContain('…');
    expect(out).toContain('src');            // 꼬리는 살아 있다
    expect(out.split('  # ')[1].length).toBeLessThanOrEqual(46);
  });
});

describe('clampTail', () => {
  it('짧으면 그대로', () => {
    expect(clampTail('/a/b', 46)).toBe('/a/b');
  });
  it('빈 값은 빈 값', () => {
    expect(clampTail(null)).toBe('');
    expect(clampTail(undefined)).toBe('');
  });
});

describe('itlHandleLabel', () => {
  /* 토스트에 긴 줄을 그대로 다시 띄우면 폰 화면 절반이 글자로 덮인다. */
  it('무엇을 복사했는지만 짧게', () => {
    expect(itlHandleLabel({ addr: '1.2', server: 'ubuntu-lab' })).toBe('1.2 · ubuntu-lab');
    expect(itlHandleLabel({ addr: '1.2' })).toBe('1.2');
    expect(itlHandleLabel({})).toBe('');
  });
});
