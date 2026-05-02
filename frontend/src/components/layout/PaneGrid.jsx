import { Suspense, lazy } from 'react';
import { X } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const Terminal = lazy(() => import('../Terminal'));

const { color, radius, motion } = tokens;

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
}) => {
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

  return (
    <div style={{ width: '100%', height: '100%', ...gridStyle }}>
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
