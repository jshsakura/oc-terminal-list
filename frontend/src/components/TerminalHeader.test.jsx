import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TerminalHeader from './TerminalHeader';

const mockT = (key) => key;

const baseProps = (overrides = {}) => ({
  settings: { theme: 'catppuccin' },
  t: mockT,
  language: 'en',
  ...overrides,
});

describe('TerminalHeader', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cpu: 42.5, ram: 60, disk: 30, cpu_count: 4, mem_used: 4096, mem_total: 8192, disk_used: 100, disk_total: 500, hostname: 'test-host', load_avg: [1.0, 0.8, 0.6], uptime: 86400 }),
    }));
  });

  afterEach(() => {
    delete window.terminalSessions;
    vi.restoreAllMocks();
  });

  it('renders the activity bar root', () => {
    const { container } = render(<TerminalHeader {...baseProps()} />);
    expect(container.firstChild).toBeTruthy();
  });

  // 레일 스켈레톤은 실제 RailIconBtn 자리마다 하나씩 — 4개 패널 탭 + (분할) + (… 메뉴).
  const railSkeletons = (container) => container.querySelectorAll('[style*="iterm-rail-skel"]');

  it('shows one skeleton per rail button when loading=true', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true })} />);
    // 4 panel tabs + the … menu (no split button without onSplitPane)
    expect(railSkeletons(container).length).toBe(5);
  });

  it('adds a skeleton for the split button when onSplitPane is provided', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true, onSplitPane: vi.fn() })} />);
    expect(railSkeletons(container).length).toBe(6);
  });

  it('omits the … menu skeleton for a disabled (empty) pane', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true, disabled: true })} />);
    expect(railSkeletons(container).length).toBe(4);
  });

  it('shows no skeleton when loading=false', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: false })} />);
    expect(railSkeletons(container).length).toBe(0);
  });

  it('keeps the focus eye slot while loading and unfocused', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true, isFocused: false })} />);
    expect(screen.getByLabelText('paneUnfocused')).toBeTruthy();
    expect(container.querySelector('.lucide-eye-off')).toBeTruthy();
  });

  it('shows the open focus eye for the active pane', () => {
    const { container } = render(<TerminalHeader {...baseProps({ isFocused: true })} />);
    expect(screen.getByLabelText('paneFocused')).toBeTruthy();
    expect(container.querySelector('.lucide-eye')).toBeTruthy();
  });

  it('shows no skeleton for close button when loading=false', () => {
    const { container } = render(
      <TerminalHeader {...baseProps({ loading: false, onCloseTerminal: vi.fn() })} />
    );
    expect(railSkeletons(container).length).toBe(0);
  });

  it('keeps the rail skeleton count stable for actions hidden behind the … menu', () => {
    const { container } = render(
      <TerminalHeader {...baseProps({
        loading: true,
        onCloseTerminal: vi.fn(),
        onExtractPane: vi.fn(),
      })} />
    );
    // 4 tab skeletons + 1 more-button skeleton (secondary actions consolidated behind menu)
    expect(railSkeletons(container).length).toBe(5);
  });

  it('reserves the drag-handle slot while loading on desktop so the rail does not shift', () => {
    const loaded = render(<TerminalHeader {...baseProps({ loading: false })} />);
    const handle = loaded.container.querySelector('[title="paneHandle"]');
    expect(handle).toHaveStyle({ width: '22px' });

    const { container } = render(<TerminalHeader {...baseProps({ loading: true })} />);
    expect(container.querySelector('[title="paneHandle"]')).toBeNull();
    // 핸들 자리를 같은 폭의 빈 칸으로 채워둔다.
    const spacer = container.querySelector('[aria-hidden="true"][style*="22px"]');
    expect(spacer).toBeTruthy();
  });

  it('disables nav section pointer events when disabled=true', () => {
    const { container } = render(<TerminalHeader {...baseProps({ disabled: true })} />);
    const nav = container.querySelector('[style*="pointer-events: none"]') ||
                container.querySelector('[style*="pointerEvents: none"]');
    expect(nav).toBeTruthy();
  });

  it('uses the shared glass treatment for opened side panels', () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);
    fireEvent.click(container.querySelector('[title="Info"]'));
    expect(container.querySelector('[tabindex="-1"]').style.backdropFilter).toMatch(/blur\(.*18px\)/);
  });

  it('switches side panels with one click while another panel is open', async () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);

    fireEvent.click(container.querySelector('[title="Info"]'));
    expect(await screen.findByText('Info')).toBeTruthy();

    fireEvent.mouseDown(container.querySelector('[title="Theme"]'));
    fireEvent.click(container.querySelector('[title="Theme"]'));

    await waitFor(() => expect(screen.getByText('Theme')).toBeTruthy());
  });

  it('highlights the side panel resize handle on hover', async () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);

    fireEvent.click(container.querySelector('[title="Info"]'));
    await screen.findByText('Info');

    const handle = container.querySelector('[title="resizePanel"]');
    expect(handle).toBeTruthy();
    expect(handle.firstChild).toHaveStyle({ opacity: '0' });

    fireEvent.mouseEnter(handle);
    expect(handle.firstChild).toHaveStyle({ opacity: '1' });
    expect(handle.firstChild).toHaveStyle({ width: '1px' });
  });

  it('restores the previously opened side panel for the pane', () => {
    localStorage.setItem('iterm:terminal-header-panel:v1:pane-restore', JSON.stringify({ activePanel: 'info', panelWidth: 320 }));
    const { container } = render(<TerminalHeader {...baseProps({
      activeTabType: 'local',
      paneInfo: { paneId: 'pane-restore', tabName: 'Restored', tabType: 'local' },
    })} />);
    const panel = container.querySelector('[tabindex="-1"]');
    expect(panel).toBeTruthy();
    expect(panel).toHaveStyle({ width: '320px' });
  });

  it('uses larger touch targets for mobile more-menu items', () => {
    const { container } = render(<TerminalHeader {...baseProps({
      isMobile: true,
      terminalKey: 'local:1',
      onCloseTerminal: vi.fn(),
      onRefreshTerminal: vi.fn(),
    })} />);

    fireEvent.click(container.querySelector('[title="more"]'));
    const closeItem = screen.getByText('closeTerminal').closest('button');
    expect(closeItem).toHaveStyle({ minHeight: '42px' });
  });

  it('opens the mobile screen dump action from the more menu', () => {
    const onScreenDump = vi.fn();
    window.terminalSessions = {
      'local:1': {
        getBufferText: vi.fn(() => 'hello\nworld'),
      },
    };

    const { container } = render(<TerminalHeader {...baseProps({
      isMobile: true,
      terminalKey: 'local:1',
      onScreenDump,
      onRefreshTerminal: vi.fn(),
    })} />);

    fireEvent.click(container.querySelector('[title="more"]'));
    fireEvent.click(screen.getByText('viewAsText').closest('button'));

    expect(onScreenDump).toHaveBeenCalledWith('hello\nworld');
  });

  describe('Info panel — pane identity and cwd', () => {
    const openInfoPanel = (paneInfoOverrides = {}, propOverrides = {}) => {
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
        ...propOverrides,
      });
      const result = render(<TerminalHeader {...props} />);
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

    it('formats uptime units through locale labels', async () => {
      const t = (key) => ({
        infoUptime: '가동 시간',
        uptimeDayUnit: '일',
        uptimeHourUnit: '시간',
        uptimeMinuteUnit: '분',
      }[key] || key);
      const { findByText } = openInfoPanel({}, { t });
      expect(await findByText('1일 0시간')).toBeTruthy();
    });
  });

  describe('Git context — empty string path (workspace root)', () => {
    it('enables git changes polling for gitContextPath="" (workspace root)', () => {
      // Should NOT crash or skip rendering — empty string is a valid path
      const { container } = render(
        <TerminalHeader
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
        <TerminalHeader
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
