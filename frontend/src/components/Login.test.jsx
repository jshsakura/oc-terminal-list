import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from './Login';

describe('Login MFA flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the password after the first factor requires OTP and when going back', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ otp_required: true, pending_token: 'pending-token', username: 'admin' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Login onLogin={vi.fn()} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    await screen.findByText(/Two-factor authentication/i);
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));

    expect(screen.getByLabelText(/Key/i)).toHaveValue('');
  });

  it('blocks incomplete authenticator codes before calling the OTP endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ otp_required: true, pending_token: 'pending-token', username: 'admin' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Login onLogin={vi.fn()} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    const codeInput = await screen.findByLabelText(/Verification code/i);
    fireEvent.change(codeInput, { target: { value: '12345' } });

    expect(screen.getByRole('button', { name: /Authorize/i })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits a complete OTP code and stores the issued access token', async () => {
    const onLogin = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ otp_required: true, pending_token: 'pending-token', username: 'admin' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-token', username: 'admin' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<Login onLogin={onLogin} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    const codeInput = await screen.findByLabelText(/Verification code/i);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('access-token', 'admin'));
    expect(localStorage.getItem('auth_token')).toBe('access-token');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/login/otp', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ pending_token: 'pending-token', code: '123456', is_backup_code: false }),
    }));
  });

  it('applies the selected theme and locale to the MFA login step', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ otp_required: true, pending_token: 'pending-token', username: 'admin' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Login
        onLogin={vi.fn()}
        language="ko"
        theme={{ background: '#222222', foreground: '#eeeeee', blue: '#00aaff', red: '#ff3366' }}
      />
    );

    const heading = screen.getByText('터미널 접속');
    expect(heading.closest('form')).toHaveStyle({ background: '#222222' });

    fireEvent.change(screen.getByLabelText(/아이디/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/비밀번호/i), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /인증하기/i }));

    await screen.findByText('2단계 인증');
    expect(screen.getByText('인증 앱의 6자리 코드를 입력하세요.')).toBeInTheDocument();
  });
});
