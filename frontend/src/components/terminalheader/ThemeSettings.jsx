/** 설정 패널의 테마 섹션 — pane 별 테마 오버라이드와 전역 테마 표시/해제. */
import { memo } from 'react';
import { tokens } from '../../styles/tokens';
import themes from '../../styles/themes';
import ThemePicker from '../common/ThemePicker';
import { buildThemeUI } from '../../styles/themeUI';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

export const ThemeSettings = memo(({ paneThemeId, globalThemeId, onPaneThemeChange, t }) => {
  const effectiveId = paneThemeId || globalThemeId;
  const isOverridden = !!paneThemeId && !!globalThemeId && paneThemeId !== globalThemeId;
  const theme = themes[effectiveId] || themes.catppuccin;
  const ui = buildThemeUI(theme);

  return (
    <div style={{ padding: space['3'], display: 'flex', flexDirection: 'column', gap: space['4'] }}>
      <Field
        label={t?.('theme') || 'Theme'}
        hint={
          isOverridden
            ? (t?.('themePerPaneOverride') || 'This terminal only — global theme is unchanged.')
            : (t?.('themePerPaneHint') || 'Applies to this terminal only. Global theme lives in Settings.')
        }
        action={
          isOverridden && onPaneThemeChange ? (
            <button
              type="button"
              onClick={() => onPaneThemeChange(globalThemeId)}
              style={{
                background: 'transparent',
                border: `1px solid ${ui.border}`,
                color: ui.subtext,
                fontSize: fontSize['11'],
                fontFamily: font.sans,
                padding: '2px 8px',
                borderRadius: radius.xs,
                cursor: 'pointer',
              }}
              title={t?.('resetToGlobalTheme') || 'Reset to global theme'}
            >
              {t?.('reset') || 'Reset'}
            </button>
          ) : null
        }
      >
        <ThemePicker
          value={effectiveId}
          onChange={onPaneThemeChange}
          t={t}
          markedId={globalThemeId}
          showRandom
        />
      </Field>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Info 패널 — 세션 메타데이터 + 시스템 자원(CPU/RAM/Disk/Load).
// 자원 정보는 패널이 *열려 있는 동안만* 2초 polling. 닫으면 즉시 멈춤.


export const Field = ({ label, hint = null, action = null, children }) => (
  <div>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space['2'],
      marginBottom: hint ? '4px' : space['2'],
    }}>
      <div style={{
        fontSize: fontSize['11'],
        fontWeight: fontWeight.semibold,
        color: 'var(--ui-subtext)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
      }}>
        {label}
      </div>
      {action}
    </div>
    {hint && (
      <div style={{
        fontSize: '11px',
        color: 'var(--ui-subtext)',
        marginBottom: space['2'],
        lineHeight: 1.4,
      }}>
        {hint}
      </div>
    )}
    {children}
  </div>
);

export default ThemeSettings;
