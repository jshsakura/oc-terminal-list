import { Server, Terminal as TerminalIcon, FolderTree } from 'lucide-react';
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
          {t('emptyDescriptionV2') || 'Pick a host on the left, or open Files and click "Open terminal here" on a folder.'}
        </p>

        <div style={styles.steps}>
          <div style={styles.step}>
            <div style={styles.stepIcon}><Server size={11} strokeWidth={2} /></div>
            <span>{t('emptyStep1') || 'Hosts → click Local or a saved host'}</span>
          </div>
          <div style={styles.step}>
            <div style={styles.stepIcon}><FolderTree size={11} strokeWidth={2} /></div>
            <span>{t('emptyStep2') || 'Files → expand a folder → "Open terminal here"'}</span>
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
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
    marginTop: space['2'],
    width: '100%',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    fontSize: fontSize['12'],
    color: color.subtext,
    padding: `${space['1.5']} ${space['3']}`,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  stepIcon: {
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    color: color.accent,
    flexShrink: 0,
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
