import { memo } from 'react';
import { Terminal as TerminalIcon, Server, Monitor, Check, X, MoreHorizontal } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import { styles } from './tabBarStyles';

const { color, font, fontWeight } = tokens;

// 혼합 호스트 미니 타일 — 최대 개수와 캐스케이드 배치(주 타일 18px 뒤로 7px 씩 우측 오프셋).
const MAX_SECONDARY_ICONS = 2;
const MINI_TILE_BASE_LEFT_PX = 12;
const MINI_TILE_STEP_PX = 7;

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
  const paletteColor = (idx) =>
    color.dotPalette?.[(idx ?? 0) % (color.dotPalette?.length || 8)] || color.accent;
  const dotColor = tab.color_index != null ? paletteColor(tab.color_index) : color.accent;
  // pane 들이 다른 호스트로 섞인 탭 — 나머지 호스트 미니 아이콘을 캐스케이드로 겹쳐 표시
  // (App.tabsWithMeta 파생). 미니 타일은 최대 2개, 그 이상은 마지막 자리를 "+N" 칩으로.
  const secondaries = tab.secondaryIdentities || [];
  const shownSecondaries = secondaries.length > MAX_SECONDARY_ICONS
    ? secondaries.slice(0, MAX_SECONDARY_ICONS - 1)
    : secondaries;
  const overflowCount = secondaries.length - shownSecondaries.length;
  const overflowNames = overflowCount > 0
    ? secondaries.slice(shownSecondaries.length).map((s) => s.name).filter(Boolean).join(', ')
    : '';
  const miniTileCount = shownSecondaries.length + (overflowCount > 0 ? 1 : 0);
  // 미니 타일 공통 스타일 — i 번째 타일은 주 타일 우하단에서 7px 씩 우측으로 캐스케이드.
  const miniTileStyle = (i, tint) => ({
    position: 'absolute',
    left: `${MINI_TILE_BASE_LEFT_PX + MINI_TILE_STEP_PX * i}px`,
    bottom: '-2px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '13px',
    height: '13px',
    background: tint
      ? `color-mix(in srgb, ${tint} 22%, ${isActive ? 'var(--ui-base)' : 'var(--ui-mantle)'})`
      : color.surface2,
    border: `1px solid ${tint ? `${tint}66` : 'var(--ui-border-strong)'}`,
    borderRadius: '3.5px',
    color: tint || color.subtext,
    /* crust ring 으로 주/이웃 타일과 분리 — 아바타 스택처럼 "겹쳐 있음"이 읽히게. */
    boxShadow: `0 0 0 1.5px ${color.crust}`,
    opacity: isActive ? 1 : 0.8,
    zIndex: i + 1,
  });

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

      {/* 호스트 아이콘 타일 — dot 색 tint. busy 시 타일 자체는 변화 없음, 우상단 dot 만 깜빡.
          다른 호스트 pane 이 섞인 탭이면 우하단에 그 호스트들의 미니 타일을 캐스케이드로 겹쳐 표시. */}
      <span
        style={{
          position: 'relative',
          display: 'inline-flex',
          flexShrink: 0,
          width: `${18 + MINI_TILE_STEP_PX * miniTileCount}px`,
          height: '18px',
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            height: '18px',
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
        {shownSecondaries.map((s, i) => (
          <span key={`${s.kind}:${s.name}:${i}`} title={s.name} style={miniTileStyle(i, paletteColor(s.colorIndex))}>
            <HostIcon
              value={s.icon || ''}
              fallback={s.kind === 'local' ? Monitor : Server}
              size={8}
              strokeWidth={2.1}
            />
          </span>
        ))}
        {overflowCount > 0 && (
          <span
            title={overflowNames}
            style={{
              ...miniTileStyle(shownSecondaries.length, null),
              fontSize: '7px',
              fontWeight: 700,
              fontFamily: font.mono,
              letterSpacing: '-0.5px',
              lineHeight: 1,
            }}
          >
            +{overflowCount}
          </span>
        )}
      </span>
      {isPendingClose ? (
        /* 인라인 close 확인 — 탭 이름 자리를 차지. 탭 닫기 = 내부 세션 전부 종료라는 결과를
           라벨/툴팁에 명시해 "닫으면 죽나?" 혼란을 없앤다. 동작은 closeTab(skipConfirm) 그대로. */
        <>
          <span
            style={{ flex: 1, fontSize: '10px', color: color.subtext, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1 }}
            title={t?.('closeTabEndHint') || 'Session ends — running work will be lost'}
          >
            {t?.('closeTabEnd') || 'Close (end)'}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onConfirmClose?.(tab.id); }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ ...styles.miniBtn, background: color.accent, color: color.crust, border: 'none', flexShrink: 0 }}
            title={t?.('closeTabEndHint') || 'Session ends — running work will be lost'}
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
