import { Suspense, lazy, useState } from 'react';
import { X, Plus, ArrowDownToLine } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const Terminal = lazy(() => import('../Terminal'));

const { color, radius, motion, fontSize, fontWeight, font, space } = tokens;

const DRAG_MIME = 'application/x-iterminallist-session';
const HOST_DRAG_MIME = 'application/x-iterminallist-host';

// 세션 ID → 안정 색 (사이드바 dot 과 일치)
const colorForSession = (sessionId) => {
  if (!sessionId) return color.muted;
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return color.dotPalette[h % color.dotPalette.length];
};

const PaneGrid = ({
  visiblePaneIds,
  sessions,
  activeSessionId,
  focusedPaneIdx = 0,
  paneCount,
  isMobile,
  currentTheme,
  settings,
  terminalLayoutSignal,
  onFocusPane,
  onClosePane,
  onDropSession,
  onDropHost,
  onFillSlotNew,
  t = (k) => k,
}) => {
  const single = paneCount === 1;
  const gridStyle = isMobile
    ? { display: 'flex', flexDirection: 'column', gap: single ? 0 : '6px' }
    : single
      ? { display: 'flex' }
      : {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: paneCount <= 2 ? '1fr' : '1fr 1fr',
          gap: '6px',
        };

  return (
    <div style={{ width: '100%', height: '100%', ...gridStyle }}>
      {visiblePaneIds.map((sessionId, idx) => {
        if (sessionId == null) {
          return (
            <EmptyPaneSlot
              key={`empty-${idx}`}
              idx={idx}
              onDropSession={(sid) => onDropSession?.(sid, idx)}
              onDropHost={(hid) => onDropHost?.(hid, idx)}
              onFillNew={() => onFillSlotNew?.(idx)}
              onClose={() => onClosePane?.(idx)}
              t={t}
            />
          );
        }
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) return null;
        const isFocused = idx === focusedPaneIdx;
        return (
          <FilledPane
            key={`pane-${sessionId}`}
            idx={idx}
            session={session}
            isFocused={isFocused}
            single={single}
            currentTheme={currentTheme}
            settings={settings}
            terminalLayoutSignal={terminalLayoutSignal}
            onFocus={() => onFocusPane?.(idx)}
            onClose={() => onClosePane?.(idx)}
            onDropSession={(sid) => onDropSession?.(sid, idx)}
            onDropHost={(hid) => onDropHost?.(hid, idx)}
            t={t}
          />
        );
      })}
    </div>
  );
};

// ─── 채워진 pane ─────────────────────────────────────────────────────────
const FilledPane = ({
  idx, session, isFocused, single, currentTheme, settings, terminalLayoutSignal,
  onFocus, onClose, onDropSession, onDropHost, t,
}) => {
  const [over, setOver] = useState(false);
  const [hover, setHover] = useState(false);
  const dotColor = colorForSession(session.id);

  const onDragOver = (e) => {
    if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes(HOST_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!over) setOver(true);
    }
  };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOver(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const hid = e.dataTransfer.getData(HOST_DRAG_MIME);
    if (hid) return onDropHost(hid);
    const sid = e.dataTransfer.getData(DRAG_MIME);
    if (sid) return onDropSession(sid);
  };

  return (
    <div
      onMouseDown={onFocus}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: currentTheme.background,
        padding: '5px',
        boxSizing: 'border-box',
        border: single ? 'none' : `1px solid ${over ? color.accent : (isFocused ? color.accentBorder : color.border)}`,
        borderRadius: single ? 0 : radius.md,
        overflow: 'hidden',
        transition: `border-color ${motion.fast}, box-shadow ${motion.fast}`,
        boxShadow: !single && isFocused ? `0 0 0 1px ${color.accentBorder} inset` : 'none',
      }}
    >
      {/* color dot (활성/세션 식별) — 좌상단 작은 점 */}
      {!single && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            width: isFocused ? '8px' : '6px',
            height: isFocused ? '8px' : '6px',
            borderRadius: '999px',
            background: dotColor,
            boxShadow: isFocused ? `0 0 0 2px ${dotColor}40` : 'inset 0 0 0 1px rgba(0,0,0,0.25)',
            zIndex: 5,
            pointerEvents: 'none',
            transition: `width ${motion.fast}, height ${motion.fast}, box-shadow ${motion.fast}`,
          }}
          title={session.name || session.id}
        />
      )}

      {/* 드롭 오버레이 */}
      {over && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 4,
          background: `${color.accent}1a`,
          border: `2px dashed ${color.accent}`,
          borderRadius: radius.md,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: color.accent,
          fontSize: fontSize['12'], fontWeight: fontWeight.medium,
          fontFamily: font.sans,
          pointerEvents: 'none',
        }}>
          {t('replacePane') || 'Replace this pane'}
        </div>
      )}

      {/* X 닫기 — 호버 시 노출 */}
      {!single && (hover || isFocused) && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title={t('closePane') || 'Close pane'}
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            width: '22px',
            height: '22px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: color.surface0,
            color: color.muted,
            border: `1px solid ${color.border}`,
            borderRadius: radius.xs,
            cursor: 'pointer',
            zIndex: 6,
            transition: `background ${motion.fast}, color ${motion.fast}`,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.danger; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.muted; }}
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}

      <Suspense fallback={null}>
        <Terminal
          sessionId={session.id}
          hostId={session.hostId}
          settings={settings}
          isActive={isFocused}
          layoutSignal={terminalLayoutSignal}
        />
      </Suspense>
    </div>
  );
};

// ─── 빈 pane 슬롯 ────────────────────────────────────────────────────────
const EmptyPaneSlot = ({ idx, onDropSession, onDropHost, onFillNew, onClose, t }) => {
  const [over, setOver] = useState(false);
  const handleDragOver = (e) => {
    if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes(HOST_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    }
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const hid = e.dataTransfer.getData(HOST_DRAG_MIME);
    if (hid) return onDropHost(hid);
    const sid = e.dataTransfer.getData(DRAG_MIME);
    if (sid) return onDropSession(sid);
  };
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: color.crust,
        border: `1px dashed ${over ? color.accent : color.border}`,
        borderRadius: radius.md,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space['3'],
        color: color.muted,
        fontSize: fontSize['12'],
        fontFamily: font.sans,
        transition: `border-color ${motion.fast}`,
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title={t('closePane') || 'Close pane'}
        style={{
          position: 'absolute', top: '6px', right: '6px',
          width: '20px', height: '20px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: color.surface0, color: color.muted,
          border: `1px solid ${color.border}`, borderRadius: radius.xs,
          cursor: 'pointer', opacity: 0.7,
        }}
      >
        <X size={11} strokeWidth={2} />
      </button>
      <ArrowDownToLine size={22} strokeWidth={1.5} style={{ color: over ? color.accent : color.muted }} />
      <div style={{ textAlign: 'center', lineHeight: 1.5, color: color.muted, fontSize: fontSize['12'] }}>
        {t('emptyPaneDragOnly') || '왼쪽 사이드바에서 호스트나 세션을 드래그해 놓으세요'}
      </div>
    </div>
  );
};

export default PaneGrid;
