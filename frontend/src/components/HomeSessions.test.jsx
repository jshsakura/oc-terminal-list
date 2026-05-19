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
    render(
      <HomeSessions
        hosts={[{ id: 'h1', name: 'prod', use_remote_tmux: true }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Scanning hosts...')).toBeTruthy();
    });
  });
});
