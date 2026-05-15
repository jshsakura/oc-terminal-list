import { tokens } from '../../styles/tokens';

const { font, fontSize, fontWeight } = tokens;

const LoadingScreen = ({ currentTheme, t }) => {
  const bg     = currentTheme?.ui?.bg     || '#1a1a25';
  const accent = currentTheme?.ui?.accent || '#89b4fa';
  const appName = t?.('appName') || 'Terminal List';

  return (
    <div style={{ ...S.container, background: bg }}>
      <style>{`
        @keyframes iterm-ld-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes iterm-ld-dot  { 0%,80%,100% { opacity: 0.2; } 40% { opacity: 1; } }
        .iterm-ld-in { animation: iterm-ld-fade 400ms cubic-bezier(0.16,1,0.3,1) both; }
      `}</style>

      <div className="iterm-ld-in" style={S.stack}>
        <div style={S.wordmark}>
          <span style={{ ...S.prompt, color: accent }}>›_</span>
          <span style={S.brandText}>{appName}</span>
        </div>

        <div style={S.dots} aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ ...S.dot, background: accent, animationDelay: `${i * 0.18}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
};

const S = {
  container: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: font.sans,
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  wordmark: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    fontSize: fontSize['20'],
    fontWeight: fontWeight.semibold,
    letterSpacing: 0,
  },
  prompt: {
    fontFamily: font.mono,
    fontWeight: fontWeight.semibold,
    textShadow: '0 0 18px currentColor',
  },
  brandText: {
    color: 'rgba(228,230,241,0.92)',
    fontFamily: font.brand,
    fontWeight: 400,
    letterSpacing: 0,
    textShadow: '0 8px 28px rgba(0,0,0,0.32)',
  },
  dots: { display: 'flex', gap: '7px' },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    animation: 'iterm-ld-dot 1.2s ease-in-out infinite',
  },
};

export default LoadingScreen;
