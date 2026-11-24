import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HomeDashboard from './HomeDashboard';

const fleetState = vi.hoisted(() => ({
  targets: [], machines: [], loading: false, error: null, refresh: vi.fn(),
}));
vi.mock('../hooks/useFleet', () => ({ default: () => fleetState }));

import { locales } from '../i18n/locales';
const mockT = (key, fallback) => locales.en[key] || fallback || key;

describe('HomeDashboard', () => {
  afterEach(() => {
    fleetState.targets = [];
    fleetState.machines = [];
    fleetState.refresh.mockClear();
  });

  it('renders empty state with This machine + add-slot fillers', () => {
    render(
      <HomeDashboard
        hosts={[]}
        onOpenHost={vi.fn()}
        onAddHost={vi.fn()}
        onManageHosts={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/This machine/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Add host/i)).toHaveLength(1);
  });

  it('renders saved hosts as cards', () => {
    const hosts = [
      { id: 'h1', name: 'oci-a1', hostname: '1.2.3.4', ssh_user: 'ubuntu', color_index: 0 },
      { id: 'h2', name: 'staging', hostname: 'stg.example', ssh_user: 'root', color_index: 2, icon: '🚀' },
    ];
    render(
      <HomeDashboard
        hosts={hosts}
        onOpenHost={vi.fn()}
        onAddHost={vi.fn()}
        onManageHosts={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText('oci-a1')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('🚀')).toBeInTheDocument();
  });

  it('opens host on click', () => {
    const onOpenHost = vi.fn();
    const hosts = [{ id: 'h1', name: 'oci-a1', hostname: '1.2.3.4', ssh_user: 'ubuntu', color_index: 0 }];
    render(
      <HomeDashboard
        hosts={hosts}
        onOpenHost={onOpenHost}
        onAddHost={vi.fn()}
        onManageHosts={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByText('oci-a1'));
    expect(onOpenHost).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }));
  });

  it('opens local on This machine click', () => {
    const onOpenHost = vi.fn();
    render(
      <HomeDashboard
        hosts={[]}
        onOpenHost={onOpenHost}
        onAddHost={vi.fn()}
        onManageHosts={vi.fn()}
        t={mockT}
      />
    );
    fireEvent.click(screen.getByText(/This machine/i));
    expect(onOpenHost).toHaveBeenCalledWith(expect.objectContaining({ isLocal: true }));
  });

  it('Add host button triggers onAddHost', () => {
    const onAddHost = vi.fn();
    render(
      <HomeDashboard hosts={[]} onOpenHost={vi.fn()} onAddHost={onAddHost} t={mockT} />
    );
    const addButtons = screen.getAllByText(/Add host/i);
    expect(addButtons).toHaveLength(1);
    fireEvent.click(addButtons[0]);
    expect(onAddHost).toHaveBeenCalled();
  });

  it('shows Machine info beside Dashboard with monitoring off', () => {
    render(<HomeDashboard hosts={[]} t={mockT} />);
    const button = screen.getByRole('button', { name: 'Machine info' });
    expect(screen.getByRole('button', { name: 'Dashboard' }).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByRole('switch', { name: 'Live monitoring' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Specifications')).toBeInTheDocument();
  });

  it('opens a Fleet pane by its stable tab address', () => {
    const onJumpPane = vi.fn();
    fleetState.targets = [{
      addr: '12.1', tabIndex: 12, paneIndex: 1, paneId: 'pane-12', status: 'idle',
    }];

    render(
      <HomeDashboard
        hosts={[]}
        tabs={[
          { id: 'tab-1', addressNumber: 1 },
          { id: 'tab-12', addressNumber: 12 },
        ]}
        onJumpPane={onJumpPane}
        t={mockT}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Running' }));
    fireEvent.click(screen.getByText('12.1'));

    expect(onJumpPane).toHaveBeenCalledWith('tab-12', 'pane-12');
  });
});


/* 숨쉬기 — "지금 살아 있는 링크" 를 말하는 맥동. 붙어 있을 때만이고, 미설치 칩에는
   없다(거기서 맥동하면 재촉이 되는데 안 깐 것은 결함이 아니라 선택이다). */
