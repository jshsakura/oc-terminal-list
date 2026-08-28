/** 상단 경로 표시 — 현재 pane 의 cwd 를 접은 형태로 보여주고 새로고침을 건다. */
import { memo, useState, useEffect } from 'react';
import { RefreshCw, Monitor, Server } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import { homeTilde, stripHostPathPrefix } from './cwdPath';

const { color, font, fontSize } = tokens;

const CwdBreadcrumb = memo(({ paneInfo, loading, disabled, ui, onRefreshCwd = null, t = null }) => {
  const [refreshing, setRefreshing] = useState(false);
  // 로딩 스켈레톤 시간 제한 — 연결이 오래 걸려(=loading 이 계속 true) 상단 shimmer 바가 "되다 만"
  // 채로 영영 남는 게 거슬린다. 잠깐 뒤엔 폴백 경로(~/user@host)를 대신 보여 멈춘 바를 없앤다.
  const [skeletonExpired, setSkeletonExpired] = useState(false);
  useEffect(() => {
    if (!loading) { setSkeletonExpired(false); return undefined; }
    const id = setTimeout(() => setSkeletonExpired(true), 2500);
    return () => clearTimeout(id);
  }, [loading]);
  const isHostPane = paneInfo?.tabType === 'host';
  const iconValue = isHostPane
    ? (paneInfo?.host?.icon || null)
    : (paneInfo?.tabIcon || null);
  const colorIndex = isHostPane
    ? (paneInfo?.host?.color_index ?? null)
    : (paneInfo?.tabColorIndex ?? null);
  const dotColor = colorIndex != null
    ? (tokens.color.dotPalette[colorIndex % tokens.color.dotPalette.length] || ui.accent)
    : ui.accent;

  // absPath: 로컬 tmux 폴링 (remote 는 null)
  // staticCwd: pane.cwd — 절대경로일 때만 사용
  // lastKnownCwd: host.last_cwd — DB에 저장된 마지막 CWD (접속 시 갱신)
  // startPath: host.start_path — 설정된 시작 경로
  const absPath = paneInfo?.cwdAbsolute || null;
  const staticCwd = paneInfo?.cwd || null;
  const lastKnownCwd = isHostPane ? (paneInfo?.host?.last_cwd || null) : null;
  const startPath = isHostPane ? (paneInfo?.host?.start_path || null) : null;
  const rawPath = absPath
    || (staticCwd && staticCwd.startsWith('/') ? staticCwd : null)
    || lastKnownCwd
    || startPath;
  const displayPath = homeTilde(isHostPane ? stripHostPathPrefix(rawPath) : rawPath);

  // 진짜 cwd 가 없어도 비워두지 않는다 — 호스트면 user@host, 로컬이면 `~` 로 폴백.
  // 실제 cwd 가 fetch 되는 순간 자동으로 업데이트됨.
  const placeholderPath = isHostPane
    ? (paneInfo?.host?.ssh_user && paneInfo?.host?.hostname
        ? `${paneInfo.host.ssh_user}@${paneInfo.host.hostname}`
        : (paneInfo?.host?.hostname || '~'))
    : '~';
  const headerPath = !loading && !disabled
    ? (displayPath || placeholderPath)
    : null;
  const isPlaceholder = !loading && !disabled && !displayPath;

  const handleRefresh = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onRefreshCwd || refreshing) return;
    try {
      setRefreshing(true);
      await onRefreshCwd();
    } finally {
      setRefreshing(false);
    }
  };

  const pillStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: `color-mix(in srgb, ${ui.surface1 || ui.surface0} var(--glass-fill, 45%)%, transparent)`,
    border: `1px solid color-mix(in srgb, ${ui.border || ui.surface1} 50%, transparent)`,
    borderRadius: '5px',
    padding: '2px 4px 2px 5px',
    pointerEvents: 'auto',
  };

  // 로딩 중 — 스켈레톤 pill (단, 오래 걸리면 폴백 경로로 전환해 멈춘 바를 없앤다)
  if (loading && !skeletonExpired) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 5px' }}>
        <div style={{ ...pillStyle, pointerEvents: 'none' }}>
          <div style={{
            width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
            background: `color-mix(in srgb, ${dotColor} 40%, transparent)`,
          }} />
          <div style={{
            flex: 1, height: '7px', borderRadius: '3px',
            background: `linear-gradient(90deg,
              color-mix(in srgb, ${ui.surface1 || '#45475a'} 50%, transparent) 0%,
              color-mix(in srgb, ${ui.accent || '#89b4fa'} 18%, transparent) 50%,
              color-mix(in srgb, ${ui.surface1 || '#45475a'} 50%, transparent) 100%)`,
            backgroundSize: '300% 100%',
            // shimmer + pulse 이중 애니메이션은 겹쳐 보이기만 하고 메인스레드만 더 먹는다.
            animation: 'iterm-skel-shimmer 1.6s ease-in-out infinite',
          }} />
        </div>
      </div>
    );
  }

  if (disabled || !headerPath) {
    return <div style={{ flex: 1, minWidth: '4px' }} />;
  }

  // placeholder 텍스트는 진짜 cwd 와 시각적으로 구분 — 살짝 흐리게 + italic.

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 5px' }}>
      <div style={pillStyle}>
        <HostIcon
          value={iconValue}
          fallback={isHostPane ? Server : Monitor}
          size={9}
          strokeWidth={1.8}
          style={{ flexShrink: 0, color: dotColor, opacity: 0.85 }}
        />
        {/* 좌측 정렬, 우측 말줄임 — 드래그 선택으로 복사 가능 */}
        <span
          title={rawPath || headerPath}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '10px',
            fontFamily: font.mono,
            letterSpacing: '-0.01em',
            userSelect: 'text',
            cursor: 'text',
            color: ui.subtext0 || ui.muted,
            opacity: isPlaceholder ? 0.5 : 0.82,
            fontStyle: isPlaceholder ? 'italic' : 'normal',
          }}
        >
          {headerPath}
        </span>
        {onRefreshCwd && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title={t?.('refreshCurrentPath') || t?.('refresh') || 'Refresh current path'}
            style={{
              width: '17px',
              height: '17px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: ui.muted,
              opacity: refreshing ? 0.45 : 0.75,
              cursor: refreshing ? 'wait' : 'pointer',
              padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = ui.surface1 || 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = ui.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ui.muted; }}
          >
            <RefreshCw size={10} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
});

export default CwdBreadcrumb;
