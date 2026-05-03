import { Suspense, lazy, useState } from 'react';
import { X } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const Terminal = lazy(() => import('../Terminal'));

const { color, radius, motion, fontSize, fontWeight } = tokens;

const DRAG_MIME = 'application/x-iterminallist-session';
const HOST_DRAG_MIME = 'application/x-iterminallist-host';

/**
 * N-pane 터미널 그리드.
 * - 데스크톱: 1pane=full, 2pane=2cols, 3/4pane=2x2 grid
 * - 모바일: 항상 세로 스택 (사실상 1pane 권장)
 * - 활성 pane 은 액센트 보더 + 미세 글로우, 비활성은 헤어라인 보더
 */
const PaneGrid = ({
  visiblePaneIds,
  sessions,
  activeSessionId,
  paneCount,
  isMobile,
  currentTheme,
  settings,
  terminalLayoutSignal,
  onFocusPane,
  onClosePane,
  onDropSession,
  onDropHost,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e) => {
    if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes(HOST_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!dragOver) setDragOver(true);
    }
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const hostId = e.dataTransfer.getData(HOST_DRAG_MIME);
    if (hostId) {
      onDropHost?.(hostId);
      return;
    }
    const sessionId = e.dataTransfer.getData(DRAG_MIME);
    if (sessionId) onDropSession?.(sessionId);
  };
  const single = paneCount === 1;
  const gridStyle = isMobile
    ? { display: 'flex', flexDirection: 'column', gap: single ? 0 : '6px' }
    : single
      ? { display: 'flex' }
      : {
          display: 'grid',
          gridTemplateColumns: paneCount === 2 ? '1fr 1fr' : '1fr 1fr',
          gridTemplateRows: paneCount <= 2 ? '1fr' : '1fr 1fr',
          gap: '6px',
        };

  // 터미널 배경과 같은 색을 pane 박스 배경으로 깔고, 그 안에서만 padding.
  // 이렇게 하면 여백 영역도 터미널과 동일한 색이라 시각적으로 매끈해진다.
  // 살짝만 띄우는 느낌 — 5px 동일.
  const innerPaddingX = '5px';
  const innerPaddingY = '5px';

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative', ...gridStyle }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 50,
          background: color.accentSubtle,
          border: `2px dashed ${color.accent}`,
          borderRadius: radius.md,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color.accent,
          fontSize: fontSize['13'],
          fontWeight: fontWeight.medium,
          pointerEvents: 'none',
        }}>
          + Drop to add as pane
        </div>
      )}
      {visiblePaneIds.map((sessionId, idx) => {
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) return null;
        const isFocused = sessionId === activeSessionId;
        return (
          <div
            key={`pane-${sessionId}`}
            onMouseDown={() => onFocusPane?.(idx)}
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              minHeight: 0,
              background: currentTheme.background,
              padding: `${innerPaddingY} ${innerPaddingX}`,
              boxSizing: 'border-box',
              border: single
                ? 'none'
                : `1px solid ${isFocused ? color.accentBorder : color.border}`,
              borderRadius: single ? 0 : radius.md,
              overflow: 'hidden',
              transition: `border-color ${motion.fast}, box-shadow ${motion.fast}`,
              boxShadow: !single && isFocused ? `0 0 0 1px ${color.accentBorder} inset` : 'none',
            }}
          >
            {!single && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePane?.(idx);
                }}
                title="Close pane"
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  width: '20px',
                  height: '20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: color.surface0,
                  color: color.muted,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.xs,
                  cursor: 'pointer',
                  opacity: 0.7,
                  zIndex: 5,
                  transition: `opacity ${motion.fast}, color ${motion.fast}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = color.danger; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.color = color.muted; }}
              >
                <X size={11} strokeWidth={2} />
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
      })}
    </div>
  );
};

export default PaneGrid;
