import GlassModal from '../components/common/GlassModal';
import { tokens } from '../styles/tokens';
import { themes, themeNames } from '../styles/themes';

const { color, font, fontSize, fontWeight } = tokens;

/**
 * The real Settings panel has a lot more than theming (2FA, snippets, ssh
 * keys...) — none of that means anything without a backend. Theming is the
 * one setting that's both instantly visible and entirely client-side, so
 * that's what this demo exposes: all 60 real theme objects, live-applied via
 * the same applyThemeVars() the production app uses.
 */
const DemoSettingsModal = ({ isOpen, onClose, activeThemeId, onSelectTheme }) => (
  <GlassModal
    isOpen={isOpen}
    onClose={onClose}
    title="Themes"
    ariaLabel="Theme picker"
    maxWidth="640px"
    bodyStyle={{ padding: 0 }}
  >
    <div style={{ padding: '4px 4px 12px' }}>
      <p style={{ fontSize: fontSize['12'], color: color.subtext, margin: '0 0 12px', lineHeight: 1.5 }}>
        {themeNames.length} built-in themes, applied live — this is the same theme engine the real
        app uses. Everything else in Settings (2FA, snippets, SSH keys...) needs a real backend, so
        it isn't part of this demo.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: '8px',
          maxHeight: '48vh',
          overflowY: 'auto',
        }}
      >
        {themeNames.map((id) => {
          const theme = themes[id];
          const isActive = id === activeThemeId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTheme(id)}
              title={id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '6px',
                borderRadius: '8px',
                border: `1.5px solid ${isActive ? color.accent : 'var(--ui-border)'}`,
                background: theme.background,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', gap: '3px' }}>
                {[theme.red, theme.yellow, theme.green, theme.blue, theme.magenta].map((swatch, i) => (
                  <span key={i} style={{ width: '9px', height: '9px', borderRadius: '2px', background: swatch }} />
                ))}
              </div>
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: '10px',
                  fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
                  color: theme.foreground,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {id}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  </GlassModal>
);

export default DemoSettingsModal;
