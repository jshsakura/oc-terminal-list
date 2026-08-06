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
