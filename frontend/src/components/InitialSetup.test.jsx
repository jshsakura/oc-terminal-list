import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InitialSetup from './InitialSetup';

const getField = (name) => screen.getByPlaceholderText(name);

describe('InitialSetup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders setup form with heading and submit button', () => {
    render(<InitialSetup onComplete={vi.fn()} language="en" />);
    expect(screen.getByText('System Initialization')).toBeInTheDocument();
    expect(screen.getByText('Create your admin account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Initialize Admin/i })).toBeInTheDocument();
  });

  it('shows validation error when username is too short', async () => {
    render(<InitialSetup onComplete={vi.fn()} language="en" />);

    fireEvent.change(getField('Admin username'), { target: { value: 'ab' } });
    fireEvent.change(getField('Secure password'), { target: { value: 'longpassword' } });
    fireEvent.change(getField('Match password'), { target: { value: 'longpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /Initialize Admin/i }));

    const errors = screen.getAllByText(/Min 3/i);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('shows error when passwords do not match', async () => {
    render(<InitialSetup onComplete={vi.fn()} language="en" />);

    fireEvent.change(getField('Admin username'), { target: { value: 'admin' } });
    fireEvent.change(getField('Secure password'), { target: { value: 'password1' } });
    fireEvent.change(getField('Match password'), { target: { value: 'password2' } });
    fireEvent.click(screen.getByRole('button', { name: /Initialize Admin/i }));

    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    });
  });

  it('calls onComplete on successful setup', async () => {
    const onComplete = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'token123' }),
    }));

    render(<InitialSetup onComplete={onComplete} language="en" />);

    fireEvent.change(getField('Admin username'), { target: { value: 'admin' } });
    fireEvent.change(getField('Secure password'), { target: { value: 'longpassword' } });
    fireEvent.change(getField('Match password'), { target: { value: 'longpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /Initialize Admin/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
    expect(fetch).toHaveBeenCalledWith('/api/auth/setup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'longpassword' }),
    }));
  });

  it('shows server error on failed setup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'Username already exists' }),
    }));

    render(<InitialSetup onComplete={vi.fn()} language="en" />);

    fireEvent.change(getField('Admin username'), { target: { value: 'admin' } });
    fireEvent.change(getField('Secure password'), { target: { value: 'longpassword' } });
    fireEvent.change(getField('Match password'), { target: { value: 'longpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /Initialize Admin/i }));

    await waitFor(() => {
      expect(screen.getByText(/Username already exists/i)).toBeInTheDocument();
    });
  });

  it('renders with Korean locale', () => {
    render(<InitialSetup onComplete={vi.fn()} language="ko" />);
    expect(screen.getByText('시스템 초기화')).toBeInTheDocument();
    expect(screen.getByText('관리자 계정 만들기')).toBeInTheDocument();
  });

  it('has dot pattern background', () => {
    const { container } = render(<InitialSetup onComplete={vi.fn()} language="en" />);
    const overlay = container.firstChild;
    expect(overlay).toBeTruthy();
    const dotsDiv = overlay.querySelector('[style*="radial-gradient"]');
    expect(dotsDiv).toBeTruthy();
  });

  it('has card with side margins', () => {
    const { container } = render(<InitialSetup onComplete={vi.fn()} language="en" />);
    const card = container.querySelector('[style*="calc(100% - 40px)"]');
    expect(card).toBeTruthy();
  });

  it('disables submit button while loading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));

    render(<InitialSetup onComplete={vi.fn()} language="en" />);

    fireEvent.change(getField('Admin username'), { target: { value: 'admin' } });
    fireEvent.change(getField('Secure password'), { target: { value: 'longpassword' } });
    fireEvent.change(getField('Match password'), { target: { value: 'longpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /Initialize Admin/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Provisioning/i })).toBeDisabled();
    });
  });
});
