import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RightPanel from './RightPanel';

const mockT = (key) => key;

const baseProps = (overrides = {}) => ({
  settings: { theme: 'catppuccin' },
  t: mockT,
  language: 'en',
  ...overrides,
});

describe('RightPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cpu: 42.5, ram: 60, disk: 30, cpu_count: 4, mem_used: 4096, mem_total: 8192, disk_used: 100, disk_total: 500, hostname: 'test-host', load_avg: [1.0, 0.8, 0.6], uptime: 86400 }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the activity bar root', () => {
    const { container } = render(<RightPanel {...baseProps()} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows skeleton icons in rail when loading=true', () => {
    const { container } = render(<RightPanel {...baseProps({ loading: true })} />);
    const skeletons = container.querySelectorAll('[style*="skel-pulse"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it('shows no skeleton when loading=false', () => {
    const { container } = render(<RightPanel {...baseProps({ loading: false })} />);
    const skeletons = container.querySelectorAll('[style*="skel-pulse"]');
    expect(skeletons.length).toBe(0);
  });

  it('shows skeleton for close button when loading=true and onCloseTerminal provided', () => {
    const { container } = render(
      <RightPanel {...baseProps({ loading: true, onCloseTerminal: vi.fn() })} />
    );
    const skeletons = container.querySelectorAll('[style*="skel-pulse"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(5);
  });

  it('shows no skeleton for close button when loading=false', () => {
    const { container } = render(
      <RightPanel {...baseProps({ loading: false, onCloseTerminal: vi.fn() })} />
    );
    const skeletons = container.querySelectorAll('[style*="skel-pulse"]');
    expect(skeletons.length).toBe(0);
  });

  it('shows skeleton for extract and close when both provided and loading', () => {
    const { container } = render(
      <RightPanel {...baseProps({
        loading: true,
        onCloseTerminal: vi.fn(),
        onExtractPane: vi.fn(),
      })} />
    );
    const skeletons = container.querySelectorAll('[style*="skel-pulse"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(6);
  });

  it('disables nav section pointer events when disabled=true', () => {
    const { container } = render(<RightPanel {...baseProps({ disabled: true })} />);
    const nav = container.querySelector('[style*="pointer-events: none"]') ||
                container.querySelector('[style*="pointerEvents: none"]');
    expect(nav).toBeTruthy();
  });
});
