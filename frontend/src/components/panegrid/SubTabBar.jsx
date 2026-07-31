/**
 * 분할(split) pane 들의 서브 탭바 — 메인 TabBar 아래 한 단계 위계.
 * 활성 서브탭 자동 스크롤, 터치 드래그 재정렬, 잘린 라벨 툴팁 포함.
 * PaneGrid.jsx 에서 로직 변경 없이 추출.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Server, Monitor, Plus, MoreHorizontal, Edit3, Trash2, RotateCw } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import { derivePaneLabel } from '../../utils/paneLabel';
import { numberTileStyle } from '../../styles/numberTile';
import useTouchDragReorder from '../../hooks/useTouchDragReorder';
import { MenuItem } from '../tabBar/TabBarMenus';
import { glassMenuStyle, glassPanelStyle } from '../../styles/glass';

const { color, font, fontSize, fontWeight, radius } = tokens;

// 서브탭 아이콘/숫자 타일 한 변 — 둘이 같은 값을 봐야 한 줄로 정렬된다.
// (한동안 아이콘이 14px 하드코딩이라 이 상수가 아무 데도 안 쓰이고 있었다)
const SUB_ICON_PX = 12;
// 칩 좌우 안쪽 여백 — 메인 탭 칩과 같은 5px.
const SUB_CHIP_PAD_X = 5;

const SubTabBar = ({
  panes, activePaneId, hosts, busyPaneIds = null,
  settings = {}, tabColorIndex, onSelect, onClose, onReorder = null, onRenamePane = null, onRestartPane = null, onSplitPane = null, t,
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
  // 크롬 색은 **전역 UI 팔레트**(var(--ui-*))에서만 온다 — 메인 탭바와 같은 출처.
  // 예전엔 활성 pane 테마로 buildThemeUI 해서 서브탭바만 다른 색 계열이 됐다(따뜻한 pane
  // 테마 + 차가운 전역 테마 조합에서 두 행이 대놓고 따로 놀았다). pane 정체성은 아래
  // paneAccent tint 로만 표현한다.
  const subUi = color;

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
          {onRestartPane && (
            <MenuItem
              icon={RotateCw}
              onClick={() => { const id = ctxMenu.paneId; ctxCloseRef.current(); onRestartPane(id); }}
            >
              {t?.('restartSession') || 'Restart session'}
            </MenuItem>
          )}
          <MenuItem
            danger
            icon={Trash2}
            onClick={() => { const id = ctxMenu.paneId; ctxCloseRef.current(); onClose(id); }}
          >
            {t?.('endSplitSession') || t?.('killSession') || 'End this split'}
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
          /* 메인 탭바(34px)의 2/3 남짓인 26px. 30px 은 아직 두 행이 같은 급으로 보였다 —
             행 높이 차이가 위계를 가장 빨리 읽히게 한다. 폰 크롬 총높이도 68 → 60px. */
          height: '26px',
          /* 메인 탭바와 **같은 면**(crust). 둘은 하나의 크롬 덩어리이고, 경계가 필요한 곳은
             크롬↔터미널뿐이다. 서브바를 한 단계 어둡게 깔았더니 그 위 활성 칩의 대비가
             메인바의 활성 칩보다 커져서(6.5% vs 4%) 종속된 행이 더 크게 말하는 역전이 났다.
             위계는 면이 아니라 아래 칩의 크기·세기로 만든다. */
          // 메인 탭바(crust)와 **같은 계열, 다른 단계**. 완전히 같은 색이면 두 행이 한 덩어리로
          // 뭉치고, 다른 계열(예전의 pane 테마 파생)이면 따로 논다. 깊이 순서는
          // 메인바(crust) → 서브바(mantle) → 터미널(base) 로 콘텐츠에 한 칸씩 가까워진다.
          // 서브탭바는 **유리판**이다 — 아래 터미널이 비쳐 흐려지므로, 불투명 면끼리
          // 몇 % 차이로 겨루던 문제(테마에 따라 메인바와 구분이 사라짐)가 원천적으로 없다.
          // 색은 바가 아니라 각 칩의 번호 박스가 나른다.
          ...glassPanelStyle(),
          // 유리판이라도 맞닿는 경계는 선으로 못박는다 — 배경이 밝은 테마에서 blur 만으로는
          // 위 행과의 경계가 약해진다.
          borderTop: `1px solid ${subUi.borderStrong}`,
          boxShadow: 'none',
          boxSizing: 'border-box',
          overflowX: 'auto',
          overflowY: 'hidden',
          flexShrink: 0,
          padding: '0 4px 0 6px',
          // 메인 탭바(6px)보다 한 단계 좁게 — 서브 행은 밀도가 더 촘촘해야 위계가 산다.
          gap: '5px',
          fontFamily: font.sans,
        }}
      >
        {panes.map((pane, idx) => {
          const isActive = pane.id === activePaneId;
          const isEmpty = !pane.sessionId && !pane.hostId;
          const isLocal = !!pane.sessionId && !pane.hostId;
          const isBusy = !!busyPaneIds && busyPaneIds.has(pane.id) && !isEmpty;
          const host = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
          // pane 우상단 주소 배지와 **같은 규칙**을 쓴다 — 두 곳이 다른 이름을 말하면 안 된다.
          const label = derivePaneLabel(pane, { hosts, settings, t });
          const iconValue = host?.icon || (isLocal ? (settings.localIcon || '') : '');
          const FallbackIcon = host ? Server : (isLocal ? Monitor : Plus);
          const hostAccent = host?.color_index != null
            ? color.dotPalette[(host.color_index ?? 0) % color.dotPalette.length]
            : null;
          const localAccent = isLocal && settings?.localColorIndex != null
            ? color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length]
            : null;
          const paneAccent = hostAccent || localAccent || tabBarAccent;
          // 면은 **바 테마**(subUi)의 3단계를 따르고, 정체성은 그 위에 얹는 **pane 색 tint**로
          // 표현한다: 바(crust) < 비활성(+8.2%) < 활성(surface2), 각각 paneAccent 를 옅게 섞는다.
          //
          // 이전엔 활성 칩 배경만 pane 자기 테마(paneUi)에서 뽑고 글자색도 paneUi 를 썼는데,
          // 비활성 칩의 배경은 바 테마라 짝이 안 맞았다 — pane 에 라이트 테마를 주면 어두운 칩
          // 위에 라이트 테마 글자색이 얹혀 안 읽힌다. 색은 tint 한 곳에만 두고 글자는 바 테마로.
          // 칩은 색을 싣지 않는다 — 유리판 위 반투명 면으로만 활성/비활성을 가른다.
          // pane 색은 아래 번호 박스가 나른다(색이 한 곳에만 있어야 시끄럽지 않다).
          const tabBg = isActive
            ? `color-mix(in srgb, ${subUi.surface1} 62%, transparent)`
            : `color-mix(in srgb, ${subUi.surface0} 26%, transparent)`;
          // ring/outline 은 칩이 실제로 얹힌 바탕색을 따라가야 주변과 깔끔히 분리된다.
          const chipBase = tabBg;
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
              /* 바깥 = 터치 타깃. 바 높이(34px) 전체를 유지한다 — 서브탭바는 모바일 전용이라
                 칩 크기로 히트 영역을 줄이면 위아래 여백을 눌렀을 때 아무 탭도 안 잡힌다.
                 보이는 칩(28px)은 안쪽 div 가 그린다. hover 는 없다 (터치 화면). */
              style={{
                display: 'flex',
                alignItems: 'stretch',
                height: '100%',
                /* 메인 탭 칩(24px)의 뚜렷한 아래 단계인 20px. */
                padding: '3px 0',
                boxSizing: 'border-box',
                minWidth: '100px',
                maxWidth: '150px',
                /* 메인 탭(156px)보다 확실히 좁게 — 번호 행처럼 가볍게 흐른다.
                   120 은 "web-app-01" 이 잘려서 128. */
                flex: '0 0 128px',
                cursor: 'pointer',
                opacity: isDragging ? 0.4 : 1,
                userSelect: 'none',
                position: 'relative',
                zIndex: isDragOver ? 2 : (isActive ? 1 : 0),
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  /* 번호 타일 · 아이콘 · 이름이 한 덩어리로 붙어 보이게 좁게(4px).
                     메인 탭(7px)처럼 벌리면 작은 칩 안에서 조각들이 흩어져 보인다. */
                  gap: '4px',
                  padding: `0 ${SUB_CHIP_PAD_X}px`,
                  flex: 1,
                  minWidth: 0,
                  background: isDragOver ? `color-mix(in srgb, ${color.accent} 14%, ${chipBase})` : tabBg,
                  color: isActive ? subUi.text : subUi.muted,
                  fontWeight: fontWeight.medium,
                  fontSize: fontSize['11'],   // 메인 탭(12px) 아래 한 단계
                  border: 'none',
                  boxShadow: isDragOver ? `inset 0 0 0 2px ${color.accent}` : 'none',
                  borderRadius: radius.sm,
                  boxSizing: 'border-box',
                  transition: 'background 120ms, color 120ms, box-shadow 120ms',
                }}
              >
                {idx < 9 && (
                  /* 색은 여기 하나에만 — pane(호스트/로컬) 색을 옅게 깐 번호 박스.
                     칩 배경이나 옆 세로선으로 색을 나르면 유리판 위에서 지저분해진다. */
                  <span
                    aria-hidden
                    style={{
                      ...numberTileStyle({ size: SUB_ICON_PX, fontSize: '9px', base: 'transparent' }),
                      background: `color-mix(in srgb, ${paneAccent} ${isActive ? 30 : 16}%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${paneAccent} ${isActive ? 46 : 24}%, transparent)`,
                      color: isActive ? subUi.text : subUi.subtext,
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
                    width: `${SUB_ICON_PX}px`,
                    height: `${SUB_ICON_PX}px`,
                    flexShrink: 0,
                    // 비활성은 색상만 남기고 muted 쪽으로 눕힌다(메인탭 glyphColor 와 같은 규칙).
                    // 알파(`cc`)+opacity 로 흐리면 색이 배경과 섞여 탁해질 뿐 눈에는 계속 띈다.
                    color: isActive ? paneAccent : `color-mix(in srgb, ${paneAccent} 40%, ${subUi.muted})`,
                  }}
                >
                  <HostIcon value={iconValue} fallback={FallbackIcon} size={11} strokeWidth={1.9} />
                  {isBusy && (
                    <span
                      className="iterm-subtab-busy-dot"
                      aria-hidden
                      style={{
                        position: 'absolute',
                        // 아이콘이 12px 로 작아진 만큼 점도 바짝 당긴다 — -4 는 허공에 뜬다.
                        top: '-2px',
                        right: '-3px',
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: paneAccent,
                        boxShadow: `0 0 0 1.5px ${chipBase}`,
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
                      color: subUi.subtext,
                      cursor: 'pointer',
                      borderRadius: '3px',
                      padding: 0,
                    }}
                  >
                    <MoreHorizontal size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default SubTabBar;
