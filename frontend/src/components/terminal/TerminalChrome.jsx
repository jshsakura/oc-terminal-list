import { AlertTriangle, ArrowDownToLine, Copy, FolderX, Loader2, Upload, WifiOff, X } from 'lucide-react';
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
      background: `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0 || '#313244'} var(--glass-fill, 92%)%, transparent)`,
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

/**
 * 드롭 존 하이라이트 — PC 에서 파일을 터미널 위로 끌고 왔을 때만.
 * pointerEvents:none 이라 정작 drop 이벤트는 아래 xterm 컨테이너가 그대로 받는다(필수).
 */
export const FileDropOverlay = ({ themeUi, t }) => (
  <div
    aria-hidden="true"
    style={{
      position: 'absolute',
      inset: 0,
      zIndex: 14,
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `color-mix(in srgb, ${themeUi.accent} 10%, transparent)`,
      border: `2px dashed ${themeUi.accent}`,
      borderRadius: '6px',
      boxSizing: 'border-box',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        padding: '7px 13px',
        borderRadius: '6px',
        background: `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0 || '#313244'} var(--glass-fill, 94%)%, transparent)`,
        border: `1px solid ${themeUi.border}`,
        color: themeUi.text,
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 500,
      }}
    >
      <Upload size={13} strokeWidth={2} style={{ color: themeUi.accent }} />
      {t('fileDropHint') || '놓으면 업로드 후 경로가 입력됩니다'}
    </div>
  </div>
);

/** 이미지/파일 붙여넣기 업로드 상태 — 'uploading' | 'done' | 'error' | 'blocked' | 'folder'.
 *
 * `blocked` 는 **요청이 서버에 닿지도 못한** 경우다(공유 HTTP/2 연결이 막힘). 원인이
 * 다르면 할 일도 다르다 — 그냥 "실패" 라고 하면 사용자는 파일이나 호스트를 의심하는데,
 * 실제로 필요한 건 새로고침 하나다. 그래서 문구를 나눈다. */
export const ImagePasteToast = ({ state, themeUi, t }) => {
  if (!state) return null;
  // A caller may pass a bare kind or `{ kind, tokens }` — the estimate is optional detail,
  // never a second toast.
  const kind = typeof state === 'string' ? state : state?.kind;
  const tokens = typeof state === 'object' ? state?.tokens : null;
  if (!kind) return null;
  const isBad = kind === 'error' || kind === 'folder' || kind === 'blocked';
  return (
    <CornerToast themeUi={themeUi} tone={isBad ? 'error' : 'default'}>
      {kind === 'uploading' && (
        <>
          <Loader2 size={11} strokeWidth={2} style={{ color: themeUi.accent, animation: 'tl-spin 0.8s linear infinite' }} />
          {t('imagePasteUploading') || '이미지 업로드 중...'}
        </>
      )}
      {kind === 'done' && (
        <>
          <ArrowDownToLine size={11} strokeWidth={2} style={{ color: themeUi.accent }} />
          {t('imagePasteDone') || '이미지 경로 입력됨'}
          {tokens ? (
            <span style={{ opacity: 0.62, fontVariantNumeric: 'tabular-nums' }}>
              {`≈${tokens.toLocaleString()} tok`}
            </span>
          ) : null}
        </>
      )}
      {kind === 'error' && (
        <>
          <AlertTriangle size={11} strokeWidth={2} style={{ color: themeUi.danger || themeUi.text }} />
          {t('imagePasteError') || '이미지 업로드 실패'}
        </>
      )}
      {kind === 'blocked' && (
        <>
          <AlertTriangle size={11} strokeWidth={2} style={{ color: themeUi.danger || themeUi.text }} />
          {t('imagePasteBlocked') || '연결이 막혀 업로드하지 못했습니다 — 새로고침 후 다시 시도하세요'}
        </>
      )}
      {kind === 'folder' && (
        <>
          <FolderX size={11} strokeWidth={2} style={{ color: themeUi.danger || themeUi.text }} />
          {t('fileDropFolderUnsupported') || '폴더는 보낼 수 없습니다'}
        </>
      )}
    </CornerToast>
  );
};

/**
 * 고른 멀티플렉서가 이 호스트에 없어 평범한 셸로 열렸다 — 패널 하단 인라인 경고.
 *
 * ⚠️ **"없다" 로 끝내면 안 된다.** 예전 문구는 tmux 가 없다는 사실만 말하고 사용자를
 * 거기 세워 뒀다. 정작 알아야 할 것은 **닫으면 작업이 사라진다**는 결과이고, 하고 싶은
 * 것은 **깔기**다. 그래서 결과를 먼저 쓰고 설치 버튼을 함께 준다.
 */
export const MuxFallbackBanner = ({ themeUi, t, tool = 'tmux', onInstall, onDismiss }) => (
  <div style={styles.inlineBanner(themeUi)}>
    <AlertTriangle size={13} strokeWidth={1.8} style={{ flexShrink: 0, color: themeUi.warning || '#f9e2af' }} />
    <span style={styles.bannerText(themeUi)}>
      {(t('muxMissingBanner') || '{tool} is not installed here — this session will not survive closing the tab.')
        .replace('{tool}', tool)}
    </span>
    {onInstall && (
      <button
        type="button"
        onClick={onInstall}
        style={{ ...styles.bannerButton(themeUi), width: 'auto', padding: '0 7px', fontSize: '11px' }}
      >
        {t('installTool') || 'Install'}
      </button>
    )}
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
