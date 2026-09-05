import { describe, it, expect } from 'vitest';
import { cleanLaunch, hasLaunchChoice, SHELL_CHOICES, INHERIT } from './launchOptions';

describe('cleanLaunch', () => {
  /* ⚠️ 안 고른 것은 **키가 없어야** 한다. 기본값을 문자열로 박으면 나중에 설정을 바꿔도
     옛 pane 이 안 따라온다 — 그게 "같은 결정이 두 자리에 생긴다" 의 실제 증상이다. */
  it('안 고르면 빈 객체다', () => {
    expect(cleanLaunch(null)).toEqual({});
    expect(cleanLaunch({})).toEqual({});
    expect(cleanLaunch({ multiplexer: INHERIT, shell: INHERIT })).toEqual({});
  });

  it('고른 것만 싣는다', () => {
    expect(cleanLaunch({ multiplexer: 'tmux', shell: INHERIT })).toEqual({ multiplexer: 'tmux' });
    expect(cleanLaunch({ multiplexer: INHERIT, shell: 'zsh' })).toEqual({ shell: 'zsh' });
    expect(cleanLaunch({ multiplexer: 'none', shell: 'sh' })).toEqual({ multiplexer: 'none', shell: 'sh' });
  });

  it('모르는 값은 버린다 — 탭 상태에 쓰레기를 저장하지 않는다', () => {
    expect(cleanLaunch({ multiplexer: '; rm -rf /', shell: '$(whoami)' })).toEqual({});
    expect(cleanLaunch({ multiplexer: 'fish' })).toEqual({});
    expect(cleanLaunch({ shell: 'bash; id' })).toEqual({});
  });

  it('문자열이 아닌 값도 버린다', () => {
    expect(cleanLaunch({ multiplexer: ['tmux'], shell: 3 })).toEqual({});
  });

  it('알려진 셸만 통과한다', () => {
    SHELL_CHOICES.forEach((sh) => expect(cleanLaunch({ shell: sh })).toEqual({ shell: sh }));
  });

  it('hasLaunchChoice 는 고른 게 있을 때만 참', () => {
    expect(hasLaunchChoice(null)).toBe(false);
    expect(hasLaunchChoice({ multiplexer: INHERIT })).toBe(false);
    expect(hasLaunchChoice({ multiplexer: 'tmux' })).toBe(true);
  });
});
