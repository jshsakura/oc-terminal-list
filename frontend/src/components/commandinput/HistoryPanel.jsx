import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import useCommandHistory from '../../hooks/useCommandHistory';
import { removeCommand } from '../../utils/commandHistory';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

/**
 * 빠른입력 모달 안에서 입력창 위로 펼쳐지는 지난 명령 목록.
 * 항목 터치 → onPick(text) 로 textarea 에 채우고 패널은 부모가 접는다.
 * 끝까지 스크롤하면 sentinel 이 다음 페이지를 lazy fetch (무한 스크롤).
 */
const HistoryPanel = ({ terminalKey, onPick, t }) => {
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const { items, hasMore, loading, loadingMore, loadMore } = useCommandHistory(terminalKey);

  useEffect(() => {
    if (!sentinelRef.current || !listRef.current || !hasMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: listRef.current, rootMargin: '60px 0px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div style={styles.panel}>
      <style>{CSS}</style>
      <div style={styles.header}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          {t?.('historyTitle') || 'Recent commands'}
          {items.length > 0 && (
            <span style={styles.count}>{items.length}{hasMore ? '+' : ''}</span>
          )}
        </span>
      </div>
      <div ref={listRef} className="command-input-history-list" style={styles.list}>
        {loading && items.length === 0 ? (
          SKELETON_ROWS.map((i) => (
            <div key={i} style={{ ...styles.skeleton, animationDelay: `${i * 80}ms`, width: `${92 - (i % 3) * 16}%` }} />
          ))
        ) : items.length === 0 ? (
          <div style={styles.empty}>{t?.('historyEmpty') || 'No history yet'}</div>
        ) : (
          <>
            {items.map((entry, idx) => (
              <div key={`${entry.ts}-${idx}`} className="command-input-history-row" style={styles.row}>
                <button
                  type="button"
                  // mousedown 에서 focus 안 뺏게 — iOS 키보드 유지 (모달 내 버튼 공통 패턴).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(entry.text)}
                  title={`${entry.text}\n— ${t?.('clickToInsert') || 'click to insert into input'}`}
                  style={styles.itemText}
                >
                  {entry.text}
                </button>
                <button
                  type="button"
                  className="ci-rm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); removeCommand(terminalKey, entry.text); }}
                  title={t?.('remove') || 'Remove'}
                  aria-label={t?.('remove') || 'Remove'}
                  style={styles.remove}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} style={{ height: '1px', flexShrink: 0 }} />}
            {loadingMore && <div style={{ ...styles.skeleton, width: '70%' }} />}
          </>
        )}
      </div>
    </div>
  );
};

const CSS = `
  @keyframes command-input-history-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes command-input-skel-shimmer {
    0%   { background-position: 150% center; }
    100% { background-position: -150% center; }
  }
  .command-input-history-list { scrollbar-width: thin; }
  .command-input-history-list::-webkit-scrollbar { width: 6px; }
  .command-input-history-list::-webkit-scrollbar-thumb {
    background: var(--ui-surface1, ${color.surface1}); border-radius: 3px;
  }
  .command-input-history-row:hover {
    background: color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 70%, transparent);
  }
  .command-input-history-row:active {
    background: color-mix(in srgb, var(--ui-accent, ${color.accent}) 22%, transparent);
  }
  .command-input-history-row .ci-rm:hover { color: var(--ui-danger, ${color.danger}); }
`;

const styles = {
  panel: {
    // 남는 세로 공간을 모두 차지하고 내부 리스트만 스크롤 → 화면 크기에 맞게 열리되 입력창은 안 가림.
    flex: '1 1 auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderBottom: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    // 또렷한 배경 — 모달보다 살짝 어둡게 깔아 카드형 항목이 떠 보이게 한다.
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 88%, transparent)`,
    animation: 'command-input-history-in 160ms ease both',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['1.5']} ${space['3']}`,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: `var(--ui-subtext, ${color.subtext})`,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  count: {
    fontSize: '10px',
    color: `var(--ui-muted, ${color.muted})`,
    letterSpacing: 'normal',
    textTransform: 'none',
  },
  list: {
    // flex:1 + minHeight:0 → 패널(=남은 공간) 안에서만 스크롤. 고정 maxHeight 없이 화면에 맞춰 늘어남.
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    /* iOS: 관성 스크롤을 켜고, 목록 끝에서 스크롤이 페이지로 넘어가지 않게 가둔다
       (넘어가면 도크째 밀려 목록이 손가락을 따라오지 않는 것처럼 보인다). */
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    touchAction: 'pan-y',
    padding: `0 ${space['2']} ${space['1.5']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  // 스켈레톤 블록과 동일한 모양의 카드 행 — 같은 높이/radius, 테두리 없이 동일 톤 배경.
  // 안에 텍스트 버튼(클릭→삽입) + X 버튼(개별 삭제) 을 담는다.
  row: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: '30px',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 32%, transparent)`,
    borderRadius: radius.sm,
    overflow: 'hidden',
    transition: `background ${motion.fast}`,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    textAlign: 'left',
    padding: `0 ${space['1']} 0 ${space['2']}`,
    background: 'transparent',
    color: `var(--ui-text, ${color.text})`,
    border: 'none',
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    lineHeight: '30px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  remove: {
    flexShrink: 0,
    width: '26px',
    height: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: `var(--ui-subtext, ${color.subtext})`,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    WebkitTapHighlightColor: 'transparent',
    transition: `color ${motion.fast}`,
  },
  // 로딩 placeholder — 항목 행과 같은 높이/모양에 shimmer 만 흐른다.
  skeleton: {
    flexShrink: 0,
    height: '30px',
    borderRadius: radius.sm,
    background: `linear-gradient(90deg,
      color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 32%, transparent) 0%,
      color-mix(in srgb, var(--ui-accent, ${color.accent}) 16%, transparent) 50%,
      color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 32%, transparent) 100%)`,
    backgroundSize: '300% 100%',
    animation: 'command-input-skel-shimmer 1.6s ease-in-out infinite',
  },
  empty: {
    padding: `${space['3']} ${space['2']}`,
    textAlign: 'center',
    fontSize: fontSize['12'],
    color: `var(--ui-subtext, ${color.subtext})`,
    opacity: 0.7,
  },
};

export default HistoryPanel;
