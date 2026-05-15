import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HomeDashboard from './HomeDashboard';

import { locales } from '../i18n/locales';
const mockT = (key, fallback) => locales.en[key] || fallback || key;

describe('HomeDashboard', () => {
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
});
