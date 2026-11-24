import { createPortal } from 'react-dom';
import { Anchor, CornerDownLeft, Terminal } from 'lucide-react';
import { tokens } from '../styles/tokens';
import './IdleScreen.css';

const { color, font, fontSize, fontWeight, space, lineHeight, radius, z } = tokens;

export default function IdleScreen({ t }) {
  return createPortal(
    <button type="button" className="iterm-idle-screen" aria-label={t('idleScreenResume')}
      aria-describedby="iterm-idle-status iterm-idle-connection" style={styles.screen}>
      <span className="iterm-idle-content" style={{ gap: space['6'] }}>
        <span className="iterm-idle-brand" style={{ gap: space['3'] }}>
          <span className="iterm-idle-symbol" style={styles.symbol}>
            <Terminal size={24} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <span className="iterm-idle-wordmark" style={{ gap: space['1.5'] }}>
            <span style={styles.brand}>{t('appName')}</span>
            <span id="iterm-idle-status" style={styles.caption}>{t('idleScreenTitle')}</span>
          </span>
        </span>
        <span className="iterm-idle-screen-resume" style={styles.resume}>
          <span>{t('idleScreenResume')}</span>
          <CornerDownLeft size={14} strokeWidth={1.5} aria-hidden="true" />
        </span>
      </span>
      <span id="iterm-idle-connection" className="iterm-idle-connection" style={{ ...styles.caption, gap: space['2'] }}>
        <Anchor size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>{t('idleScreenConnection')}</span>
      </span>
    </button>, document.body,
  );
}

const styles = {
  screen: {
    '--idle-padding': space['8'],
    background: color.base,
    color: color.text,
    fontFamily: font.sans,
    gap: space['8'],
    zIndex: z.idleScreen,
  },
  symbol: {
    width: space['12'],
    height: space['12'],
    borderRadius: radius.xl,
    background: color.surface0,
    color: color.accent,
  },
  brand: {
    fontFamily: font.brand,
    fontSize: fontSize['20'],
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.tight,
  },
  caption: {
    color: color.subtext,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.relaxed,
  },
  resume: {
    gap: space['2'],
    padding: `${space['3']} ${space['4']}`,
    borderRadius: radius.md,
    fontSize: fontSize['13'],
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
};
