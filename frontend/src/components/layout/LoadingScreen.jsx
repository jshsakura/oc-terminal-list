import { tokens } from '../../styles/tokens';

const { font, fontSize, fontWeight, radius, space } = tokens;

/**
 * 풀스크린 스플래시 — 보이는 시간은 짧지만 첫 인상이므로 진짜 마크 + 모션.
 *
 * 구성
 *   1) 배경: 액센트 톤 라디얼 비넷 + 모노 그리드 페이딩 (subtle, blocky 느낌)
 *   2) 중앙: 작은 터미널 윈도우 카드 — 트래픽라이트 3 도트, 본문엔
 *      `$ terminal-list ▌` 가 타이핑되는 듯 width 애니메이션 + 깜박이는 caret.
 *   3) 카드 뒤로 다층 글로우 박동.
 *   4) 카드 아래: 워드마크(`›_ Terminal List`) + 액센트 stagger 도트 로더.
 *
 * 색은 currentTheme.ui.{bg, accent} 우선, 폴백은 토큰.
 * CSS-only 애니메이션 — 부팅 지연/페인트 비용 최소화.
 */
const LoadingScreen = ({ currentTheme, t }) => {
  const themeBg = currentTheme?.ui?.bg || '#1a1a25';
  const themeAccent = currentTheme?.ui?.accent || '#89b4fa';
  const appName = t?.('appName') || 'Terminal List';

  return (
    <div style={{ ...styles.container, background: themeBg }}>
      <style>{`
        @keyframes iterm-splash-glow {
          0%, 100% { transform: scale(0.92); opacity: 0.35; }
          50%      { transform: scale(1.15); opacity: 0.78; }
        }
        @keyframes iterm-splash-card {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2px); }
        }
        @keyframes iterm-splash-type {
          0%       { width: 0; }
          55%      { width: 13ch; }
          100%     { width: 13ch; }
        }
        @keyframes iterm-splash-caret {
          0%, 49%   { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes iterm-splash-dot {
          0%, 80%, 100% { transform: scale(0.55); opacity: 0.25; }
          40%           { transform: scale(1);    opacity: 1; }
        }
        @keyframes iterm-splash-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .iterm-splash-fadein { animation: iterm-splash-fadein 520ms cubic-bezier(0.16,1,0.3,1) both; }
      `}</style>

      {/* 배경 — 라디얼 비넷 + 모노 그리드. pointer-events 차단. */}
      <div style={{
        ...styles.bgGrid,
        backgroundImage: `
          radial-gradient(circle at 50% 38%, ${themeAccent}1a 0%, transparent 55%),
          linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 28px 28px, 28px 28px',
      }} aria-hidden />

      <div className="iterm-splash-fadein" style={styles.stack}>

        {/* 글로우 + 터미널 카드 */}
        <div style={styles.stage}>
          <div style={{ ...styles.glowOuter, background: `radial-gradient(closest-side, ${themeAccent}33, transparent 70%)` }} aria-hidden />
          <div style={{ ...styles.glowInner, background: `radial-gradient(closest-side, ${themeAccent}55, transparent 65%)` }} aria-hidden />

          <div style={{
            ...styles.card,
            border: `1px solid ${themeAccent}33`,
            boxShadow: `0 18px 48px ${themeAccent}26, 0 1px 0 rgba(255,255,255,0.05) inset`,
          }}>
            {/* titlebar */}
            <div style={styles.titlebar}>
              <span style={{ ...styles.tlDot, background: '#ff5f56' }} />
              <span style={{ ...styles.tlDot, background: '#ffbd2e' }} />
              <span style={{ ...styles.tlDot, background: '#27c93f' }} />
              <span style={{ ...styles.tlLabel }}>{appName.toLowerCase()}</span>
            </div>
            {/* body */}
            <div style={styles.body}>
              <span style={{ ...styles.prompt, color: themeAccent }}>$</span>
              <span style={styles.typed}>
                <span style={styles.typedClip}>terminal-list</span>
              </span>
              <span style={{ ...styles.caret, background: themeAccent }} aria-hidden />
            </div>
          </div>
        </div>

        {/* 워드마크 */}
        <div style={styles.wordmark}>
          <span style={{ color: themeAccent, fontFamily: font.mono, fontWeight: fontWeight.semibold, letterSpacing: '0.04em' }}>›_</span>
          <span style={{ color: '#e4e6f1' }}>{appName}</span>
        </div>

        {/* 로더 도트 */}
        <div style={styles.dots} aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                ...styles.dot,
                background: themeAccent,
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const CARD_W = 280;
const CARD_H = 132;

const styles = {
  container: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: font.sans,
    overflow: 'hidden',
  },
  bgGrid: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    maskImage: 'radial-gradient(circle at 50% 50%, black 30%, transparent 75%)',
    WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 30%, transparent 75%)',
    opacity: 0.85,
  },
  stack: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: space['4'],
  },
  stage: {
    position: 'relative',
    width: `${CARD_W}px`,
    height: `${CARD_H}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowOuter: {
    position: 'absolute',
    inset: '-30%',
    filter: 'blur(12px)',
    animation: 'iterm-splash-glow 3.2s ease-in-out infinite',
    pointerEvents: 'none',
  },
  glowInner: {
    position: 'absolute',
    inset: '-12%',
    filter: 'blur(4px)',
    animation: 'iterm-splash-glow 2.6s ease-in-out infinite',
    pointerEvents: 'none',
    opacity: 0.6,
  },
  card: {
    position: 'relative',
    width: `${CARD_W}px`,
    height: `${CARD_H}px`,
    background: 'rgba(15, 15, 23, 0.72)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: radius.lg,
    overflow: 'hidden',
    animation: 'iterm-splash-card 3.2s ease-in-out infinite',
    display: 'flex',
    flexDirection: 'column',
  },
  titlebar: {
    height: '26px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 12px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: '10.5px',
    color: 'rgba(228,230,241,0.55)',
    fontFamily: font.mono,
    letterSpacing: '0.04em',
  },
  tlDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)',
  },
  tlLabel: {
    marginLeft: 'auto',
    paddingRight: '2px',
  },
  body: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: `0 ${space['4']}`,
    fontFamily: font.mono,
    fontSize: fontSize['14'],
  },
  prompt: {
    fontWeight: fontWeight.semibold,
    fontSize: fontSize['16'],
    lineHeight: 1,
  },
  typed: {
    display: 'inline-block',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    color: '#e4e6f1',
    width: 0,
    animation: 'iterm-splash-type 2.2s steps(13, end) 200ms forwards',
    fontFeatureSettings: '"calt" 0',
  },
  typedClip: {
    display: 'inline-block',
  },
  caret: {
    display: 'inline-block',
    width: '8px',
    height: '15px',
    marginLeft: '2px',
    verticalAlign: 'middle',
    borderRadius: '1px',
    animation: 'iterm-splash-caret 1s steps(1, end) infinite',
  },
  wordmark: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    fontSize: fontSize['16'],
    fontWeight: fontWeight.semibold,
    letterSpacing: '0.01em',
    margin: 0,
  },
  dots: {
    display: 'flex',
    gap: '7px',
    marginTop: '-4px',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    animation: 'iterm-splash-dot 1.2s ease-in-out infinite',
  },
};

export default LoadingScreen;
