import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HomeSessions from './HomeSessions';

describe('HomeSessions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    localStorage.setItem('auth_token', 'token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('keeps a resumable placeholder card visible while sessions are loading', async () => {
    /* 자리를 비워두면 카드가 나중에 툭 떨어져 "방금 생긴 것" 처럼 보인다. 문구가 아니라
       **자리(aria-busy)** 를 확인한다 — 스피너에서 스켈레톤으로 바뀌어도 계약은 같다. */
    const { container } = render(
      <HomeSessions
        hosts={[{ id: 'h1', name: 'prod', use_remote_tmux: true }]}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
  });
});


/* ⚠️ 실측 사고. 붙어 있는 세션을 "이어할 수 있는" 으로 내밀면 사용자는 그걸 지우려 하고,
   지워지지 않는다 — 붙어 있는 쪽이 끊긴 것을 보고 곧바로 다시 만든다(재접속이 create=1).
   화면에서는 "지워도 새로고침하면 다시 뜬다" 로 보인다. */
describe('이어할 수 있는 세션 — 쓰는 중인 것은 빼고', () => {
  const src = readFileSync(resolve(__dirname, 'HomeSessions.jsx'), 'utf8');

  test('붙어 있는 세션은 목록에서 빠진다', () => {
    const at = src.indexOf('const resumable = entry.sessions.filter(');
    const block = src.slice(at, at + 260);
    expect(block).toMatch(/!s\.attached/);
  });

  test('구획 표시 여부도 같은 기준을 쓴다 — 안 그러면 빈 구획이 남는다', () => {
    const at = src.indexOf('const hasAnyResumable');
    const block = src.slice(at, at + 320);
    expect(block).toMatch(/!s\.attached/);
  });
});
