import { AlertTriangle, ArrowDownToLine, Copy, Loader2, WifiOff, X } from 'lucide-react';
import { styles } from './terminalStyles';

/**
 * 터미널 위에 얹히는 가벼운 크롬 — 스켈레톤 / 코너 토스트 / 배너 / pill.
 * 상태 카드(종료·인계 등 모달성 오버레이)는 TerminalStatusCards.jsx 쪽.
 */

// 첫 콘텐츠가 그려지기 전 자리를 지키는 가짜 줄들 — 폭을 들쭉날쭉하게 둬 터미널 출력처럼 보이게.
const SKELETON_LINE_WIDTHS = [62, 38, 84, 50, 72, 30, 66, 44, 78, 40];

export const TerminalSkeleton = ({ themeUi }) => (
  <div
    aria-hidden="true"
    style={{
      ...styles.statusOverlay,
      backgroundColor: themeUi.base,
      padding: '14px 18px',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      gap: '10px',
    }}
  >
    {SKELETON_LINE_WIDTHS.map((width, i) => (
      <div
        key={i}
        style={{
          height: '12px',
          width: `${width}%`,
          borderRadius: '4px',
          background: themeUi.surface1 || themeUi['border-strong'] || '#313244',
          animation: 'term-skeleton-pulse 1.4s ease-in-out infinite',
          animationDelay: `${i * 90}ms`,
        }}
      />
    ))}
  </div>
);

/**
 * 우하단 코너 토스트 — "복사됨", 이미지 업로드 진행/실패 등 짧은 알림.
 * 클릭을 먹지 않게 pointerEvents:none.
 */
export const CornerToast = ({ themeUi, tone = 'default', opacity = 0.95, children }) => (
  <div
    aria-live="assertive"
    aria-atomic="true"
    style={{
      position: 'absolute',
      bottom: '10px',
      right: '10px',
      background: `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0 || '#313244'} 92%, transparent)`,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      color: tone === 'error' ? (themeUi.danger || themeUi.text) : themeUi.text,
      border: `1px solid ${themeUi.border}`,
      borderRadius: '6px',
      padding: '4px 10px',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: 500,
      pointerEvents: 'none',
      zIndex: 15,
      opacity,
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
    }}
  >
    {children}
  </div>
);

/** 드래그 선택 후 자동 복사됐을 때 잠깐 뜨는 토스트. */
export const CopiedToast = ({ themeUi, t }) => (
  <CornerToast themeUi={themeUi} opacity={0.92}>
    <Copy size={11} strokeWidth={2} style={{ color: themeUi.accent }} />
    {t('copied') || 'Copied'}
  </CornerToast>
);

/** 이미지/파일 붙여넣기 업로드 상태 — 'uploading' | 'done' | 'error'. */
export const ImagePasteToast = ({ state, themeUi, t }) => {
  if (!state) return null;
  return (
    <CornerToast themeUi={themeUi} tone={state === 'error' ? 'error' : 'default'}>
      {state === 'uploading' && (
        <>
          <Loader2 size={11} strokeWidth={2} style={{ color: themeUi.accent, animation: 'tl-spin 0.8s linear infinite' }} />
          {t('imagePasteUploading') || '이미지 업로드 중...'}
        </>
      )}
      {state === 'done' && (
        <>
          <ArrowDownToLine size={11} strokeWidth={2} style={{ color: themeUi.accent }} />
          {t('imagePasteDone') || '이미지 경로 입력됨'}
        </>
      )}
      {state === 'error' && (
        <>
          <AlertTriangle size={11} strokeWidth={2} style={{ color: themeUi.danger || themeUi.text }} />
          {t('imagePasteError') || '이미지 업로드 실패'}
        </>
      )}
    </CornerToast>
  );
};

/** 호스트에 tmux 가 없어 세션이 유지되지 않음 — 패널 하단 인라인 경고. */
export const TmuxFallbackBanner = ({ themeUi, t, onDismiss }) => (
  <div style={styles.inlineBanner(themeUi)}>
    <AlertTriangle size={13} strokeWidth={1.8} style={{ flexShrink: 0, color: themeUi.warning || '#f9e2af' }} />
    <span style={styles.bannerText(themeUi)}>
      {t('tmuxFallbackWarning') || 'tmux not found on this host — session will not persist across disconnects'}
    </span>
    <button type="button" onClick={onDismiss} style={styles.bannerButton(themeUi)}>
      <X size={11} strokeWidth={2} />
    </button>
  </div>
);

/**
 * 재연결 pill — 하단 가운데. 짧은 끊김은 디바운스로 아예 안 뜨고, 길어지면 스피너.
 * `visible` 이 false 여도 잠깐 마운트를 유지해 페이드아웃이 끝난 뒤 사라진다.
 */
export const ReconnectPill = ({ themeUi, t, isOffline, visible }) => (
  <div style={styles.reconnectPill(themeUi, visible)}>
    {isOffline
      ? <WifiOff size={13} strokeWidth={1.9} style={{ flexShrink: 0, color: themeUi.danger || themeUi.warning }} />
      : <Loader2 size={13} strokeWidth={1.9} style={{ flexShrink: 0, color: themeUi.accent, animation: 'tl-spin 0.8s linear infinite' }} />}
    <span style={styles.reconnectPillText(themeUi)}>
      {isOffline ? (t('offlinePill') || '오프라인 — 네트워크 대기 중') : (t('reconnectingPill') || 'Reconnecting…')}
    </span>
  </div>
);
