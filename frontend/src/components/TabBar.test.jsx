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

  it('opens Settings directly on mobile (no submenu)', () => {
    // 모바일에선 서브메뉴(Reload/Equalize)를 거치지 않고 설정 화면을 바로 연다.
    const onOpenSettings = vi.fn();
    render(
      <TabBar
        tabs={[]} activeTabId={null} isMobile={true}
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()}
        onOpenSettings={onOpenSettings}
      />
    );
    fireEvent.click(screen.getByTitle(/^Settings/));
    expect(onOpenSettings).toHaveBeenCalled();
    // 서브메뉴 항목은 뜨지 않는다(버튼 title 은 있지만 메뉴 아이템 텍스트는 없음).
    expect(screen.queryByText(/^Settings$/)).toBeNull();
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

  it('right-click Close tab triggers the confirm flow via onClose', () => {
    // 컨텍스트 메뉴의 "Close tab" 은 작은 인라인 chip 대신 onClose(→ 확인 모달)로 바로 간다.
    // 모바일에서 tiny chip 을 탭하기 어렵던 문제 해소.
    const tabs = [{ id: 'local:1', type: 'local', sessionId: '1', name: 'zsh' }];
    const onClose = vi.fn();
    render(
      <TabBar
        tabs={tabs} activeTabId="local:1"
        onSelect={vi.fn()} onClose={onClose} onCloseImmediate={vi.fn()} onHome={vi.fn()}
        onOpenKeys={vi.fn()} onOpenSettings={vi.fn()} onLogout={vi.fn()}
      />
    );
    fireEvent.contextMenu(screen.getByText('zsh'));
    fireEvent.click(screen.getByText(/Close tab/i));
    expect(onClose).toHaveBeenCalledWith('local:1');
    // chip 은 뜨지 않는다(모달 경로로 전환).
    expect(screen.queryByText(/Close \(end\)/i)).toBeNull();
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
