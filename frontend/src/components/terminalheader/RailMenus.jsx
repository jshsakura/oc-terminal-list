/**
 * TerminalHeader 의 레일 메뉴/팝오버 헬퍼.
 * - RailSubMenu: anchor 기준으로 뜨는 글래스 서브메뉴 컨테이너
 * - MenuBtn: 서브메뉴 안의 버튼
 * - CommandHistoryPopover: 명령 히스토리 팝오버(검색/삭제/선택)
 * TerminalHeader.jsx 에서 로직 변경 없이 추출.
 */
import { useState, useEffect, useRef } from 'react';
import { X, Trash2 } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassMenuStyle } from '../../styles/glass';
import useCommandHistory from '../../hooks/useCommandHistory';
import { removeCommand as removeHistoryCommand, clearCommandsFor as clearHistoryFor } from '../../utils/commandHistory';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const RailSubMenu = ({ anchor, ui, isMobile = false, onClose, t, children }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => {
      if (!ref.current?.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = anchor.x - rect.width;
      let nextY = anchor.y;
      if (nextX < margin) nextX = margin;
      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;
      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [anchor.x, anchor.y]);

  return (
    <div
      ref={ref}
      className={isMobile ? 'iterm-rail-submenu-mobile' : undefined}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(ui),
        zIndex: 200000,
        minWidth: '160px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transition: 'opacity 120ms',
      }}
    >
      {isMobile && (
        <style>{`
          .iterm-rail-submenu-mobile > button {
            min-height: 42px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
          .iterm-rail-submenu-mobile > button > svg {
            width: 15px !important;
            height: 15px !important;
          }
        `}</style>
      )}
      {children}
    </div>
  );
};

const MenuBtn = ({ icon: Icon, onClick, children, danger = false, disabled = false, display = false, ui }) => {
  const fg = danger ? (ui?.danger || color.danger) : (ui?.text || color.text);
  // Stop propagation on all pointer events so the portal's outside-click listener
  // cannot swallow or duplicate the interaction. This is critical for the "Close terminal"
  // action where closeRailMenu() + onCloseTerminal() must both fire without interference.
  const stop = (e) => e.stopPropagation();
  return (
    <button
      type="button"
      onClick={display ? undefined : onClick}
      onPointerDown={stop}
      onTouchStart={stop}
      onMouseDown={stop}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        textAlign: 'left',
        minHeight: '30px',
        padding: '6px 9px',
        background: 'transparent',
        border: 'none',
        borderRadius: '3px',
        cursor: display ? 'default' : (disabled ? 'default' : 'pointer'),
        color: fg,
        fontSize: '11.5px',
        fontFamily: 'inherit',
        transition: 'background 120ms',
        lineHeight: 1.3,
        opacity: disabled ? 0.5 : 1,
      }}
      /* display(값만 보여주는 행)와 disabled 에는 호버가 없어야 하므로 클래스를 안 붙인다.
         나머지는 앱 공용 규칙(main.jsx `.iterm-menu-item`)을 그대로 따른다. */
      className={(!disabled && !display) ? 'iterm-menu-item' : undefined}
    >
      {Icon && <Icon size={13} strokeWidth={1.8} />}
      {children}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CommandHistoryPopover — eye 아이콘 아래에 뜨는 작은 popover.
// 해당 터미널에서 보냈던 최근 명령 N개를 보여주고, 클릭 시 다시 보냄.
//
// 동작:
// - 외부 클릭 / Escape 로 닫힘 (setTimeout(0) 패턴 — 즉시 자동 닫힘 방지)
// - 등장 시 fade + 살짝 위에서 내려오는 모션
// - 각 row 는 mono font, ellipsis, X 로 개별 삭제 가능
const CommandHistoryPopover = ({ anchor, terminalKey, ui, isMobile = false, onClose, onSelect, t }) => {
  const ref = useRef(null);
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);
  // "비우기" 확정 단계 — 휴지통 한 번 누르면 inline 확인 영역이 popover 안에 오버레이.
  // 외부 confirm() 다이얼로그는 popover 컨텍스트를 끊고 모바일 UX 가 어색해서 안 쓴다.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { items, hasMore, loading, loadingMore, loadMore } = useCommandHistory(terminalKey);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => { if (!ref.current?.contains(e.target)) onCloseRef.current(); };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      // touchstart 도 함께 듣는다 — 모바일에서 터미널 영역이 touchstart 를 preventDefault 하면
      // 합성 mousedown 이 억제돼 바깥 탭으로 닫히지 않던 문제 우회. (pointerdown 미지원 브라우저 대비 mousedown 유지)
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let nextX = anchor.x - rect.width;
    let nextY = anchor.y;
    if (nextX < margin) nextX = margin;
    if (nextX + rect.width > window.innerWidth - margin) {
      nextX = window.innerWidth - rect.width - margin;
    }
    if (nextY + rect.height > window.innerHeight - margin) {
      nextY = window.innerHeight - rect.height - margin;
    }
    if (nextY < margin) nextY = margin;
    setPos({ x: nextX, y: nextY });
    setMeasured(true);
  }, [anchor.x, anchor.y, items.length]);

  // 인피니티 스크롤 — 리스트 끝 sentinel 이 viewport 안에 들어오면 다음 페이지 fetch.
  // IntersectionObserver root 를 listRef (스크롤 컨테이너) 로 지정해 popover 안에서만 trigger.
  useEffect(() => {
    if (!sentinelRef.current || !listRef.current) return undefined;
    if (!hasMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: listRef.current, rootMargin: '60px 0px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(ui),
        zIndex: 200000,
        // 콘텐츠 길이와 무관하게 일관된 폭 — 짧은 명령으로 줄어들거나 긴 명령으로 350px 까지
        // 늘어나는 일이 없게 고정. 두 줄까지는 wrap 허용.
        width: isMobile ? '260px' : '320px',
        maxHeight: '320px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transform: measured ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 140ms ease, transform 140ms ease',
      }}
    >
      <style>{`
        @keyframes iterm-cmd-history-item-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .iterm-cmd-history-list::-webkit-scrollbar { width: 6px; }
        .iterm-cmd-history-list::-webkit-scrollbar-thumb {
          background: ${ui.surface1 || '#45475a'};
          border-radius: 3px;
        }
        .iterm-cmd-history-list { scrollbar-width: thin; }
        .iterm-cmd-history-item { animation: iterm-cmd-history-item-in 200ms ease both; }
      `}</style>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: `1px solid color-mix(in srgb, ${ui.border} 65%, transparent)`,
        background: `color-mix(in srgb, ${ui.base} 38%, transparent)`,
      }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: fontSize['11'],
          fontWeight: fontWeight.semibold,
          color: ui.subtext,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {t?.('historyTitle') || 'Recent commands'}
          {items.length > 0 && (
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '8px',
              background: `color-mix(in srgb, ${ui.accent} 20%, transparent)`,
              color: ui.text,
              letterSpacing: 'normal',
              textTransform: 'none',
            }}>{items.length}{hasMore ? '+' : ''}</span>
          )}
        </span>
        {items.length > 0 && !confirmingClear && (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            title={t?.('clearHistory') || 'Clear history'}
            style={{
              width: '20px', height: '20px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: ui.subtext, padding: 0, borderRadius: '4px',
              transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = ui.danger || '#f38ba8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
          >
            <Trash2 size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Inline confirm bar — 휴지통 버튼 누르면 헤더 아래로 슬라이드해 들어온다. */}
      {confirmingClear && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 10px',
          background: `color-mix(in srgb, ${ui.danger || '#f38ba8'} 14%, transparent)`,
          borderBottom: `1px solid color-mix(in srgb, ${ui.danger || '#f38ba8'} 32%, transparent)`,
          animation: 'iterm-cmd-history-item-in 160ms ease both',
        }}>
          <span style={{
            fontSize: fontSize['11'], color: ui.text, lineHeight: 1.4, flex: 1, minWidth: 0,
          }}>{t?.('confirmClearHistory') || 'Clear command history for this terminal?'}</span>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              style={{
                padding: '4px 10px', borderRadius: '4px',
                background: 'transparent', border: `1px solid ${ui.border}`,
                color: ui.subtext, fontSize: fontSize['11'], cursor: 'pointer',
                fontFamily: 'inherit', transition: 'background 120ms, color 120ms',
              }}
              className="iterm-menu-item"
            >
              {t?.('cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => { clearHistoryFor(terminalKey); setConfirmingClear(false); }}
              style={{
                padding: '4px 10px', borderRadius: '4px',
                background: ui.danger || '#f38ba8',
                color: ui.crust || '#11111b',
                border: '1px solid transparent',
                fontSize: fontSize['11'], fontWeight: fontWeight.semibold, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'opacity 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {t?.('clearHistory') || 'Clear'}
            </button>
          </div>
        </div>
      )}

      <div ref={listRef} className="iterm-cmd-history-list" style={{
        flex: 1, overflowY: 'auto', padding: '4px',
        display: 'flex', flexDirection: 'column', gap: '2px',
      }}>
        {loading && items.length === 0 ? (
          // 첫 로딩 스켈레톤 — 빠른입력 패널과 동일한 카드 치수의 shimmer 블록.
          [0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{
              flexShrink: 0, height: '30px', borderRadius: '4px',
              width: `${92 - (i % 3) * 16}%`,
              background: `linear-gradient(90deg,
                color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 0%,
                color-mix(in srgb, ${ui.accent || '#89b4fa'} 18%, transparent) 50%,
                color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 100%)`,
              backgroundSize: '300% 100%',
              animation: `iterm-skel-shimmer ${1.6 + i * 0.08}s ease-in-out infinite`,
              animationDelay: `${i * 80}ms`,
            }} />
          ))
        ) : items.length === 0 ? (
          <div style={{
            padding: '18px 12px', textAlign: 'center',
            fontSize: fontSize['12'], color: ui.subtext, opacity: 0.7,
          }}>
            {t?.('historyEmpty') || 'No history yet'}
          </div>
        ) : items.map((entry, idx) => (
          // 카드형 행 — 스켈레톤 블록과 동일한 높이/배경. 텍스트(클릭→재전송) + X(개별 삭제).
          <div
            key={`${entry.ts}-${idx}`}
            className="iterm-cmd-history-item"
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', height: '30px',
              background: `color-mix(in srgb, ${ui.surface1} 32%, transparent)`,
              borderRadius: '4px', overflow: 'hidden',
              transition: 'background 120ms',
              animationDelay: idx < 12 ? `${idx * 18}ms` : '0ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} 70%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} 32%, transparent)`; }}
          >
            <button
              type="button"
              onClick={() => onSelect?.(entry.text)}
              title={`${entry.text}\n— ${t?.('clickToResend') || 'click to re-send'}`}
              style={{
                flex: 1, minWidth: 0, height: '100%', textAlign: 'left',
                background: 'transparent', color: ui.text, border: 'none',
                cursor: 'pointer', padding: '0 4px 0 9px',
                fontFamily: font.mono, fontSize: fontSize['12'], lineHeight: '30px',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {entry.text}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeHistoryCommand(terminalKey, entry.text); }}
              title={t?.('remove') || 'Remove'}
              aria-label={t?.('remove') || 'Remove'}
              style={{
                flexShrink: 0, width: '26px', height: '100%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', color: ui.subtext,
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'color 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = ui.danger || '#f38ba8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ))}
        {/* 인피니티 스크롤 sentinel — 화면에 닿으면 다음 페이지. hasMore=false 일 때는 비표시. */}
        {items.length > 0 && hasMore && (
          <div ref={sentinelRef} style={{
            padding: '8px 0', display: 'flex', justifyContent: 'center',
            fontSize: '10px', color: ui.subtext, opacity: 0.7,
          }}>
            {loadingMore ? (t?.('loading') || 'Loading…') : '·'}
          </div>
        )}
        {items.length > 0 && !hasMore && !loading && (
          <div style={{
            padding: '8px 0', display: 'flex', justifyContent: 'center',
            fontSize: '10px', color: ui.subtext, opacity: 0.55,
            letterSpacing: '0.05em',
          }}>
            {t?.('historyEnd') || 'End of history'}
          </div>
        )}
      </div>
    </div>
  );
};


export { RailSubMenu, MenuBtn, CommandHistoryPopover };
