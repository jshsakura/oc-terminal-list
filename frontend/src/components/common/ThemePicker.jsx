import { Moon, Sun, Check, Globe } from 'lucide-react';
import themes from '../../styles/themes';
import { isLight } from '../../styles/themeUI';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const THEME_LABELS = {
  // Dark — 차갑고 어두운
  catppuccin:          'Catppuccin Mocha',
  catppuccinMacchiato: 'Catppuccin Macchiato',
  tokyoNight:          'Tokyo Night',
  nord:                'Nord',
  cobalt2:             'Cobalt 2',
  ayuDark:             'Ayu Dark',
  // Dark — 보라/핑크
  dracula:             'Dracula',
  rosePine:            'Rosé Pine',
  shadesOfPurple:      'Shades of Purple',
  synthwave84:         'Synthwave 84',
  sakuraDark:          'Sakura Dark',
  // Dark — 따뜻한/뉴트럴
  gruvboxDark:         'Gruvbox Dark',
  monokai:             'Monokai',
  monokaiPro:          'Monokai Pro',
  ayuMirage:           'Ayu Mirage',
  tender:              'Tender',
  zenburn:             'Zenburn',
  // Dark — 그린/네이처
  everforest:          'Everforest',
  kanagawa:            'Kanagawa',
  panda:               'Panda',
  // Dark — 중간 다크
  oneDark:             'One Dark',
  nightOwl:            'Night Owl',
  vscodeDark:          'VS Code Dark+',
  tomorrowNight:       'Tomorrow Night',
  solarizedDark:       'Solarized Dark',
  oceanicNext:         'Oceanic Next',
  githubDark:          'GitHub Dark',
  horizon:             'Horizon',
  andromeda:           'Andromeda',
  // Dark — 네온
  cyberdream:          'Cyberdream',
  // Light
  catppuccinLatte:     'Catppuccin Latte',
  solarizedLight:      'Solarized Light',
  flexokiLight:        'Flexoki Light',
  gruvboxLight:        'Gruvbox Light',
  ayuLight:            'Ayu Light',
  rosePineDawn:        'Rosé Pine Dawn',
  sepia:               'Sepia',
  noctisLux:           'Noctis Lux',
  lavender:            'Lavender',
  blossom:             'Blossom',
  springDay:           'Spring Day',
  tokyoNightDay:       'Tokyo Night Day',
  everforestLight:     'Everforest Light',
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
