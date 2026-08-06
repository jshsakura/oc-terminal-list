import { memo } from 'react';
import { Terminal as TerminalIcon, Server, Monitor, ScreenShare, Check, X, MoreHorizontal } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import { styles } from './tabBarStyles';
import { numberTileStyle } from '../../styles/numberTile';

const { color, font, fontWeight } = tokens;

// 혼합 호스트 타일 스택 — 모든 타일 동일 크기, 절반씩 겹치는 아바타 스택.
// 모바일/데스크탑 둘 다 같은 겹침 스택이되, 모바일은 탭 폭이 좁아(128~190px)
// 타일/겹침 폭을 줄이고 개수를 캡핑(+N 칩)해 탭 밖으로 삐져나가지 않게 한다.
// 24px 칩 안에 18px 타일은 위아래 3px 만 남아 꽉 찬 느낌이었다 — 16px 로 낮춰 4px 확보.
// (겹침 스텝은 늘 타일의 절반)
const HOST_TILE_PX = 16;
const HOST_TILE_OVERLAP_STEP_PX = 8;
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
  // VNC(원격 데스크탑) 탭 — 활성 pane 의 mode 가 'vnc' 이면 ScreenShare 글리프를 쓴다.
  // 호스트 커스텀 아이콘(tab.icon)을 무시하고 항상 ScreenShare — "이것은 셸이 아니라 화면이다"를
  // 아이콘으로 읽힌다. 색은 dotColor 경로를 타서 호스트별 색을 따라간다.
  const _activePane = tab.panes?.find((p) => p.id === tab.activePaneId) || tab.panes?.[0];
  const isVnc = _activePane?.mode === 'vnc';
  const Icon = isVnc
    ? ScreenShare
    : (primaryKind === 'host' ? Server : (primaryKind === 'local' ? Monitor : TerminalIcon));
  const paletteColor = (idx) =>
    color.dotPalette?.[(idx ?? 0) % (color.dotPalette?.length || 8)] || color.accent;
  const dotColor = tab.color_index != null ? paletteColor(tab.color_index) : color.accent;
  // 우상단 마크 하나가 **개수 + 에이전트 상태 + 출력 활동**을 겸한다(별도 점 없음).
  //  - 내용: pane 2개+면 개수 숫자, 1개면 점 (1세션엔 숫자 대신 점만).
  //  - 색: permission(손 기다림)만 빨강, 그 외엔 탭 색.
  //  - 깜빡임: working(돌는 중) 또는 출력 활동(busy). permission 은 정적으로 또렷하게.
  //  - idle + 단일 pane 이면 아무것도 안 그린다(원래 philosophy — 평소엔 조용).
  const paneCount = tab.panes?.length || 1;
  const showPaneCount = paneCount > 1;
  const isPermission = tab.agentStatus === 'permission';
  const isWorking = tab.agentStatus === 'working';
  const showStatusMark = showPaneCount || isPermission || isWorking || isBusy;
  const markTint = isPermission ? color.danger : dotColor;
  const markPulse = (isWorking || isBusy) && !isPermission;
  // 마크에 글자가 들어가나(permission '!' 또는 개수 숫자) — 그러면 알약형, 아니면 점.
  // permission 은 '!' 를 우선한다: 개수보다 "너 결정 기다림" 이 급하다.
  const hasMarkContent = isPermission || showPaneCount;
  const markLabel = isPermission
    ? (t?.('agentNeedsYou') || 'Waiting for you')
    : isWorking
      ? (t?.('agentWorking') || 'Agent working')
      : (showPaneCount ? `${paneCount} ${t?.('panesInTab') || 'panes'}` : '');
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
  // 칩 모델 — 세 단계가 **위로** 쌓인다: 바(crust +6%) < 비활성 칩(surface0 +10%) < 활성 칩(surface2 +20%).
  // 비활성을 투명으로 두면 탭 경계가 통째로 사라져 상자 보더가 있던 때보다 오히려 뭉갠다
  // (특히 탭이 가로를 꽉 채울 때). mantle 로 눌러봐도 바와 2.5% 차이뿐이라 안 읽힌다 —
  // 모든 칩이 바보다 밝게 떠 있고, 그중 활성이 한 단계 더 밝은 구조라야 보더 없이 읽힌다.
  // 활성은 확실히 띄우고(surface2 +20%), 비활성은 바(crust +6%) 바로 위에 살짝만 얹는다
  // (+8.2%). 비활성까지 또렷하면 탭 줄 전체가 무거워진다 — 면은 "있다" 정도만.
  // 트랙(움푹한 스트립) 안에서 **활성만 떠오른다**. 비활성은 트랙 면 그대로 두고,
  // 호버에서만 살짝 밝아진다 — 눌린 자리/떠 있는 자리가 형태로 구분되므로 비활성까지
  // 칠하면 트랙이 다시 빈틈없는 덩어리가 된다.
  const tabBase = isActive
    ? 'var(--ui-surface2)'
    : 'color-mix(in srgb, var(--ui-surface0) 55%, var(--ui-crust))';
  /* 타일과 링은 **언제나 불투명한 면** 위에서 섞는다. 알파 위에 알파를 섞으면 숫자 타일이
     비쳐 뒤가 올라오고, `0 0 0 1.5px transparent` 링은 아예 안 그려져 겹친 스택 타일이
     서로 붙어 보인다. 지금은 칩 배경이 곧 그 면이다. */
  const tileBase = tabBase;
  // 스택 타일은 전부 완전 불투명이어야 한다 — 알파 배경/테두리나 opacity 를 쓰면
  // 겹친 아래 타일이 비쳐 색이 섞여 보인다. 톤 조절은 전부 opaque color-mix 로.
  const tileBackground = (tint) =>
    `color-mix(in srgb, ${tint} ${isActive ? 22 : 10}%, ${tileBase})`;
  const tileBorder = (tint) =>
    `1px solid color-mix(in srgb, ${tint} ${isActive ? 47 : 15}%, ${tileBase})`;
  // 비활성 글리프는 호스트 색을 그대로 쓰지 않는다 — 색이 원본이면 비활성 탭이 활성보다
  // 화려해지는 역전이 난다(활성 타일 글리프는 중립 text 색이므로). 색상(hue)만 남기고
  // muted 쪽으로 눕혀 "무슨 호스트인지"는 유지하되 시선은 안 끌게.
  const glyphColor = (tint) =>
    (isActive ? color.text : `color-mix(in srgb, ${tint} 40%, ${color.muted})`);
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
    color: glyphColor(tint),
    /* 칩 아래에 실제로 깔린 면(tileBase)으로 ring 을 그려 이웃 타일과 분리 — "겹쳐 있음"이
       읽히게. 투명으로 그리면 ring 이 없는 것과 같아 타일들이 한 덩어리로 뭉친다. */
    boxShadow: `0 0 0 1.5px ${tileBase}`,
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
      /* 바깥 = 히트 영역. 바 높이(34px)를 그대로 채운다 — 보이는 칩(28px)에 맞춰 줄이면
         위아래 3px 띠와 칩 사이 틈이 아무 탭에도 안 속해, 특히 터치에서 헛눌림이 난다. */
      style={{
        ...styles.tabHit,
        ...(isMobile ? styles.tabHitMobile : null),
        flex: isMobile ? styles.tabHitMobile.flex : styles.tabHit.flex,
        maxWidth: isMobile ? styles.tabHitMobile.maxWidth : styles.tabHit.maxWidth,
        opacity: isDragging ? 0.4 : 1,
        cursor: isMobile ? 'pointer' : 'grab',
        zIndex: isDragOver ? 2 : (isActive ? 1 : 0),
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
    >
      {/* 안쪽 = 실제로 보이는 칩 */}
      <div
        style={{
          ...styles.tab,
          ...(isMobile ? styles.tabMobile : null),
          background: isDragOver
            ? `color-mix(in srgb, ${color.accent} 14%, ${tileBase})`
            : tabBase,
          color: isActive ? color.text : color.muted,
          // 굵기는 고정 — 활성 표시는 면과 형태가 한다. 굵기가 바뀌면 탭을 옮길 때마다
          // 라벨 폭이 미세하게 흔들린다.
          fontWeight: fontWeight.medium,
          /* 활성은 트랙 위로 **떠오른다** — 그림자(아래)와 1px 하이라이트(위)가 두께를
             만든다. 이게 없으면 색만 다른 사각형이라 세그먼트 스위치로 안 읽힌다. */
          boxShadow: isDragOver
            ? `inset 0 0 0 2px ${color.accent}`
            : (isActive
              ? `0 1px 3px rgba(0, 0, 0, 0.45), inset 0 1px 0 color-mix(in srgb, ${color.text} 10%, transparent)`
              : 'none'),
        }}
        onMouseEnter={(e) => {
          if (isMobile) return;
          // hover 는 활성(surface0)까지 가지 않는다 — 절반만 올려 "누를 수 있음"만 알린다.
          if (!isActive) {
            e.currentTarget.style.background = 'var(--ui-surface0)';
            e.currentTarget.style.color = color.subtext;
          }
        }}
        onMouseLeave={(e) => {
          if (isMobile) return;
          if (!isActive) { e.currentTarget.style.background = tabBase; e.currentTarget.style.color = color.muted; }
        }}
      >
        {/* Ctrl+N 번호 — 아이콘 타일과 같은 네모에 담는다. 맨 숫자로 두면 sans 라벨 옆에서
            떠도는 모노 글자로 보이지만, 타일에 담기면 "식별자"로 읽힌다.
            (pane 우상단 주소 배지도 같은 타일을 쓴다 — styles/numberTile) */}
        {index != null && index <= 9 && (
          <span
            aria-hidden
            title={`${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})`}
            style={{
              // 크기는 호스트 아이콘 타일과 **같은 변수**(tileSize)를 쓴다 — 숫자로 맞춰두면
              // 나중에 아이콘 타일만 조정할 때 소리 없이 어긋난다.
              ...numberTileStyle({
                size: tileSize,
                fontSize: isMobile ? '9px' : '10px',
                base: tileBase,
                dim: !isActive,
              }),
              color: isActive ? color.subtext : color.muted,
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
              // VNC(원격 데스크탑) 탭은 활성일 때 ScreenShare 글리프가 탭 색(dotColor)을 직접 띤다 —
              // 터미널(Server, 중립 text 색)과의 색+형태 이중 차이. 비활성일 때는 기존 글리프
              // 규칙(muted tint)을 그대로 따른다 — 원색 글리프가 비활성 탭에서 튀는 건 이 저장소가
              // 되돌린 실패다.
              color: (isVnc && isActive) ? dotColor : glyphColor(dotColor),
              /* 스택일 때 뒤 타일과 분리되는 ring. 단일 타일이면 없음(기존 모양 유지). */
              boxShadow: secondaries.length ? `0 0 0 1.5px ${tileBase}` : 'none',
              zIndex: stackedCount + 1,
            }}
          >
            {isVnc
              ? <ScreenShare size={iconSize} strokeWidth={1.9} />
              : <HostIcon value={tab.icon || ''} fallback={Icon} size={iconSize} strokeWidth={1.9} />}
            {showStatusMark && (
              /* 개수 + 상태 통합 마크 (우상단).
                 - permission: 빨강 '!' — 멈춰서 네 결정을 기다림. 깜빡이는 것들 사이에서
                   정적 빨강 '!' 가 오히려 확 튄다("멈춰있으니 보아라").
                 - working/busy: 깜빡임. 숫자(pane 2개+)면 개수, 1개면 점.
                 모노 글자는 baseline 위로 살짝 떠 보여 아래로 미세 보정(translateY). */
              <span
                className={markPulse ? 'iterm-tab-busy-dot' : undefined}
                aria-hidden
                title={markLabel}
                style={{
                  position: 'absolute',
                  // 타일이 16px 로 줄어든 만큼 마크도 당긴다(18px 타일 시절의 -4 는 멀다).
                  top: '-3px',
                  right: '-3px',
                  minWidth: '9px',
                  height: '9px',
                  padding: hasMarkContent ? '0 1px' : 0,
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: hasMarkContent ? '5px' : '50%',
                  background: markTint,
                  color: color.crust,
                  fontSize: '6.5px',
                  fontWeight: fontWeight.semibold,
                  fontFamily: font.mono,
                  lineHeight: 1,
                  /* 탭 바탕색 outline 으로 타일과 분리해 어디서든 또렷이.
                     투명이면 outline 이 사라져 마크가 타일에 눌어붙는다 — tileBase 를 쓴다. */
                  boxShadow: `0 0 0 1px ${tileBase}`,
                  pointerEvents: 'none',
                  zIndex: stackedCount + 2,
                }}
              >
                {isPermission ? (
                  /* '!' 는 개수 숫자보다 크고 굵게 — 경고가 확 읽히게. */
                  <span style={{ display: 'block', lineHeight: 1, fontSize: '8px', fontWeight: 800, transform: 'translateY(0.5px)' }}>!</span>
                ) : showPaneCount ? (
                  <span style={{ display: 'block', lineHeight: 1, transform: 'translateY(0.5px)' }}>{paneCount}</span>
                ) : null}
              </span>
            )}
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

        {/* More 버튼 — 활성 탭에서만 **보인다**. 다만 자리는 비활성 탭도 잡아둔다:
            탭 바깥 폭은 고정이지만 버튼이 없으면 그만큼 라벨이 넓어져, 탭을 고르는 순간
            이름이 17px 만큼 줄며 잘린다. 그 미세한 덜컥임이 "탭 이동 때 너비가 흔들린다" 의
            정체였다. 자리를 항상 잡아두면 라벨 폭이 선택 여부와 무관하게 같다. */}
        {!isActive && !isPendingClose && (
          <span aria-hidden="true" style={{ ...styles.miniBtn, visibility: 'hidden' }} />
        )}
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
    </div>
  );
});
