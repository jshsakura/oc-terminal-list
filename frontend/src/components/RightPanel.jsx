import { useState, memo } from 'react';
import { FolderTree, GitBranch, Palette, X, RefreshCw } from 'lucide-react';
import { tokens } from '../styles/tokens';
import FileTree from './FileTree';
import ChangesList from './ChangesList';
import themes from '../styles/themes';
import useGitChanges from '../hooks/useGitChanges';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const PANEL_WIDTH = 260;

const TABS = [
  { id: 'files', icon: FolderTree, label: 'Files' },
  { id: 'git',   icon: GitBranch, label: 'Git' },
  { id: 'theme', icon: Palette,   label: 'Theme' },
];

const RightPanel = ({
  activeTabType,    // 'local' | 'host' | null
  activeHostId = null,
  gitContextPath = '',
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
  onRefreshTerminal = null,  // 호출 시 활성 터미널을 통째로 remount (WS 재접속)
  selectedFolderPath = '',
  settings,
  updateSettings,
  language = 'en',
  t,
  viewportHeight,
  disabled = false,  // 빈 pane 일 때 활동바만 표시 / 클릭 무효
}) => {
  const [activePanel, setActivePanel] = useState(null); // null | 'files' | 'git' | 'theme'

  // Git 변경 카운트 — 활동 바 뱃지에 표시. 경로 없으면 fetch 안 함 (전체 워크스페이스 집계 X).
  const { items: gitItems } = useGitChanges({
    enabled: !!gitContextPath && activeTabType === 'local',
    path: gitContextPath,
    intervalMs: 4000,
  });
  const gitCount = gitContextPath ? (gitItems || []).length : 0;

  const togglePanel = (id) => {
    setActivePanel((prev) => (prev === id ? null : id));
  };

  return (
    <div style={styles.root}>
      {/* content panel — absolute overlay (활동바 우측 → 본문 위로 떠서 터미널 폭 안 밀어냄) */}
      {activePanel && !disabled && (
        <div style={{
          ...styles.panel,
          width: `${PANEL_WIDTH}px`,
          position: 'absolute',
          top: 0,
          right: '36px',  // 활동바 폭만큼 띄움
          bottom: 0,
          zIndex: 5,
          boxShadow: '-4px 0 16px rgba(0,0,0,0.35)',
        }}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>
              {TABS.find((t) => t.id === activePanel)?.label}
            </span>
            <button
              style={styles.closeBtn}
              onClick={() => setActivePanel(null)}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
          <div style={styles.panelBody}>
            {activePanel === 'files' && (
              <FileTree
                key={`${activeHostId || 'local'}:${gitContextPath || selectedFolderPath || 'root'}`}
                hostId={activeHostId}
                onFileSelect={onFileSelect}
                onFolderSelect={onFolderSelect}
                onOpenTerminalAtFolder={onOpenTerminalAtFolder}
                gitContextPath={gitContextPath}
                language={language}
                initialPath={activeHostId ? '' : (gitContextPath || selectedFolderPath)}
              />
            )}
            {activePanel === 'git' && (
              <ChangesList
                gitContextPath={gitContextPath}
                onSelectFile={onFileSelect}
                onOpenFile={onFileSelect}
                t={t}
              />
            )}
            {activePanel === 'theme' && (
              <ThemeSettings settings={settings} updateSettings={updateSettings} t={t} />
            )}
          </div>
        </div>
      )}

      {/* activity bar — pane 내부에서 항상 노출. disabled 면 흐리게 + 클릭 무시 */}
      <div style={{ ...styles.activityBar, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        {TABS.map(({ id, icon: Icon, label }) => {
          const isActive = activePanel === id;
          const badge = id === 'git' && gitCount > 0 ? gitCount : null;
          return (
            <button
              key={id}
              style={{
                ...styles.actBtn,
                background: isActive ? color.surface1 : 'transparent',
                color: isActive ? color.accent : color.subtext,
                borderLeft: isActive ? `2px solid ${color.accent}` : '2px solid transparent',
                position: 'relative',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              onClick={() => !disabled && togglePanel(id)}
              title={badge ? `${label} (${badge})` : label}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.text; } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; } }}
            >
              <Icon size={16} strokeWidth={1.8} />
              {badge && (
                <span style={styles.badge}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}

        {/* 분리선 + 터미널 새로고침 — Theme 아래 별도 액션 */}
        {onRefreshTerminal && !disabled && (
          <>
            <div style={{ width: '20px', height: '1px', background: color.border, margin: '6px 0' }} />
            <button
              style={{
                ...styles.actBtn,
                background: 'transparent',
                color: color.subtext,
                cursor: 'pointer',
              }}
              onClick={onRefreshTerminal}
              title={t?.('refreshTerminal') || 'Reload terminal'}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
            >
              <RefreshCw size={15} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// id ↔ display name. id 는 themes map 의 key 와 일치해야 함.
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
};

const THEME_IDS = Object.keys(THEME_LABELS);

const ThemeSettings = memo(({ settings, updateSettings, t }) => {
  const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18];

  return (
    <div style={{ padding: space['3'], display: 'flex', flexDirection: 'column', gap: space['4'] }}>
      <Field label={t?.('theme') || 'Theme'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {THEME_IDS.map((id) => {
            const theme = themes[id];
            if (!theme) return null;
            const isActive = settings.theme === id;
            return (
              <button
                key={id}
                onClick={() => updateSettings({ ...settings, theme: id })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: space['2'],
                  textAlign: 'left',
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
                <span style={{ flex: 1 }}>{THEME_LABELS[id]}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={`${t?.('fontSize') || 'Font size'} · ${settings.fontSize}px`}>
        <input
          type="range"
          min={10}
          max={20}
          step={1}
          value={settings.fontSize ?? 13}
          onChange={(e) => updateSettings({ ...settings, fontSize: parseInt(e.target.value, 10) })}
          style={{
            width: '100%',
            accentColor: color.accent,
            cursor: 'pointer',
          }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: color.muted,
          marginTop: '2px',
        }}>
          <span>10</span><span>15</span><span>20</span>
        </div>
      </Field>
    </div>
  );
});

// 5 색 swatch — 배경/포그라운드/blue/green/red 미리보기
const ThemeSwatch = ({ theme }) => (
  <div style={{
    display: 'flex',
    width: '52px',
    height: '20px',
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

const Field = ({ label, children }) => (
  <div>
    <div style={{
      fontSize: fontSize['11'],
      fontWeight: fontWeight.semibold,
      color: color.subtext,
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      marginBottom: space['2'],
    }}>
      {label}
    </div>
    {children}
  </div>
);

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    flexShrink: 0,
    position: 'relative',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    borderLeft: `1px solid ${color.border}`,
    background: color.base,
    overflow: 'hidden',
    fontFamily: font.sans,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  panelTitle: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: color.subtext,
    padding: '3px',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
  },
  panelBody: {
    flex: 1,
    overflow: 'auto',
  },
  activityBar: {
    width: '36px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: space['2'],
    gap: '2px',
    borderLeft: `1px solid ${color.border}`,
    background: color.mantle,
  },
  actBtn: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 120ms, color 120ms',
    padding: 0,
  },
  badge: {
    position: 'absolute',
    top: '3px',
    right: '3px',
    minWidth: '14px',
    height: '14px',
    padding: '0 3px',
    background: color.accent,
    color: color.crust,
    borderRadius: '7px',
    fontSize: '9px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    boxShadow: `0 0 0 1.5px ${color.mantle}`,
  },
};

export default RightPanel;
