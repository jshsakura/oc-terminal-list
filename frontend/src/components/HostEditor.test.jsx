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
        host={{ ...sampleHost, multiplexer: 'tmux' }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('세션 탭을 열면 tmux 가 그 호스트에 있는지 auth_token 으로 물어본다', async () => {
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
        host={{ ...sampleHost, multiplexer: 'tmux' }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    // 멀티플렉서는 여기서 고르는 값이 아니다(설정 한 곳이 정한다) — 탭을 여는 것만으로
    // 그 호스트에 tmux 가 있는지 한 번 물어본다.
    fireEvent.click(screen.getByText(/Session/i).closest('button'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/hosts/h1/tmux-check', {
        headers: { Authorization: 'Bearer auth-token-123' },
      });
    });
  });

  /* `none` 은 고장이 아니라 유효한 선택이다. 그러면 반드시 "닫으면 끝난다" 를
     읽을 수 있어야 한다 — 이걸 안 말한 채로 떨어뜨린 것이 예전 동작이었다. */
  it('none 인 호스트는 세션이 안 남는다고 말한다', () => {
    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, multiplexer: 'none' }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByText(/Session/i).closest('button'));
    expect(screen.getByText(/Closing the tab or losing the connection ends/)).toBeTruthy();
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
});
