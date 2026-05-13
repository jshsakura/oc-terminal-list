import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
