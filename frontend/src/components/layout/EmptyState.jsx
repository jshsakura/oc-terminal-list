import { Plus, Server, Terminal as TerminalIcon, Command } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/**
 * 활성 세션이 하나도 없을 때 보여주는 환영 화면.
 * 단순 "비어있음"이 아니라 "여기서 뭘 할 수 있는가"를 가이드.
 */
const EmptyState = ({ currentTheme, t, handleNewSession }) => {
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.icon}>
          <TerminalIcon size={20} strokeWidth={1.8} />
        </div>
        <h2 style={styles.title}>{t('emptyHeadline') || 'Start a session'}</h2>
        <p style={styles.message}>
          {t('emptyDescription') || 'Spin up a local shell, or pick a saved host on the left to SSH in.'}
        </p>

        <div style={styles.actions}>
          <button onClick={handleNewSession} style={styles.primaryBtn}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.92'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            <Plus size={14} strokeWidth={2} />
            <span>{t('newSession') || 'New session'}</span>
          </button>
          <div style={styles.hintRow}>
            <Server size={11} strokeWidth={2} style={{ color: color.muted }} />
            <span style={styles.hintText}>{t('emptyHostsHint') || 'Or pick a host from the sidebar'}</span>
          </div>
        </div>

        <div style={styles.shortcuts}>
          <Shortcut keys="Ctrl+P" label={t('quickOpenFiles') || 'Quick open'} />
          <Shortcut keys={'Ctrl+\\'} label={t('splitTerminal') || 'Split pane'} />
          <Shortcut keys="Ctrl+`" label={t('focusTerminal') || 'Focus terminal'} />
        </div>
      </div>
    </div>
  );
};

const Shortcut = ({ keys, label }) => (
  <div style={styles.shortcut}>
    <span style={styles.shortcutLabel}>{label}</span>
    <kbd style={styles.kbd}>{keys}</kbd>
  </div>
);

const styles = {
  wrap: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space['6'],
    fontFamily: font.sans,
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: space['3'],
  },
  icon: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    color: color.accent,
    marginBottom: space['1'],
  },
  title: {
    fontSize: fontSize['20'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    margin: 0,
    lineHeight: 1.2,
  },
  message: {
    fontSize: fontSize['13'],
    color: color.muted,
    lineHeight: 1.5,
    margin: 0,
    maxWidth: '320px',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: space['2'],
    marginTop: space['2'],
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space['1.5'],
    height: '32px',
    padding: `0 ${space['4']}`,
    background: color.accent,
    color: color.crust,
    border: 'none',
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontWeight: fontWeight.medium,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: `opacity ${motion.fast}`,
  },
  hintRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space['1'],
  },
  hintText: {
    fontSize: fontSize['11'],
    color: color.muted,
  },
  shortcuts: {
    marginTop: space['5'],
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: space['1'],
    padding: `${space['3']} ${space['4']}`,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  shortcut: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: fontSize['12'],
  },
  shortcutLabel: {
    color: color.subtext,
  },
  kbd: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    color: color.muted,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    padding: '1px 6px',
  },
};

export default EmptyState;
