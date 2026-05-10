import { Moon, Sun, Check, Globe } from 'lucide-react';
import themes from '../../styles/themes';
import { isLight } from '../../styles/themeUI';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const THEME_LABELS = {
  catppuccin: 'Catppuccin Mocha',
  catppuccinMacchiato: 'Catppuccin Macchiato',
  catppuccinFrappe: 'Catppuccin Frappé',
  catppuccinLatte: 'Catppuccin Latte',
  githubDark: 'GitHub Dark',
  githubLight: 'GitHub Light',
  solarizedDark: 'Solarized Dark',
  solarizedLight: 'Solarized Light',
  gruvboxDark: 'Gruvbox Dark',
  gruvboxLight: 'Gruvbox Light',
  tokyoNight: 'Tokyo Night',
  oneDark: 'One Dark',
  dracula: 'Dracula',
  nord: 'Nord',
  rosePine: 'Rosé Pine',
  ayuMirage: 'Ayu Mirage',
  monokaiPro: 'Monokai Pro',
  monokai: 'Monokai',
  nightOwl: 'Night Owl',
  shadesOfPurple: 'Shades of Purple',
  synthwave84: 'Synthwave 84',
  cobalt2: 'Cobalt 2',
  oceanicNext: 'Oceanic Next',
  everforest: 'Everforest',
  palenight: 'Palenight',
  kanagawa: 'Kanagawa',
  moonfly: 'Moonfly',
  horizon: 'Horizon',
  oneLight: 'One Light',
  ayuLight: 'Ayu Light',
  materialDark: 'Material Dark',
  iceberg: 'Iceberg',
  vscodeDark: 'VS Code Dark+',
  tomorrowNight: 'Tomorrow Night',
  nightfly: 'Nightfly',
  halcyon: 'Halcyon',
  tokyoNightStorm: 'Tokyo Night Storm',
  rosePineMoon: 'Rosé Pine Moon',
  ayuDark: 'Ayu Dark',
  snazzy: 'Snazzy',
  andromeda: 'Andromeda',
  paperColor: 'PaperColor',
  rosePineDawn: 'Rosé Pine Dawn',
  vscodeLight: 'VS Code Light+',
  tokyoNightDay: 'Tokyo Night Day',
  flexokiLight: 'Flexoki Light',
  everforestLight: 'Everforest Light',
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ALL_IDS = Object.keys(THEME_LABELS);
const DARK_IDS = ALL_IDS.filter((id) => !isLight(themes[id]?.background || ''));
const LIGHT_IDS = ALL_IDS.filter((id) => isLight(themes[id]?.background || ''));

const ThemeSwatch = ({ theme }) => (
  <div style={{
    display: 'flex',
    width: '44px',
    height: '18px',
    borderRadius: '3px',
    overflow: 'hidden',
    border: `1px solid ${color.border}`,
    flexShrink: 0,
  }}>
    <div style={{ flex: 1, background: theme.background }} />
    <div style={{ flex: 1, background: theme.foreground }} />
    <div style={{ flex: 1, background: theme.blue }} />
    <div style={{ flex: 1, background: theme.green }} />
    <div style={{ flex: 1, background: theme.red }} />
  </div>
);

const SectionHeader = ({ isDark, label }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '10px',
    fontWeight: fontWeight.semibold,
    color: color.muted,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    padding: `${space['2']} 0 ${space['1']}`,
  }}>
    {isDark ? <Moon size={11} /> : <Sun size={11} />}
    {label}
  </div>
);

const ThemeRow = ({ id, theme, isActive, isGlobal, isCurrent, onClick }) => {
  const label = THEME_LABELS[id] || id;
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space['2'],
        textAlign: 'left',
        width: '100%',
        padding: `${space['1.5']} ${space['2']}`,
        background: isActive ? color.surface1 : color.surface0,
        border: `1px solid ${isActive ? color.accent : color.border}`,
        borderRadius: radius.sm,
        color: isActive ? color.text : color.subtext,
        fontSize: fontSize['12'],
        cursor: 'pointer',
        fontFamily: font.sans,
        transition: 'background 120ms, border-color 120ms',
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = color.surface1; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = color.surface0; }}
    >
      <ThemeSwatch theme={theme} />
      <span style={{ flex: 1 }}>{label}</span>
      {isGlobal && (
        <Globe size={11} style={{ color: color.muted, flexShrink: 0 }} />
      )}
      {isCurrent && !isGlobal && (
        <Check size={11} style={{ color: color.accent, flexShrink: 0 }} />
      )}
    </button>
  );
};

/**
 * 공통 테마 피커 — Settings 와 RightPanel 에서 재사용.
 *
 * value    : 현재 이 터미널에 적용된 테마 id → "현재" 배지
 * onChange : (id) => void
 * t        : useTranslation 훅의 t 함수
 * markedId : 글로벌 테마 id → "전체" 배지 (옵션)
 */
const ThemePicker = ({ value, onChange, t, markedId, columns = 1 }) => {
  const renderSection = (ids, isDark, headerKey, headerFallback) => (
    <>
      <SectionHeader isDark={isDark} label={t?.(headerKey) || headerFallback} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '3px',
      }}>
        {ids.map((id) => {
          const theme = themes[id];
          if (!theme) return null;
          return (
            <ThemeRow
              key={id}
              id={id}
              theme={theme}
              isActive={value === id}
              isGlobal={markedId === id}
              isCurrent={value === id}
              onClick={onChange}
              t={t}
            />
          );
        })}
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {renderSection(DARK_IDS, true, 'themeDark', 'Dark')}
      {renderSection(LIGHT_IDS, false, 'themeLight', 'Light')}
    </div>
  );
};

export default ThemePicker;
