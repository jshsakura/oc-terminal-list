import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LeftSidebar from './LeftSidebar';

import { locales } from '../i18n/locales';
const mockT = (key, fallback) => locales.en[key] || fallback || key;

describe('LeftSidebar', () => {
  it('renders activity bar always (no panel selected)', () => {
    render(
      <LeftSidebar
        hosts={[]}
        sshKeys={[]}
        onConnectHost={vi.fn()}
        onAddHost={vi.fn()}
        onEditHost={vi.fn()}
        onAddKey={vi.fn()}
        onEditKey={vi.fn()}
        onDeleteKey={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByTitle('Hosts')).toBeInTheDocument();
    expect(screen.getByTitle('SSH Keys')).toBeInTheDocument();
    expect(screen.getByTitle(/Settings/i)).toBeInTheDocument();
    // Logout 은 Settings 모달의 General 탭 안으로 이동 — 사이드바엔 없어야 함.
    expect(screen.queryByTitle(/Sign Out|Logout/i)).not.toBeInTheDocument();
  });

  it('toggles hosts panel on Hosts icon click', () => {
    render(
      <LeftSidebar
        hosts={[{ id: 'h1', name: 'srv', hostname: '1.2.3.4', ssh_user: 'root', color_index: 0 }]}
        sshKeys={[]}
        onConnectHost={vi.fn()}
        onAddHost={vi.fn()}
        onEditHost={vi.fn()}
        onAddKey={vi.fn()}
        onEditKey={vi.fn()}
        onDeleteKey={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByTitle('Hosts'));
    expect(screen.getByText('srv')).toBeInTheDocument();
  });

  it('controlled mode: uses activePanel prop', () => {
    const onChange = vi.fn();
    render(
      <LeftSidebar
        hosts={[]}
        sshKeys={[]}
        onConnectHost={vi.fn()}
        onAddHost={vi.fn()}
        onEditHost={vi.fn()}
        onAddKey={vi.fn()}
        onEditKey={vi.fn()}
        onDeleteKey={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
        activePanel="hosts"
        onActivePanelChange={onChange}
        t={mockT}
      />
    );
    expect(screen.getByText(/This machine/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Hosts'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('settings icon triggers onOpenSettings', () => {
    const onOpenSettings = vi.fn();
    render(
      <LeftSidebar
        hosts={[]}
        sshKeys={[]}
        onConnectHost={vi.fn()}
        onAddHost={vi.fn()}
        onEditHost={vi.fn()}
        onAddKey={vi.fn()}
        onEditKey={vi.fn()}
        onDeleteKey={vi.fn()}
        onOpenSettings={onOpenSettings}
        onLogout={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByTitle(/Settings/i));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('host edit gear triggers onEditHost with host', () => {
    const onEditHost = vi.fn();
    const hosts = [{ id: 'h1', name: 'srv', hostname: '1.2.3.4', ssh_user: 'root', color_index: 0 }];
    render(
      <LeftSidebar
        hosts={hosts}
        sshKeys={[]}
        onConnectHost={vi.fn()}
        onAddHost={vi.fn()}
        onEditHost={onEditHost}
        onAddKey={vi.fn()}
        onEditKey={vi.fn()}
        onDeleteKey={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
        activePanel="hosts"
        t={mockT}
      />
    );
    // 호스트 행 컨테이너 → 그 안의 모든 button 중 마지막 (settings 기어)
    const srvNameEl = screen.getByText('srv');
    let row = srvNameEl;
    while (row && !row.querySelector?.('button')) row = row.parentElement;
    const buttons = row.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onEditHost).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }));
  });
});
