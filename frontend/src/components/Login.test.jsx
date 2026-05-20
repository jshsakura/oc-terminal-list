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

  it('submits a complete OTP code and finishes with the cookie-backed session', async () => {
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

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('admin', 'access-token'));
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/login/otp', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ pending_token: 'pending-token', code: '123456', is_backup_code: false }),
    }));
  });

  it('toggles password visibility on the credentials step', () => {
    render(<Login onLogin={vi.fn()} language="en" />);

    const passwordInput = screen.getByLabelText(/Key/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /^Show$/i }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: /^Hide$/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('remembers the username only when the checkbox is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-token', username: 'admin' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Login onLogin={vi.fn()} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByLabelText(/Remember username/i));
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    await waitFor(() => expect(localStorage.getItem('iterm:login:remember-username')).toBe('admin'));
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

    const heading = screen.getByText('Terminal List');
    expect(heading.closest('[style]')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/아이디/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/비밀번호/i), { target: { value: 'secret-pass' } });
    const submitBtn = screen.getByRole('button', { name: /인증하기/i });
    expect(submitBtn).toHaveStyle({ background: '#00aaff' });
    fireEvent.click(submitBtn);

    await screen.findByText('2단계 인증');
    expect(screen.getByText('인증 앱의 6자리 코드를 입력하세요.')).toBeInTheDocument();
  });
});

describe('Login paste button', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows paste button on OTP field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ otp_required: true, pending_token: 'pt', username: 'admin' }),
    }));

    render(<Login onLogin={vi.fn()} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    await screen.findByLabelText(/Verification code/i);

    const pasteBtn = screen.getByLabelText('Paste from clipboard');
    expect(pasteBtn).toBeTruthy();
  });

  it('pastes clipboard text into OTP field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ otp_required: true, pending_token: 'pt', username: 'admin' }),
    }));
    vi.stubGlobal('navigator', {
      clipboard: { readText: vi.fn().mockResolvedValue('654321') },
    });

    render(<Login onLogin={vi.fn()} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    const codeInput = await screen.findByLabelText(/Verification code/i);
    const pasteBtn = screen.getByLabelText('Paste from clipboard');
    fireEvent.click(pasteBtn);

    await waitFor(() => {
      expect(codeInput).toHaveValue('654321');
    });
  });
});

describe('Login shake animation on error', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows shake animation on error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'Invalid credentials' }),
    }));

    render(<Login onLogin={vi.fn()} language="en" />);

    fireEvent.change(screen.getByLabelText(/ID/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    const errorEl = await screen.findByText(/Invalid credentials/i);
    expect(errorEl.style.animation).toContain('login-shake');
  });
});

describe('Login dot pattern and card styling', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('has dot pattern background', () => {
    const { container } = render(<Login onLogin={vi.fn()} language="en" />);
    const overlay = container.firstChild;
    const dotsDiv = overlay?.children?.[0];
    expect(dotsDiv).toBeTruthy();
    expect(dotsDiv.style.backgroundImage || dotsDiv.style.cssText).toBeTruthy();
  });

  it('has card with side margins and max-width', () => {
    const { container } = render(<Login onLogin={vi.fn()} language="en" />);
    const card = container.querySelector('[style*="calc(100% - 40px)"]');
    expect(card).toBeTruthy();
  });

  it('has scrollable container with hidden scrollbar class', () => {
    const { container } = render(<Login onLogin={vi.fn()} language="en" />);
    const scrollEl = container.querySelector('.login-scroll');
    expect(scrollEl).toBeTruthy();
  });

  it('keeps real form padding inside the card', () => {
    const { container } = render(<Login onLogin={vi.fn()} language="en" />);
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    expect(form.style.padding).toBe('32px 28px 28px');
    expect(form.style.padding).not.toContain('undefined');
  });
});
