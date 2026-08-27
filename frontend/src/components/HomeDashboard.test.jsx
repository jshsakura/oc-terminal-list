import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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


/* 숨쉬기 — "지금 살아 있는 링크" 를 말하는 맥동. 붙어 있을 때만이고, 미설치 칩에는
   없다(거기서 맥동하면 재촉이 되는데 안 깐 것은 결함이 아니라 선택이다). */
describe('리모트 표식의 숨쉬기', () => {
  const HOST = { id: 'h1', name: 'rpi5', hostname: '10.0.0.1', use_remote_tmux: true };

  /* 붙어 있음은 prop 이 아니라 `useConnectedRemotes` 가 한 번에 물어 온다(호스트마다
     묻지 않는 것이 그 훅의 요점이다). 그래서 그 요청을 세운다. */
  const stubConnected = (connected) => vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
    String(url).includes('/api/remote/connected')
      ? { ok: true, json: () => Promise.resolve({ connected }) }
      : { ok: true, json: () => Promise.resolve({}) },
  )));

  afterEach(() => vi.unstubAllGlobals());

  it('붙어 있으면 맥동한다', async () => {
    stubConnected({ h1: true });
    const { container } = render(<HomeDashboard hosts={[HOST]} t={mockT} />);
    await waitFor(() => expect(container.querySelector('.iterm-breathe')).toBeTruthy());
  });

  it('안 붙어 있으면 맥동하지 않는다 — 재촉이 아니라 상태 표시다', async () => {
    stubConnected({});
    const { container } = render(<HomeDashboard hosts={[HOST]} t={mockT} />);
    // 미설치 칩이 그려진 뒤에 본다 — 부재 단언은 t=0 에 헛통과한다.
    await waitFor(() => expect(screen.getByTitle(/remote/i)).toBeInTheDocument());
    expect(container.querySelector('.iterm-breathe')).toBeFalsy();
  });
});
