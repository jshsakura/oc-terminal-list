import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from './TabBar';

describe('TabBar', () => {
  it('renders with no tabs and shows brand + home + settings only', () => {
    render(
      <TabBar
        tabs={[]} activeTabId={null}
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    expect(screen.getByTitle('Home')).toBeInTheDocument();
    expect(screen.getByTitle(/^Settings/)).toBeInTheDocument();
    // Hosts / SSH Keys / Logout 은 Settings 모달의 탭 안으로 이동 → TabBar 액션바엔 없음.
    expect(screen.queryByTitle(/SSH Keys/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Manage hosts/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Sign out/)).not.toBeInTheDocument();
  });

  it('opens the same Settings submenu on mobile instead of direct open', () => {
    const onOpenSettings = vi.fn();
    render(
      <TabBar
        tabs={[]} activeTabId={null} isMobile={true}
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()}
        onOpenSettings={onOpenSettings}
      />
    );
    fireEvent.click(screen.getByTitle(/^Settings/));
    expect(onOpenSettings).not.toHaveBeenCalled();
    const settingsItem = screen.getByText(/^Settings$/).closest('button');
    expect(settingsItem).toHaveStyle({ minHeight: '42px' });
    expect(settingsItem.parentElement).toHaveStyle({ backdropFilter: 'blur(20px)' });
    expect(settingsItem.parentElement.style.background).toContain('44%');
    fireEvent.click(settingsItem);
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('opens submenu on desktop when Settings gear clicked', () => {
    const onOpenSettings = vi.fn();
    render(
      <TabBar
        tabs={[]} activeTabId={null} isMobile={false}
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()}
        onOpenSettings={onOpenSettings}
        onReloadTerminals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle(/^Settings/));
    // Submenu should appear (not Settings directly)
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/^Settings$/)).toBeInTheDocument();
  });

  it('right-click on tab opens context menu and shows inline close confirmation', () => {
    const tabs = [{ id: 'local:1', type: 'local', sessionId: '1', name: 'zsh' }];
    const onCloseImmediate = vi.fn();
    render(
      <TabBar
        tabs={tabs} activeTabId="local:1"
        onSelect={vi.fn()} onClose={vi.fn()} onCloseImmediate={onCloseImmediate} onHome={vi.fn()}
        onOpenKeys={vi.fn()} onOpenSettings={vi.fn()} onLogout={vi.fn()}
      />
    );
    fireEvent.contextMenu(screen.getByText('zsh'));
    const closeMenuItem = screen.getByText(/Close tab/i);
    fireEvent.click(closeMenuItem);
    // Context menu closes; tab enters pending-close state showing "Close?" prompt
    expect(screen.getByText(/Close\?/i)).toBeInTheDocument();
    // Confirm closes the tab immediately
    fireEvent.click(screen.getByTitle(/Confirm/i));
    expect(onCloseImmediate).toHaveBeenCalledWith('local:1');
  });

  it('renders tabs and selects on click', () => {
    const tabs = [
      { id: 'local:1', type: 'local', sessionId: '1', name: 'zsh' },
      { id: 'host:abc:1', type: 'host', hostId: 'abc', name: 'oci-a1', color_index: 2 },
    ];
    const onSelect = vi.fn();
    render(
      <TabBar tabs={tabs} activeTabId="local:1" onSelect={onSelect} onClose={vi.fn()} onAdd={vi.fn()} onHome={vi.fn()} />
    );
    expect(screen.getByText('zsh')).toBeInTheDocument();
    expect(screen.getByText('oci-a1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('oci-a1'));
    expect(onSelect).toHaveBeenCalledWith('host:abc:1');
  });

  it('triggers onClose when X is clicked', () => {
    const tabs = [{ id: 'local:1', type: 'local', sessionId: '1', name: 'zsh' }];
    const onClose = vi.fn();
    render(
      <TabBar tabs={tabs} activeTabId="local:1" onSelect={vi.fn()} onClose={onClose} onAdd={vi.fn()} onHome={vi.fn()} />
    );
    // X 버튼은 Tab 안의 SVG → 부모 button 찾아 클릭
    const closeButtons = document.querySelectorAll('button');
    // 마지막 + 와 home 버튼 제외, X 버튼 찾기 (closeBtn 스타일)
    const xButton = Array.from(closeButtons).find((b) => b.querySelector('svg')?.getAttribute('width') === '10');
    if (xButton) {
      fireEvent.click(xButton);
      expect(onClose).toHaveBeenCalledWith('local:1');
    }
  });

  it('navigates home when Home button is clicked', () => {
    const onHome = vi.fn();
    render(
      <TabBar tabs={[]} activeTabId="local:1" onSelect={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} onHome={onHome} />
    );
    fireEvent.click(screen.getByTitle('Home'));
    expect(onHome).toHaveBeenCalled();
  });

  it('renders host tab with emoji icon', () => {
    const tabs = [
      { id: 'host:1', type: 'host', hostId: 'h1', name: 'srv', color_index: 0, icon: '🚀' },
    ];
    render(
      <TabBar tabs={tabs} activeTabId="host:1" onSelect={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} onHome={vi.fn()} />
    );
    expect(screen.getByText('🚀')).toBeInTheDocument();
  });
});
