import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MachineInfo from './MachineInfo';
import { ko } from '../../i18n/locales/ko';

const state = vi.hoisted(() => ({
  stats: null, history: [], updatedAt: null, error: false, refreshing: false, refresh: vi.fn(),
}));
const hook = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMachineStats', () => ({ default: (...args) => { hook(...args); return state; } }));
const t = key => ko[key] || key;
const sample = {
  hostname: 'test-server', cpu_model: 'Test CPU', cpu_count: 8,
  cpu: 24, ram: 60, disk: 40, mem_total: 16 * 1024 ** 3, mem_used: 9 * 1024 ** 3,
  mem_available: 7 * 1024 ** 3, disk_total: 100 * 1024 ** 3, disk_used: 40 * 1024 ** 3,
  disk_free: 60 * 1024 ** 3, disk_path: '/workspace', swap_total: 0,
  net_rx_rate: 2048, net_tx_rate: 1024, uptime: 172800, load_avg: [1, 2, 3],
  top_processes: [{ pid: 12, name: 'python', cpu_percent: 150, rss_bytes: 1024 ** 3, cmd: 'private-command-argument' }],
};

beforeEach(() => {
  Object.assign(state, { stats: sample, history: [], updatedAt: 10000, error: false, refreshing: false });
  hook.mockClear(); state.refresh.mockClear();
});

describe('MachineInfo', () => {
  it('shows specifications with monitoring OFF by default', () => {
    render(<MachineInfo t={t} />);
    expect(hook).toHaveBeenLastCalledWith(true, false);
    expect(screen.getByRole('switch', { name: '실시간 모니터링' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Test CPU')).toBeInTheDocument();
    expect(screen.getByText('16 GB')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'CPU · 메모리 · 디스크 추이' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it('enables usage, then freezes the last display while OFF', () => {
    const { rerender } = render(<MachineInfo t={t} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(hook).toHaveBeenLastCalledWith(true, true);
    state.history = [{ at: 10000, cpu: 24, ram: 60, disk: 40, net_rx_rate: 2048, net_tx_rate: 1024 }];
    rerender(<MachineInfo t={t} />);
    expect(screen.getByText('24.0%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '네트워크 전송률' })).toBeInTheDocument();
    expect(screen.queryByText('private-command-argument')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    state.stats = { ...sample, cpu: 99 };
    state.history = [...state.history, { ...state.history[0], at: 12000, cpu: 99 }];
    state.updatedAt = 12000;
    rerender(<MachineInfo t={t} />);
    expect(screen.getByText('24.0%')).toBeInTheDocument();
    expect(screen.queryByText('99.0%')).not.toBeInTheDocument();
    expect(hook).toHaveBeenLastCalledWith(true, false);
  });

  it('keeps the last monitored sample when an OFF refresh precedes a failed restart', () => {
    state.history = [{ at: 10000, cpu: 24, ram: 60, disk: 40 }];
    const { rerender } = render(<MachineInfo t={t} />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('switch'));
    state.stats = { ...sample, cpu: 90 };
    state.updatedAt = 40000;
    rerender(<MachineInfo t={t} />);
    fireEvent.click(screen.getByRole('switch'));
    state.error = true;
    rerender(<MachineInfo t={t} />);
    expect(screen.getByText('24.0%')).toBeInTheDocument();
    expect(screen.queryByText('90.0%')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('다시 시도');
    expect(screen.getByRole('img', { name: 'CPU · 메모리 · 디스크 추이' }).querySelector('path')).toHaveAttribute('d', 'M600.00,108.80');
  });

  it('stops subscriptions when the home is not visible', () => {
    const { rerender } = render(<MachineInfo t={t} />);
    fireEvent.click(screen.getByRole('switch'));
    rerender(<MachineInfo t={t} isVisible={false} />);
    expect(hook).toHaveBeenLastCalledWith(false, true);
    expect(screen.getByRole('status')).toHaveTextContent('일시 중지');
  });

  it('keeps errors visible and lets OFF retry without enabling polling', () => {
    Object.assign(state, { stats: null, error: true });
    render(<MachineInfo t={t} />);
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다');
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('supports a missing translator and missing metrics', () => {
    state.stats = { hostname: 'partial' };
    const { rerender } = render(<MachineInfo />);
    fireEvent.click(screen.getByRole('switch'));
    state.history = [{ at: 10000, cpu: null, ram: null, disk: null, net_rx_rate: null, net_tx_rate: null }];
    rerender(<MachineInfo />);
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
