import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TerminalHeader from './TerminalHeader';

const mockT = (key) => key;

// Info and Theme live in the … menu, not on the rail.
const openPanelFromMenu = (container, label) => {
  fireEvent.click(container.querySelector('[title="more"]'));
  fireEvent.click(screen.getByText(label).closest('button'));
};

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

  it('separates the panel icons from the path with a thin rule', () => {
    const { container } = render(<TerminalHeader {...baseProps()} />);
    const rule = container.querySelector('[data-rail-divider]');
    expect(rule).toBeTruthy();
    expect(rule.getAttribute('aria-hidden')).toBe('true');
    // Sits between the icon strip and the cwd breadcrumb.
    expect(rule.previousElementSibling.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  // One rail skeleton per real RailIconBtn: 1 panel tab (files) + (split) + (… menu).
  const railSkeletons = (container) => container.querySelectorAll('[style*="iterm-rail-skel"]');

  it('shows one skeleton per rail button when loading=true', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true })} />);
    // 1 panel tab + the … menu (no split button without onSplitPane)
    expect(railSkeletons(container).length).toBe(2);
  });

  it('adds a skeleton for the split button when onSplitPane is provided', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true, onSplitPane: vi.fn() })} />);
    expect(railSkeletons(container).length).toBe(3);
  });

  it('omits the … menu skeleton for a disabled (empty) pane', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: true, disabled: true })} />);
    expect(railSkeletons(container).length).toBe(1);
  });

  it('shows no skeleton when loading=false', () => {
    const { container } = render(<TerminalHeader {...baseProps({ loading: false })} />);
    expect(railSkeletons(container).length).toBe(0);
  });

  it('does not animate loading chrome while its pane is hidden', () => {
    const { container } = render(
      <TerminalHeader {...baseProps({ loading: true, isPaneVisible: false })} />
    );
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
    // 1 tab skeleton + 1 more-button skeleton (secondary actions consolidated behind menu)
    expect(railSkeletons(container).length).toBe(2);
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

  describe('… menu — restart session', () => {
    const openMoreMenu = (props) => {
      const result = render(<TerminalHeader {...baseProps(props)} />);
      fireEvent.click(result.container.querySelector('[title="more"]'));
      return result;
    };

    it('offers Restart session alongside Reload terminal', () => {
      openMoreMenu({ terminalKey: 'local:1', onRefreshTerminal: vi.fn(), onRestartSession: vi.fn() });

      expect(screen.getByText('refreshTerminal')).toBeInTheDocument();
      expect(screen.getByText('restartSession')).toBeInTheDocument();
    });

    it('calls onRestartSession when the item is clicked', () => {
      const onRestartSession = vi.fn();
      openMoreMenu({ terminalKey: 'local:1', onRestartSession });

      fireEvent.click(screen.getByText('restartSession'));

      expect(onRestartSession).toHaveBeenCalledTimes(1);
    });

    it('gives an empty pane no … menu at all, so no restart entry', () => {
      const { container } = render(
        <TerminalHeader {...baseProps({ disabled: true, onRestartSession: vi.fn(), onCloseTerminal: vi.fn() })} />
      );

      expect(container.querySelector('[title="more"]')).toBeNull();
      expect(screen.queryByText('restartSession')).not.toBeInTheDocument();
    });

    it('hides Restart session when no handler is provided', () => {
      openMoreMenu({ terminalKey: 'local:1', onRefreshTerminal: vi.fn() });

      expect(screen.queryByText('restartSession')).not.toBeInTheDocument();
    });
  });

  it('disables nav section pointer events when disabled=true', () => {
    const { container } = render(<TerminalHeader {...baseProps({ disabled: true })} />);
    const nav = container.querySelector('[style*="pointer-events: none"]') ||
                container.querySelector('[style*="pointerEvents: none"]');
    expect(nav).toBeTruthy();
  });

  it('uses the shared glass treatment for opened side panels', () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);
    openPanelFromMenu(container, 'paneInfoTitle');
    expect(container.querySelector('[tabindex="-1"]').style.backdropFilter).toMatch(/blur\(.*18px\)/);
  });

  it('opens … menu panels from the right edge, with the resize handle on their left', () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);
    openPanelFromMenu(container, 'paneInfoTitle');
    const panel = container.querySelector('[tabindex="-1"]');
    expect(panel.style.right).toBe('0px');
    expect(panel.style.left).toBe('');
    expect(container.querySelector('[title="resizePanel"]').style.left).toBe('-4px');
  });

  it('preserves an open side panel while its pane is hidden without rendering it', async () => {
    const props = baseProps({ activeTabType: 'local', isPaneVisible: true });
    const result = render(<TerminalHeader {...props} />);
    openPanelFromMenu(result.container, 'paneInfoTitle');
    const panel = result.container.querySelector('[tabindex="-1"]');
    expect(panel).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));

    result.rerender(<TerminalHeader {...props} isPaneVisible={false} />);
    expect(result.container.querySelector('[tabindex="-1"]')).toBe(panel);
    expect(panel).toHaveStyle({ display: 'none' });

    fireEvent.keyDown(document, { key: 'Escape' });
    result.rerender(<TerminalHeader {...props} isPaneVisible />);
    expect(result.container.querySelector('[tabindex="-1"]')).toBe(panel);
    expect(panel).toHaveStyle({ display: 'flex' });
  });

  it('closes body-portaled menus when its pane becomes hidden', () => {
    const props = baseProps({ isPaneVisible: true, terminalKey: 'local:1', onCloseTerminal: vi.fn() });
    const result = render(<TerminalHeader {...props} />);
    fireEvent.click(result.container.querySelector('[title="more"]'));
    expect(screen.getByText('closeTerminal')).toBeInTheDocument();

    result.rerender(<TerminalHeader {...props} isPaneVisible={false} />);
    expect(screen.queryByText('closeTerminal')).not.toBeInTheDocument();
  });

  it('pauses the busy badge animation while its pane is hidden', () => {
    const { container } = render(<TerminalHeader {...baseProps({ isPaneVisible: false, isBusy: true })} />);
    expect(container.querySelector('[title="terminalBusy"] > span')).toHaveStyle({ animation: 'none' });
  });

  it('does not start Info polling for a hidden pane', () => {
    localStorage.setItem('iterm:terminal-header-panel:v1:hidden-info', JSON.stringify({ activePanel: 'info', panelWidth: 320 }));
    render(<TerminalHeader {...baseProps({
      isPaneVisible: false,
      paneInfo: { paneId: 'hidden-info', sessionId: 'local:hidden-info', tabType: 'local' },
    })} />);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('switches side panels from the … menu while another panel is open', async () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);

    openPanelFromMenu(container, 'paneInfoTitle');
    expect(await screen.findByText('paneInfoTitle')).toBeTruthy();

    // The … button ignores a reopen within 300ms of closing (outside-click guard).
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    openPanelFromMenu(container, 'paneThemeTitle');

    await waitFor(() => expect(screen.getByText('paneThemeTitle')).toBeTruthy());
  });

  it('highlights the side panel resize handle on hover', async () => {
    const { container } = render(<TerminalHeader {...baseProps({ activeTabType: 'local' })} />);

    openPanelFromMenu(container, 'paneInfoTitle');
    await screen.findByText('paneInfoTitle');

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
      // Open the info panel from the … menu
      openPanelFromMenu(result.container, 'paneInfoTitle');
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

  describe('pane address chip', () => {
    it('shows the pane address in the rail on mobile', () => {
      render(<TerminalHeader {...baseProps({ isMobile: true, paneAddress: '2.3' })} />);
      expect(screen.getByText('2.3')).toBeTruthy();
    });

    it('shows the same rail chip on desktop', () => {
      render(<TerminalHeader {...baseProps({ paneAddress: '2.3' })} />);
      expect(screen.getByText('2.3')).toBeTruthy();
    });

    it('omits the chip when the pane has no address', () => {
      render(<TerminalHeader {...baseProps({ isMobile: true })} />);
      expect(screen.queryByText(/^\d+\.\d+$/)).toBeNull();
    });

    it('copies the itl handle on tap when a handler is provided', () => {
      const onCopyAddress = vi.fn();
      render(<TerminalHeader {...baseProps({ isMobile: true, paneAddress: '2.3', onCopyAddress })} />);
      fireEvent.click(screen.getByText('2.3'));
      expect(onCopyAddress).toHaveBeenCalledTimes(1);
    });

    it('exposes an action label and a 28px rail hit target', () => {
      render(<TerminalHeader {...baseProps({ paneAddress: '2.3', onCopyAddress: vi.fn() })} />);
      const button = screen.getByRole('button', { name: /2\.3/ });
      expect(button.style.height).toBe('28px');
    });

    it('renders a passive span when itl is unavailable', () => {
      render(<TerminalHeader {...baseProps({ isMobile: true, paneAddress: '2.3' })} />);
      expect(screen.getByText('2.3').tagName).toBe('SPAN');
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
      // Git lives behind the Files icon, which must exist and be clickable
      const filesBtn = container.querySelector('[title="files"]');
      expect(filesBtn).toBeTruthy();
      fireEvent.click(filesBtn);
      expect(container.querySelector('[data-panel-tab="git"]')).toBeTruthy();
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
      // No count on the Files icon when there are no changes
      expect(container.querySelector('[title="files"]')).toBeTruthy();
      expect(container.querySelector('[title^="Files ("]')).toBeNull();
    });
  });
});

describe('TerminalHeader — Info and Theme live in the … menu', () => {
  it('keeps only Files on the rail', () => {
    const { container } = render(<TerminalHeader settings={{ theme: 'catppuccin' }} t={mockT} language="en" />);
    expect(container.querySelector('[title="Info"]')).toBeNull();
    expect(container.querySelector('[title="Theme"]')).toBeNull();
    expect(container.querySelector('[title="files"]')).toBeTruthy();
  });

  it('lists both in the … menu with a one-line hint', () => {
    const { container } = render(<TerminalHeader settings={{ theme: 'catppuccin' }} t={mockT} language="en" />);
    fireEvent.click(container.querySelector('[title="more"]'));
    expect(screen.getByText('paneInfoTitle')).toBeInTheDocument();
    expect(screen.getByText('paneInfoHint')).toBeInTheDocument();
    expect(screen.getByText('paneThemeTitle')).toBeInTheDocument();
    expect(screen.getByText('paneThemeHint')).toBeInTheDocument();
  });
});

describe('TerminalHeader — Git is a tab inside the Files panel', () => {
  it('has no separate Git rail icon', () => {
    const { container } = render(<TerminalHeader settings={{ theme: 'catppuccin' }} t={mockT} language="en" />);
    expect(container.querySelector('[title="Git"]')).toBeNull();
  });

  it('switches between files and changes inside the panel and closes from the Files icon', () => {
    localStorage.setItem('iterm:terminal-header-panel:v1:inner-tabs', JSON.stringify({ activePanel: 'files', panelWidth: 260 }));
    const { container } = render(<TerminalHeader
      settings={{ theme: 'catppuccin' }} t={mockT} language="en" activeTabType="local"
      paneInfo={{ paneId: 'inner-tabs', tabType: 'local' }}
    />);
    const filesTab = container.querySelector('[data-panel-tab="files"]');
    const gitTab = container.querySelector('[data-panel-tab="git"]');
    expect(filesTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(gitTab);
    expect(container.querySelector('[data-panel-tab="git"]').getAttribute('aria-selected')).toBe('true');
    // The Files rail icon stays lit for the Git tab and closes the whole panel.
    fireEvent.click(container.querySelector('[title="files"]'));
    expect(container.querySelector('[data-panel-tab]')).toBeNull();
  });
});
