import { memo } from 'react';
import { Terminal as TerminalIcon, Server, Monitor, Check, X, MoreHorizontal } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import { styles } from './tabBarStyles';

const { color, font, fontWeight } = tokens;

// 혼합 호스트 타일 스택 — 모든 타일 동일 크기, 절반씩 겹치는 아바타 스택.
// 모바일/데스크탑 둘 다 같은 겹침 스택이되, 모바일은 탭 폭이 좁아(128~190px)
// 타일/겹침 폭을 줄이고 개수를 캡핑(+N 칩)해 탭 밖으로 삐져나가지 않게 한다.
const HOST_TILE_PX = 18;
const HOST_TILE_OVERLAP_STEP_PX = 9;
const HOST_TILE_PX_MOBILE = 14;
const HOST_TILE_OVERLAP_STEP_MOBILE_PX = 7;
const HOST_TILE_MAX_VISIBLE_MOBILE = 3;

export const Tab = memo(({
  tab, index, isFirst = false, isActive, isBusy = false, isDragging = false, isDragOver = false,
  isMobile = false,
  touchProps = null, // useTouchDragReorder.getItemProps(tab.id) — 모바일 드래그/터치 핸들러 일괄.
  isPendingClose = false,
  onSelect, onClose, onRequestClose, onConfirmClose, onCancelClose, onContextMenu, onMore,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  t,
}) => {
  // 주 타일 폴백 글리프는 탭 타입이 아니라 활성 pane 정체성(primaryKind)을 따라간다 —
  // 호스트 탭이라도 활성 pane 이 로컬이면 Monitor. (App.tabsWithMeta 파생, 없으면 탭 타입 폴백)
  const primaryKind = tab.primaryKind
    || ((tab.type === 'host' || tab.hostId) ? 'host' : (tab.type === 'local' ? 'local' : null));
  const Icon = primaryKind === 'host' ? Server : (primaryKind === 'local' ? Monitor : TerminalIcon);
  const paletteColor = (idx) =>
    color.dotPalette?.[(idx ?? 0) % (color.dotPalette?.length || 8)] || color.accent;
  const dotColor = tab.color_index != null ? paletteColor(tab.color_index) : color.accent;
  // 탭 안의 서브탭(pane) 개수 — 2개 이상(분할)일 때만 busy-dot 자리에 숫자 뱃지로 노출.
  // busy 면 뱃지가 그대로 깜빡여(같은 애니메이션) 활동 신호도 겸한다.
  const paneCount = tab.panes?.length || 1;
  const showPaneCount = paneCount > 1;
  // pane 들이 다른 호스트로 섞인 탭 — 나머지 호스트들도 주 타일과 같은 크기의 라인 아이콘
  // 타일로, 절반씩 겹치는 아바타 스택으로 전부 표시 (App.tabsWithMeta 파생).
  // 앞(왼쪽)이 활성 pane 호스트, 뒤로 갈수록 나머지. 각 타일 색 = 그 호스트의 dot 색.
  const secondaries = tab.secondaryIdentities || [];
  // 모바일은 탭 폭이 좁으니 최대 N개까지만 겹쳐 보여주고, 그 이상은 "+N" 칩으로 스택 끝에 합류.
  const visibleSecondaries = isMobile ? secondaries.slice(0, HOST_TILE_MAX_VISIBLE_MOBILE) : secondaries;
  const hiddenCount = secondaries.length - visibleSecondaries.length;
  const hiddenNames = hiddenCount > 0
    ? secondaries.slice(visibleSecondaries.length).map((s) => s.name).filter(Boolean).join(', ')
    : '';
  const tileSize = isMobile ? HOST_TILE_PX_MOBILE : HOST_TILE_PX;
  const overlapStep = isMobile ? HOST_TILE_OVERLAP_STEP_MOBILE_PX : HOST_TILE_OVERLAP_STEP_PX;
  const iconSize = isMobile ? 9 : 11;
  // 스택에 실제로 그려지는 타일 총 개수(보이는 호스트 + "+N" 칩 자체 1개).
  const stackedCount = visibleSecondaries.length + (hiddenCount > 0 ? 1 : 0);
  const tabBase = isActive ? 'var(--ui-base)' : 'var(--ui-mantle)';
  // 스택 타일은 전부 완전 불투명이어야 한다 — 알파 배경/테두리나 opacity 를 쓰면
  // 겹친 아래 타일이 비쳐 색이 섞여 보인다. 톤 조절은 전부 opaque color-mix 로.
  const tileBackground = (tint) =>
    `color-mix(in srgb, ${tint} ${isActive ? 22 : 14}%, ${tabBase})`;
  const tileBorder = (tint) =>
    `1px solid color-mix(in srgb, ${tint} ${isActive ? 47 : 22}%, ${tabBase})`;
  // i 번째(0=활성 뒤 첫 호스트) 타일 — 주 타일과 동일 스타일, 절반씩 우측 캐스케이드.
  const stackTileStyle = (i, tint) => ({
    position: 'absolute',
    left: `${overlapStep * (i + 1)}px`,
    top: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${tileSize}px`,
    height: `${tileSize}px`,
    background: tileBackground(tint),
    border: tileBorder(tint),
    borderRadius: '4px',
    color: tint,
    /* crust ring 으로 이웃 타일과 분리 — "겹쳐 있음"이 읽히게. */
    boxShadow: `0 0 0 1.5px ${color.crust}`,
    zIndex: stackedCount - i, // 앞 타일이 위, 뒤로 갈수록 아래로 깔림
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
          다른 호스트 pane 이 섞인 탭이면 같은 크기 타일들이 절반씩 겹치는 스택으로 표시.
          모바일은 타일/겹침 폭을 줄이고 최대 개수를 캡핑(+N 칩)해 좁은 탭 폭 안에 들어오게 한다. */}
      <span
        style={{
          position: 'relative',
          display: 'inline-flex',
          flexShrink: 0,
          width: `${tileSize + overlapStep * stackedCount}px`,
          height: `${tileSize}px`,
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: `${tileSize}px`,
            height: `${tileSize}px`,
            background: tileBackground(dotColor),
            border: tileBorder(dotColor),
            borderRadius: '4px',
            color: isActive ? color.text : dotColor,
            /* 스택일 때 뒤 타일과 분리되는 crust ring. 단일 타일이면 없음(기존 모양 유지). */
            boxShadow: secondaries.length ? `0 0 0 1.5px ${color.crust}` : 'none',
            zIndex: stackedCount + 1,
          }}
        >
          <HostIcon value={tab.icon || ''} fallback={Icon} size={iconSize} strokeWidth={1.9} />
          {showPaneCount ? (
            /* 서브탭 개수 뱃지 — busy-dot 자리(우상단). busy 면 같은 blink 애니메이션으로 깜빡인다. */
            <span
              className={isBusy ? 'iterm-tab-busy-dot' : undefined}
              aria-hidden
              title={`${paneCount} ${t?.('panesInTab') || 'panes'}`}
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                minWidth: '9px',
                height: '9px',
                padding: '0 1px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '5px',
                background: dotColor,
                color: color.crust,
                fontSize: '6.5px',
                fontWeight: fontWeight.semibold,
                fontFamily: font.mono,
                lineHeight: 1,
                boxShadow: `0 0 0 1px ${color.crust}`,
                pointerEvents: 'none',
              }}
            >
              {/* 모노 숫자가 baseline 위로 살짝 떠 보여서(위로 쏠림) 시각 중앙에 맞게 아래로 미세 보정. */}
              <span style={{ display: 'block', lineHeight: 1, transform: 'translateY(0.5px)' }}>{paneCount}</span>
            </span>
          ) : (isBusy && (
            <span
              className="iterm-tab-busy-dot"
              aria-hidden
              style={{
                position: 'absolute',
                /* 개수 뱃지와 동일한 자리·크기(footprint) — 1없는 busy 점도 뱃지와 크기 맞춤. */
                top: '-4px',
                right: '-4px',
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                background: dotColor,
                /* crust outline 으로 탭/이웃 탭과 분리해 어디서든 또렷이. 부드러운 opacity 박동. */
                boxShadow: `0 0 0 1px ${color.crust}`,
                pointerEvents: 'none',
              }}
            />
          ))}
        </span>
        {visibleSecondaries.map((s, i) => (
          <span key={`${s.kind}:${s.name}:${i}`} title={s.name} style={stackTileStyle(i, paletteColor(s.colorIndex))}>
            <HostIcon
              value={s.icon || ''}
              fallback={s.kind === 'local' ? Monitor : Server}
              size={iconSize}
              strokeWidth={1.9}
            />
          </span>
        ))}
        {hiddenCount > 0 && (
          <span
            title={hiddenNames}
            style={{ ...stackTileStyle(visibleSecondaries.length, color.muted), fontSize: '8px', fontWeight: fontWeight.semibold, lineHeight: 1 }}
          >
            +{hiddenCount}
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
