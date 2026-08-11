import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from './TabBar';
import { tokens } from '../styles/tokens';

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

  it("closes the tab menu when the same '…' is pressed again", () => {
    // 폰에서 '…' 로 연 메뉴를 그 버튼으로 못 닫던 회귀. 바깥 누름 감지는 이 버튼을
    // 일부러 무시하므로(안 그러면 닫자마자 다시 열린다) 토글은 버튼이 직접 해야 한다.
    const tabs = [{ id: 'local:1', type: 'local', sessionId: '1', name: 'zsh' }];
    render(
      <TabBar
        tabs={tabs} activeTabId="local:1"
        onSelect={vi.fn()} onClose={vi.fn()} onCloseImmediate={vi.fn()} onHome={vi.fn()}
        onOpenSettings={vi.fn()} isMobile
      />
    );
    const more = document.querySelector('[data-more="true"]');
    fireEvent.click(more);
    expect(screen.getByText(/Close tab/i)).toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.queryByText(/Close tab/i)).toBeNull();
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

  it('renders every mixed host as an equal-size stacked tile with its name tooltip', () => {
    // pane 들이 서로 다른 호스트로 섞인 탭 — 나머지 호스트 전부가 주 타일과 같은 크기의
    // 라인 아이콘 타일로 겹쳐 뜨고, 각 타일 title 로 어느 호스트인지 바로 확인 가능.
    const tabs = [
      {
        id: 'host:1', type: 'host', hostId: 'h1', name: 'Proxmox VE', color_index: 44, icon: 'Atom',
        secondaryIdentities: [
          { kind: 'host', name: 'ArgonEON', icon: 'Server', colorIndex: 36 },
          { kind: 'host', name: 'TrueNAS Scale', icon: 'PieChart', colorIndex: 13 },
          { kind: 'local', name: 'dev-box', icon: 'Monitor', colorIndex: 24 },
        ],
      },
    ];
    render(
      <TabBar tabs={tabs} activeTabId="host:1" onSelect={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} onHome={vi.fn()} />
    );
    expect(screen.getByTitle('ArgonEON')).toBeInTheDocument();
    expect(screen.getByTitle('TrueNAS Scale')).toBeInTheDocument();
    expect(screen.getByTitle('dev-box')).toBeInTheDocument();
  });

  it('still overlap-stacks mixed-host tiles on mobile, but caps count with a +N chip', () => {
    // 모바일도 데스크탑과 같은 절반-겹침 캐스케이드를 쓰되, 탭 폭이 좁아(128~190px)
    // 타일이 무제한 늘어나면 탭 밖으로 삐져나가므로 최대 3개 + "+N" 칩으로 캡핑.
    const tabs = [
      {
        id: 'host:1', type: 'host', hostId: 'h1', name: 'Proxmox VE', color_index: 44, icon: 'Atom',
        secondaryIdentities: [
          { kind: 'host', name: 'ArgonEON', icon: 'Server', colorIndex: 36 },
          { kind: 'host', name: 'TrueNAS Scale', icon: 'PieChart', colorIndex: 13 },
          { kind: 'local', name: 'dev-box', icon: 'Monitor', colorIndex: 24 },
          { kind: 'host', name: 'Pi Cluster', icon: 'Server', colorIndex: 5 },
        ],
      },
    ];
    render(
      <TabBar
        tabs={tabs} activeTabId="host:1" isMobile={true}
        onSelect={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} onHome={vi.fn()}
      />
    );
    expect(screen.getByTitle('ArgonEON')).toBeInTheDocument();
    expect(screen.getByTitle('TrueNAS Scale')).toBeInTheDocument();
    expect(screen.getByTitle('dev-box')).toBeInTheDocument();
    // 4번째(Pi Cluster)는 개별 타일 대신 "+1" 칩으로 스택 끝에 겹쳐 합류, 칩 title 로 이름 확인.
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByTitle('Pi Cluster')).toBeInTheDocument();
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

  // ── VNC 탭 시각적 구분 (ScreenShare 글리프가 탭 색을 띤다) ──────────────────

  it('renders VNC tab with colored ScreenShare glyph and no stripe', () => {
    // VNC 탭의 활성 pane mode 가 'vnc' 이면 ScreenShare 아이콘이 탭 색(dotColor)을 직접 띤다.
    // 터미널 탭은 중립 text 색 — 이 색 차이가 "화면인지 셸인지"를 아이콘으로 읽힌다.
    // 스트라이프(inset box-shadow)는 더 이상 쓰지 않는다.
    const neutralText = tokens.color.text;

    const vncTab = {
      id: 'vnc:h1:1', type: 'host', hostId: 'h1', name: 'myhost · :2', color_index: 0,
      panes: [{ id: 'p1', mode: 'vnc', hostId: 'h1', display: 2 }],
      activePaneId: 'p1',
    };
    const termTab = {
      id: 'host:h1:2', type: 'host', hostId: 'h1', name: 'myhost', color_index: 0,
      panes: [{ id: 'p2', mode: 'terminal', hostId: 'h1', sessionId: 's1' }],
      activePaneId: 'p2',
    };
    render(
      <TabBar tabs={[vncTab, termTab]} activeTabId="vnc:h1:1"
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()} />
    );

    // VNC 칩은 스트라이프가 없다 (제거됨).
    const vncChip = screen.getByText('myhost · :2').parentElement;
    const vncShadow = vncChip.style.boxShadow;
    expect(vncShadow).not.toContain('inset 3px');

    // VNC ScreenShare 아이콘을 감싼 타일 span 의 color 가 중립 text 가 아님 (dotColor 가 실림).
    // jsdom 은 hex 를 rgb() 로 변환하므로 직접 비교 대신 "중립이 아님"으로 검증.
    const vncSvg = vncChip.querySelector('svg');
    expect(vncSvg).toBeTruthy();
    const vncTileColor = vncSvg.parentElement.style.color;
    expect(vncTileColor).toBeTruthy();
    expect(vncTileColor).not.toBe(neutralText);
    // dotColor(#89b4fa) → jsdom 은 rgb(137, 180, 250) 로 변환. hex 접두사만 추출해 비교.
    expect(vncTileColor).toMatch(/137.*180.*250/i);
  });

  it('inactive VNC tab uses muted glyph color (no raw dotColor)', () => {
    // 비활성 VNC 탭은 원색 글리프를 쓰지 않는다 — 기존 글리프 규칙(muted tint)을 따른다.
    const vncTab = {
      id: 'vnc:h1:1', type: 'host', hostId: 'h1', name: 'myhost · :2', color_index: 0,
      panes: [{ id: 'p1', mode: 'vnc', hostId: 'h1', display: 2 }],
      activePaneId: 'p1',
    };
    render(
      <TabBar tabs={[vncTab]} activeTabId="other-tab"
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()} />
    );

    const vncChip = screen.getByText('myhost · :2').parentElement;
    const vncSvg = vncChip.querySelector('svg');
    const vncTileColor = vncSvg.parentElement.style.color;
    // 비활성이면 color-mix 형태여야 하고, 순수 dotColor(단일 hex)가 아니어야 한다.
    expect(vncTileColor).toContain('color-mix');
  });

  it('VNC tab ignores host custom icon, always renders ScreenShare', () => {
    // 호스트에 커스텀 아이콘(emoji 등)이 있어도 VNC 탭은 항상 ScreenShare 글리프를 쓴다.
    // "이것은 셸이 아니라 화면이다"를 형태로 읽히기 위해 HostIcon 경로를 바이패스한다.
    const vncTab = {
      id: 'vnc:h1:1', type: 'host', hostId: 'h1', name: 'myhost · :2', color_index: 0,
      icon: '🚀',
      panes: [{ id: 'p1', mode: 'vnc', hostId: 'h1', display: 2 }],
      activePaneId: 'p1',
    };
    render(
      <TabBar tabs={[vncTab]} activeTabId="vnc:h1:1"
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()} />
    );

    const vncChip = screen.getByText('myhost · :2').parentElement;
    // ScreenShare SVG 가 렌더되어야 한다.
    const vncSvg = vncChip.querySelector('svg');
    expect(vncSvg).toBeTruthy();
    // 커스텀 emoji 아이콘은 렌더되지 않아야 한다 (HostIcon 바이패스).
    expect(vncChip.textContent).not.toContain('🚀');
  });

  describe('right action group', () => {
    const renderActions = (overrides = {}) => render(
      <TabBar
        tabs={[{ id: 'local:1', type: 'local', name: 'terminal', color_index: 0 }]}
        activeTabId="local:1"
        onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()} onOpenSettings={vi.fn()}
        onEqualizePanes={vi.fn()} onOpenCommandInput={vi.fn()} onBroadcastToggle={vi.fn()}
        {...overrides}
      />
    );

    it('locks the rail actions while the focused terminal is still connecting', () => {
      renderActions({ actionsDisabled: true });
      expect(screen.getByTitle('Quick Input')).toBeDisabled();
    });

    it('keeps Equalize panes in the settings menu only — never twice on screen', () => {
      // 한 동작은 한 자리에만. 레일에도 두면 어느 쪽이 진짜인지 매번 고민하게 된다.
      renderActions();
      expect(screen.queryByTitle('Equalize panes')).not.toBeInTheDocument();
    });

    it('keeps Broadcast clickable while it is on, even when actions are locked', () => {
      // 켜진 채로 잠기면 끌 방법이 없어져 입력이 계속 다른 pane 으로 퍼진다.
      const onBroadcastToggle = vi.fn();
      renderActions({ actionsDisabled: true, isBroadcasting: true, onBroadcastToggle });

      const btn = screen.getByTitle('Broadcast off');
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(onBroadcastToggle).toHaveBeenCalledTimes(1);
    });

    it('locks Broadcast while it is off and the terminal is still connecting', () => {
      renderActions({ actionsDisabled: true, isBroadcasting: false });
      expect(screen.getByTitle('Broadcast')).toBeDisabled();
    });

    it('enables every rail action once the terminal is ready', () => {
      renderActions({ actionsDisabled: false });
      expect(screen.getByTitle('Quick Input')).not.toBeDisabled();
      expect(screen.getByTitle('Broadcast')).not.toBeDisabled();
    });

    it('hides the desktop-only actions on mobile', () => {
      renderActions({ isMobile: true });

      expect(screen.queryByTitle('Quick Input')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Broadcast')).not.toBeInTheDocument();
    });

    it('still shows Broadcast on mobile while it is on, so it can be turned off', () => {
      // 이 버튼이 유일한 전역 off 스위치다 — 데스크탑에서 켠 채 폰으로 열면 끌 방법이 없어진다.
      const onBroadcastToggle = vi.fn();
      renderActions({ isMobile: true, isBroadcasting: true, onBroadcastToggle });

      const btn = screen.getByTitle('Broadcast off');
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(onBroadcastToggle).toHaveBeenCalledTimes(1);
    });
  });
});
