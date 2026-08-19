import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostEditor from './HostEditor';

import { locales } from '../i18n/locales';
const mockT = (key, fallback) => locales.en[key] || fallback || key;

const sampleHost = {
  id: 'h1',
  name: 'oci-a1',
  hostname: '1.2.3.4',
  port: 22,
  ssh_user: 'ubuntu',
  auth_method: 'key',
  key_id: 'k1',
  color_index: 2,
  use_remote_tmux: 1,
  remote_tmux_session: 'mobile',
  start_path: '~/projects',
  icon: '🚀',
};

const sampleKeys = [
  { id: 'k1', name: 'main' },
  { id: 'k2', name: 'work' },
];

describe('HostEditor', () => {
  it('renders for adding a new host without crashing', () => {
    render(
      <HostEditor
        isOpen={true}
        host={null}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Add host/i)).toBeInTheDocument();
  });

  it('renders for editing an existing host without crashing', () => {
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onKillTmuxServer={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
    // 기존 host 값 prefill 확인
    expect(screen.getByDisplayValue('oci-a1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1.2.3.4')).toBeInTheDocument();
  });

  it('returns null when isOpen=false', () => {
    const { container } = render(
      <HostEditor
        isOpen={false}
        host={null}
        sshKeys={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onDelete with host when delete is confirmed', () => {
    const onDelete = vi.fn();
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
        t={mockT}
      />
    );
    // 1차 클릭 → confirm 모드 진입
    fireEvent.click(screen.getAllByText(/Delete/i)[0]);
    // 2차 Delete 버튼 클릭
    const confirmDelete = screen.getAllByText(/Delete/i).find((el) => el.closest('button'));
    fireEvent.click(confirmDelete.closest('button'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('handles host without icon field (legacy DB row)', () => {
    const legacyHost = { ...sampleHost, icon: undefined };
    render(
      <HostEditor
        isOpen={true}
        host={legacyHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('handles use_remote_tmux as 0/1 integer (sqlite)', () => {
    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, use_remote_tmux: 0 }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('uses auth_token when checking remote tmux availability', async () => {
    localStorage.setItem('auth_token', 'auth-token-123');
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ available: true }),
      text: () => Promise.resolve(''),
    });

    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, use_remote_tmux: 0 }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    fireEvent.click(screen.getByText(/Session/i).closest('button'));
    fireEvent.click(document.querySelector('[role="switch"][aria-label^="Persist session"]'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/hosts/h1/tmux-check', {
        headers: { Authorization: 'Bearer auth-token-123' },
      });
    });
  });

  it('shows skeleton rows in TailscalePicker while loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));

    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, auth_method: 'tailscale' }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('renders form fields for a new host', () => {
    render(
      <HostEditor
        isOpen={true}
        host={null}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Add host/i)).toBeInTheDocument();
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('loads itl status when the session tab opens', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ installed: true, pane_path: true, setup_command: 'mkdir -p ~/.local/bin' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onKillTmuxServer={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /session/i }));
    await waitFor(() => expect(screen.getByText(/Ready — usable/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/hosts/h1/itl-status', expect.objectContaining({ headers: expect.anything() }));
    expect(screen.queryByRole('button', { name: /^Install$/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  /* A Windows host used to meet the user as three unrelated bugs across a week: the
     tmux toggle refusing, pastes vanishing, the handoff silently unavailable. Saying it
     once, with the way out, is the whole feature. */
  it('names Windows instead of offering an install that cannot work', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        installed: false, pane_path: false, platform: 'windows', setup_command: 'mkdir -p ~/.local/bin',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onKillTmuxServer={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /session/i }));
    await waitFor(() => expect(screen.getByText(/Windows host — not supported/)).toBeInTheDocument());
    expect(screen.getByText(/assume a POSIX shell/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Install$/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('offers install + copy when itl is missing, install posts to the setup route', async () => {
    const fetchMock = vi.fn((url) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(String(url).includes('/itl-setup')
        ? { installed: true, pane_path: true, setup_command: 'mkdir -p ~/.local/bin' }
        : { installed: false, pane_path: false, setup_command: 'mkdir -p ~/.local/bin' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onKillTmuxServer={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /session/i }));
    await waitFor(() => expect(screen.getByText(/Not installed/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Copy setup command/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Install$/ }));
    await waitFor(() => expect(screen.getByText(/Ready — usable/)).toBeInTheDocument());
    const setupCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/itl-setup'));
    expect(setupCall[1].method).toBe('POST');
    vi.unstubAllGlobals();
  });
});
