import { memo } from 'react';
import { Terminal as TerminalIcon, Server, Monitor, Check, X, MoreHorizontal } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import { styles } from './tabBarStyles';

const { color, font, fontWeight } = tokens;

export const Tab = memo(({
  tab, index, isFirst = false, isActive, isBusy = false, isDragging = false, isDragOver = false,
  isMobile = false,
  touchProps = null, // useTouchDragReorder.getItemProps(tab.id) — 모바일 드래그/터치 핸들러 일괄.
  isPendingClose = false,
  onSelect, onClose, onRequestClose, onConfirmClose, onCancelClose, onContextMenu, onMore,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  t,
}) => {
  const isHostTab = tab.type === 'host' || tab.hostId;
  const isLocalTab = tab.type === 'local';
  const Icon = isHostTab ? Server : (isLocalTab ? Monitor : TerminalIcon);
  const dotColor = tab.color_index != null
    ? color.dotPalette?.[tab.color_index % (color.dotPalette?.length || 8)] || color.accent
    : color.accent;

  return (
    <div
      // 모바일은 HTML5 draggable 대신 useTouchDragReorder 의 터치 이벤트를 spread.
      // 모바일 컨텍스트 메뉴는 우측 More 버튼으로 접근 (long-press 는 이제 드래그 진입).
      draggable={!isMobile}
      data-tab-id={tab.id}
      {...(touchProps || {})}
      onDragStart={(e) => onDragStart?.(tab.id, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver?.(tab.id, e)}
      onDragLeave={() => onDragLeave?.(tab.id)}
      onDrop={(e) => onDrop?.(tab.id, e)}
      onContextMenu={(e) => onContextMenu?.(tab.id, e)}
      style={{
        ...styles.tab,
        ...(isMobile ? styles.tabMobile : null),
        background: isDragOver
          ? `color-mix(in srgb, ${color.accent} 14%, ${isActive ? 'var(--ui-base)' : 'var(--ui-mantle)'})`
          : (isActive ? 'var(--ui-base)' : 'var(--ui-mantle)'),
        color: isActive ? color.text : color.muted,
        fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
        border: `1px solid ${isActive ? 'var(--ui-border-strong)' : 'var(--ui-border)'}`,
        // 하단 라인은 TabBar 자체 borderBottom 하나만 쓰게 한다.
        // inactive tab 의 개별 bottom border 가 보이면 바닥선 위에 떠 보인다.
        borderBottom: `1px solid ${isActive ? 'var(--ui-base)' : 'var(--ui-mantle)'}`,
        boxShadow: isDragOver ? `inset 0 0 0 2px ${color.accent}` : 'none',
        flex: isMobile ? styles.tabMobile.flex : styles.tab.flex,
        maxWidth: isMobile ? styles.tabMobile.maxWidth : styles.tab.maxWidth,
        marginLeft: isFirst ? 0 : styles.tab.marginLeft,
        opacity: isDragging ? 0.4 : 1,
        cursor: isMobile ? 'pointer' : 'grab',
        position: 'relative',
        zIndex: isDragOver ? 2 : (isActive ? 1 : 0),
        transition: 'background 150ms, color 150ms, box-shadow 120ms',
      }}
      onClick={() => onSelect?.(tab.id)}
      /* 휠 클릭(가운데 버튼)으로 탭 닫기 확인 트리거 */
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          onRequestClose?.(tab.id);
        }
      }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } }}
      onMouseEnter={(e) => {
        if (isMobile) return;
        if (!isActive) { e.currentTarget.style.background = 'var(--ui-surface0)'; e.currentTarget.style.color = color.subtext; }
      }}
      onMouseLeave={(e) => {
        if (isMobile) return;
        if (!isActive) { e.currentTarget.style.background = 'var(--ui-mantle)'; e.currentTarget.style.color = color.muted; }
      }}
    >
      {/* Ctrl+N 번호 — 박스 없이 모노 숫자만. 알림 뱃지 느낌 없이 식별만. */}
      {index != null && index <= 9 && (
        <span
          aria-hidden
          title={`${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})`}
          style={{
            fontFamily: font.mono,
            fontSize: '10px',
            fontWeight: 600,
            color: isActive ? color.subtext : color.muted,
            opacity: isActive ? 0.95 : 0.75,
            flexShrink: 0,
            lineHeight: 1,
            letterSpacing: 0,
            width: '10px',
            textAlign: 'center',
          }}
        >
          {index}
        </span>
      )}

      {/* 호스트 아이콘 타일 — dot 색 tint. busy 시 타일 자체는 변화 없음, 우상단 dot 만 깜빡. */}
      <span
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '18px',
          height: '18px',
          flexShrink: 0,
          background: isActive ? `${dotColor}26` : `${dotColor}12`,
          border: `1px solid ${isActive ? `${dotColor}77` : `${dotColor}33`}`,
          borderRadius: '4px',
          color: isActive ? color.text : dotColor,
          opacity: isActive ? 1 : 0.85,
        }}
      >
        <HostIcon value={tab.icon || ''} fallback={Icon} size={11} strokeWidth={1.9} />
        {isBusy && (
          <span
            className="iterm-tab-busy-dot"
            aria-hidden
            style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: dotColor,
              /* crust outline 으로 탭/이웃 탭과 분리해 어디서든 또렷이. 부드러운 opacity 박동. */
              boxShadow: `0 0 0 1.5px ${color.crust}`,
              pointerEvents: 'none',
            }}
          />
        )}
      </span>
      {isPendingClose ? (
        /* 인라인 close 확인 — 탭 이름 자리를 차지 */
        <>
          <span style={{ flex: 1, fontSize: '10px', color: color.subtext, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1 }}>
            {t?.('closeTab') || 'Close?'}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onConfirmClose?.(tab.id); }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ ...styles.miniBtn, background: color.accent, color: color.crust, border: 'none', flexShrink: 0 }}
            title={t?.('confirm') || 'Confirm'}
          >
            <Check size={10} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancelClose?.(); }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ ...styles.miniBtn, background: 'transparent', color: color.subtext, flexShrink: 0 }}
            title={t?.('cancel') || 'Cancel'}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </>
      ) : (
        <span style={styles.tabName} title={tab.name}>{tab.name}</span>
      )}

      {/* More 버튼 — 활성 탭에서만 노출, close 확인 중에는 숨김 */}
      {isActive && !isPendingClose && (
        <button
          data-more="true"
          onClick={(e) => { e.stopPropagation(); onMore?.(tab.id, e); }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          style={{
            ...styles.miniBtn,
            opacity: 1,
            color: color.subtext,
          }}
          onMouseEnter={(e) => { if (isMobile) return; e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
          onMouseLeave={(e) => { if (isMobile) return; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
          title={t?.('more') || 'More'}
        >
          <MoreHorizontal size={11} strokeWidth={2} />
        </button>
      )}

    </div>
  );
});
