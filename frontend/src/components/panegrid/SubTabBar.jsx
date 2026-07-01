/**
 * 분할(split) pane 들의 서브 탭바 — 메인 TabBar 아래 한 단계 위계.
 * 활성 서브탭 자동 스크롤, 터치 드래그 재정렬, 잘린 라벨 툴팁 포함.
 * PaneGrid.jsx 에서 로직 변경 없이 추출.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Server, Monitor, Plus, MoreHorizontal, Edit3, Trash2 } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import themes from '../../styles/themes';
import { buildThemeUI } from '../../styles/themeUI';
import HostIcon from '../../utils/hostIcons';
import useTouchDragReorder from '../../hooks/useTouchDragReorder';
import { MenuItem } from '../tabBar/TabBarMenus';
import { glassMenuStyle } from '../../styles/glass';

const { color, font, fontSize, fontWeight } = tokens;

const SubTabBar = ({
  panes, activePaneId, hosts, busyPaneIds = null,
  settings = {}, tabColorIndex, activeThemeId = null, onSelect, onClose, onReorder = null, onRenamePane = null, onSplitPane = null, t,
}) => {
  const scrollRef = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { paneId, x, y }
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });
  const [ctxMeasured, setCtxMeasured] = useState(false);
  const ctxRef = useRef(null);
  const ctxCloseRef = useRef(() => setCtxMenu(null));
  ctxCloseRef.current = () => setCtxMenu(null);
  // Full-label tooltip for truncated pane names
  const [labelTip, setLabelTip] = useState(null);
  const labelTipTimer = useRef(null);
  const showLabelTip = (label, el) => {
    if (!label) return;
    const rect = el.getBoundingClientRect();
    setLabelTip({ label, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    clearTimeout(labelTipTimer.current);
    labelTipTimer.current = setTimeout(() => setLabelTip(null), 2000);
  };
  const touchReorder = useTouchDragReorder({
    dataAttr: 'data-pane-id',
    scrollContainerRef: scrollRef,
    onReorder,
  });

  const tabBarAccent = tabColorIndex != null
    ? (color.dotPalette || ['#89b4fa'])[tabColorIndex % (color.dotPalette || ['#89b4fa']).length]
    : color.accent;
  const activeTheme = themes[activeThemeId || settings?.theme] || themes.catppuccin;
  const subUi = buildThemeUI(activeTheme);

  // 메인 TabBar 와 동일 패턴 — 활성 서브탭이 시야 밖이면 자동 스크롤. 모바일에서 pane 많을 때 핵심.
  useEffect(() => {
    if (!activePaneId) return undefined;
    const container = scrollRef.current;
    if (!container) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector(`[data-pane-id="${CSS.escape(activePaneId)}"]`);
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const margin = 8;
      if (eRect.left < cRect.left + margin) {
        container.scrollBy({ left: eRect.left - cRect.left - margin, behavior: 'smooth' });
      } else if (eRect.right > cRect.right - margin) {
        container.scrollBy({ left: eRect.right - cRect.right + margin, behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activePaneId, panes.length]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handle = (e) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target) && !e.target?.closest?.('[data-pane-more="true"]')) {
        ctxCloseRef.current();
      }
    };
    const handleKey = (e) => { if (e.key === 'Escape') ctxCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); document.removeEventListener('keydown', handleKey); };
  }, [!!ctxMenu]);

  // 메뉴 엘리먼트를 잰 뒤 뷰포트 안으로 밀어넣는다. measured 가 false 인 동안 opacity:0
  // 으로 렌더해 자리를 잡고, 위치가 확정되면 보여준다 (한 프레임 점멸 방지 — AGENTS.md #1).
  useEffect(() => {
    if (!ctxMenu) { setCtxMeasured(false); return; }
    if (!ctxRef.current) return;
    const rect = ctxRef.current.getBoundingClientRect();
    const margin = 8;
    let nx = ctxMenu.x;
    let ny = ctxMenu.y;
    if (nx + rect.width > window.innerWidth - margin) nx = window.innerWidth - rect.width - margin;
    if (nx < margin) nx = margin;
    if (ny + rect.height > window.innerHeight - margin) ny = window.innerHeight - rect.height - margin;
    if (ny < margin) ny = margin;
    setCtxPos({ x: nx, y: ny });
    setCtxMeasured(true);
  }, [ctxMenu]);

  return (
    <>
      <style>{`
        .iterm-subtabbar-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .iterm-subtabbar-scroll::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        @keyframes iterm-subtab-busy-blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        .iterm-subtab-busy-dot { animation: iterm-subtab-busy-blink 1.1s ease-in-out infinite; }
      `}</style>
      {labelTip && createPortal(
        <div style={{
          position: 'fixed',
          top: labelTip.y,
          left: Math.max(8, Math.min(window.innerWidth - 8, labelTip.x)),
          transform: 'translateX(-50%)',
          background: subUi.surface1 || subUi.surface0,
          border: `1px solid ${subUi.border}`,
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '12px',
          fontFamily: font.sans,
          color: subUi.text,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 300000,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {labelTip.label}
        </div>,
        document.body
      )}
      {ctxMenu && createPortal(
        <div
          ref={ctxRef}
          style={{
            position: 'fixed',
            top: ctxPos.y,
            left: ctxPos.x,
            ...glassMenuStyle(),
            zIndex: 300000,
            minWidth: '130px',
            fontFamily: font.sans,
            opacity: ctxMeasured ? 1 : 0,
          }}
        >
          {onRenamePane && (
            <MenuItem
              icon={Edit3}
              onClick={() => { const id = ctxMenu.paneId; ctxCloseRef.current(); onRenamePane(id); }}
            >
              {t?.('rename') || 'Rename'}
            </MenuItem>
          )}
          <MenuItem
            danger
            icon={Trash2}
            onClick={() => { const id = ctxMenu.paneId; ctxCloseRef.current(); onClose(id); }}
          >
            {t?.('killSession') || 'End session'}
          </MenuItem>
        </div>,
        document.body
      )}
      <div
        ref={scrollRef}
        className="iterm-subtabbar-scroll"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: '34px',
          background: `linear-gradient(180deg, ${subUi.mantle}, ${subUi.crust})`,
          borderBottom: `1px solid ${subUi.border}`,
          overflowX: 'auto',
          overflowY: 'hidden',
          flexShrink: 0,
          padding: '0 4px 0 6px',
          gap: '0',
          fontFamily: font.sans,
        }}
      >
        {panes.map((pane, idx) => {
          const isFirst = idx === 0;
          const isActive = pane.id === activePaneId;
          const isEmpty = !pane.sessionId && !pane.hostId;
          const isLocal = !!pane.sessionId && !pane.hostId;
          const isBusy = !!busyPaneIds && busyPaneIds.has(pane.id) && !isEmpty;
          const host = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
          const label = pane.manualName ? pane.name
            : (pane.name || host?.name
              || (isLocal ? ((settings.localName || '').trim() || (t?.('thisMachine') || 'Local')) : (t?.('startSession') || 'Empty')));
          const iconValue = host?.icon || (isLocal ? (settings.localIcon || '') : '');
          const FallbackIcon = host ? Server : (isLocal ? Monitor : Plus);
          const paneTheme = themes[pane.themeOverride || settings?.theme] || activeTheme;
          const paneUi = buildThemeUI(paneTheme);
          const paneBorderStrong = paneUi['border-strong'] || paneUi.border;
          const hostAccent = host?.color_index != null
            ? color.dotPalette[(host.color_index ?? 0) % color.dotPalette.length]
            : null;
          const localAccent = isLocal && settings?.localColorIndex != null
            ? color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length]
            : null;
          const paneAccent = hostAccent || localAccent || paneUi.accent || tabBarAccent;
          const tabBg = isActive ? paneUi.base : subUi.mantle;
          const isDragging = touchReorder.draggingId === pane.id;
          const isDragOver = touchReorder.dragOverId === pane.id && touchReorder.draggingId && touchReorder.draggingId !== pane.id;
          const touchProps = onReorder ? touchReorder.getItemProps(pane.id) : null;
          return (
            <div
              key={pane.id}
              title={label}
              data-pane-id={pane.id}
              {...(touchProps || {})}
              onClick={(e) => {
                if (isActive) showLabelTip(label, e.currentTarget);
                onSelect(pane.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ paneId: pane.id, x: e.clientX, y: e.clientY });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '0 8px 0 10px',
                height: 'calc(100% + 1px)',
                minWidth: '140px',
                maxWidth: '200px',
                background: isDragOver ? `color-mix(in srgb, ${color.accent} 14%, ${tabBg})` : tabBg,
                color: isActive ? paneUi.text : paneUi.muted,
                fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
                fontSize: fontSize['12'],
                border: `1px solid ${isActive ? paneBorderStrong : subUi.border}`,
                borderBottom: `1px solid ${tabBg}`,
                boxShadow: isDragOver ? `inset 0 0 0 2px ${color.accent}` : 'none',
                borderRadius: 0,
                boxSizing: 'border-box',
                marginLeft: isFirst ? 0 : '-1px',
                flex: '0 0 150px',
                cursor: 'pointer',
                opacity: isDragging ? 0.4 : 1,
                userSelect: 'none',
                position: 'relative',
                zIndex: isDragOver ? 2 : (isActive ? 1 : 0),
                transition: 'background 150ms, color 150ms, box-shadow 120ms',
              }}
            >
              {idx < 9 && (
                <span
                  aria-hidden
                  style={{
                    fontFamily: font.mono,
                    fontSize: '10px',
                    fontWeight: 600,
                    color: isActive ? paneUi.subtext : paneUi.muted,
                    opacity: isActive ? 0.95 : 0.75,
                    flexShrink: 0,
                    lineHeight: 1,
                    letterSpacing: 0,
                    width: '10px',
                    textAlign: 'center',
                  }}
                >
                  {idx + 1}
                </span>
              )}
              {/* 서브탭은 메인탭보다 한 단계 아래 위계 — 아이콘 박스(테두리/배경) 제거.
                  순수 아이콘 + 색만 입혀 가볍게, 메인탭과 시각적 차별. */}
              <span
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  flexShrink: 0,
                  color: isActive ? paneAccent : `${paneAccent}cc`,
                  opacity: isActive ? 1 : 0.75,
                }}
              >
                <HostIcon value={iconValue} fallback={FallbackIcon} size={13} strokeWidth={1.9} />
                {isBusy && (
                  <span
                    className="iterm-subtab-busy-dot"
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: paneAccent,
                      boxShadow: `0 0 0 1.5px ${subUi.crust}`,
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  letterSpacing: '0.005em',
                }}
              >
                {label}
              </span>
              {/* 더보기(⋮) — 활성 서브탭에만. 모바일에선 우클릭이 안 되므로 이 버튼으로
                  rename/close 컨텍스트 메뉴에 접근한다. 메인탭(MoreHorizontal) 과 동일 패턴. */}
              {isActive && (
                <button
                  data-pane-more="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setCtxMenu({ paneId: pane.id, x: r.right, y: r.bottom + 4 });
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  title={t?.('more') || 'More'}
                  style={{
                    flexShrink: 0,
                    width: '16px',
                    height: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: paneUi.subtext,
                    cursor: 'pointer',
                    borderRadius: '3px',
                    padding: 0,
                  }}
                >
                  <MoreHorizontal size={12} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default SubTabBar;
