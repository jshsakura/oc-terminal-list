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
  it('접속주소 + tmux 세션', () => {
    expect(formatSessionTarget({ server: 'term.example.com', tmuxSession: 'abc-123' }))
      .toBe('term.example.com  tmux:abc-123');
  });
  it('세션만 있으면 세션만', () => {
    expect(formatSessionTarget({ tmuxSession: 'abc' })).toBe('tmux:abc');
  });
  it('서버만 있으면 서버만', () => {
    expect(formatSessionTarget({ server: 'ubuntu@nas' })).toBe('ubuntu@nas');
  });
  it('둘 다 없으면 빈 문자열', () => {
    expect(formatSessionTarget({})).toBe('');
    expect(formatSessionTarget()).toBe('');
  });
});
