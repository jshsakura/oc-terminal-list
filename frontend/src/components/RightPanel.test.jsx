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
    // 4 tab skeletons + 1 more-button skeleton (secondary actions consolidated behind menu)
    const skeletons = container.querySelectorAll('[style*="skel-pulse"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(5);
  });

  it('disables nav section pointer events when disabled=true', () => {
    const { container } = render(<RightPanel {...baseProps({ disabled: true })} />);
    const nav = container.querySelector('[style*="pointer-events: none"]') ||
                container.querySelector('[style*="pointerEvents: none"]');
    expect(nav).toBeTruthy();
  });

  describe('Info panel — pane identity and cwd', () => {
    const openInfoPanel = (paneInfoOverrides = {}) => {
      const props = baseProps({
        activeTabType: 'local',
        gitContextPath: '',
        paneInfo: {
          tabName: 'My Tab',
          tabType: 'local',
          sessionId: 'sess-1',
          paneId: 'pane-1',
          paneIndex: 0,
          paneCount: 1,
          isPersistent: true,
          host: null,
          paneName: null,
          cwd: '',
          cwdAbsolute: '/home/user/workspace',
          paneCwdRel: '',
          ...paneInfoOverrides,
        },
      });
      const result = render(<RightPanel {...props} />);
      // Click the Info tab to open the info panel
      const infoBtn = result.container.querySelector('[title="Info"]');
      if (infoBtn) fireEvent.click(infoBtn);
      return result;
    };

    it('shows paneName in Tab row when paneInfo.paneName is set', async () => {
      const { findByText } = openInfoPanel({ paneName: 'my-pane' });
      expect(await findByText('my-pane')).toBeTruthy();
    });

    it('falls back to tabName when paneName is null', async () => {
      const { findByText } = openInfoPanel({ paneName: null });
      expect(await findByText('My Tab')).toBeTruthy();
    });

    it('shows workspace root cwd (empty string) as ~/', async () => {
      const { findByText } = openInfoPanel({ cwd: '', paneCwdRel: '' });
      // cwdDisplay for empty paneCwdRel should be '~/' (~/ + '' = ~/)
      expect(await findByText('~/')).toBeTruthy();
    });

    it('shows workspace-relative cwd when non-empty', async () => {
      const { findByText } = openInfoPanel({ cwd: 'src/app', paneCwdRel: 'src/app' });
      expect(await findByText('src/app')).toBeTruthy();
    });
  });

  describe('Git context — empty string path (workspace root)', () => {
    it('enables git changes polling for gitContextPath="" (workspace root)', () => {
      // Should NOT crash or skip rendering — empty string is a valid path
      const { container } = render(
        <RightPanel
          {...baseProps({
            activeTabType: 'local',
            gitContextPath: '',
          })}
        />
      );
      expect(container.firstChild).toBeTruthy();
      // The git icon button should exist and be clickable
      const gitBtn = container.querySelector('[title="Git"]') ||
                     container.querySelector('[title="Git (0)"]');
      expect(gitBtn).toBeTruthy();
    });

    it('shows git badge count 0 for empty path (not disabled)', () => {
      const { container } = render(
        <RightPanel
          {...baseProps({
            activeTabType: 'local',
            gitContextPath: '',
          })}
        />
      );
      // Badge should not show when count is 0, but git button must exist
      const gitBtn = container.querySelector('[title="Git"]');
      expect(gitBtn).toBeTruthy();
    });
  });
});
