import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useAuth from './useAuth';
import { clearAuthFallbacks, redirectToAccessLogout } from '../utils/auth';

vi.mock('../utils/auth', async (original) => ({
  ...(await original()), redirectToAccessLogout: vi.fn(),
}));

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('external authentication', () => {
  beforeEach(() => { clearAuthFallbacks(); vi.mocked(redirectToAccessLogout).mockClear(); });

  it('skips setup and password login when Access verifies the administrator', async () => {
    global.fetch = vi.fn(async url => url === '/api/auth/status'
      ? reply({ setup_complete: true, auth_mode: 'cloudflare_access' })
      : reply({ username: 'existing-admin', valid: true }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.needsSetup).toBe(false);
    expect(result.current.username).toBe('existing-admin');
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/auth/status', '/api/auth/verify']);
    await act(async () => { await result.current.logout(); });
    expect(redirectToAccessLogout).toHaveBeenCalledOnce();
  });

  it('returns to Access rather than local setup when its initial assertion is denied', async () => {
    global.fetch = vi.fn(async () => reply({ auth_mode: 'cloudflare_access' }, 401));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(redirectToAccessLogout).toHaveBeenCalledOnce());
    expect(result.current.needsSetup).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses Access logout when a running session expires', async () => {
    global.fetch = vi.fn(async url => url === '/api/auth/status'
      ? reply({ setup_complete: true, auth_mode: 'cloudflare_access' })
      : reply({ username: 'existing-admin', valid: true }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    act(() => { window.dispatchEvent(new CustomEvent('auth:session-expired')); });
    await waitFor(() => expect(redirectToAccessLogout).toHaveBeenCalledOnce());
  });

  it('keeps ordinary first-run setup when Access is not configured', async () => {
    global.fetch = vi.fn(async () => reply({ setup_complete: false }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.needsSetup).toBe(true));
    expect(result.current.isAuthenticated).toBe(false);
    expect(redirectToAccessLogout).not.toHaveBeenCalled();
  });
});
