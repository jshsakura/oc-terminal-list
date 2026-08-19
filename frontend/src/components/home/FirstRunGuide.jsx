import { memo } from 'react';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * What to do first, shown only while there is nothing to do.
 *
 * A first-time screen here is an empty host list and an empty session list — accurate,
 * and no help at all. Three lines is the whole guide, and the third one is the point of
 * the app: work does not stay in the terminal you opened.
 *
 * It disappears the moment a host exists, so it needs no dismiss button and cannot
 * become clutter for someone who already knows.
 */
const STEPS = [
  { key: 'guideStep1', fallback: 'Add a server below. Keys and passwords are stored encrypted and never shown again.' },
  { key: 'guideStep2', fallback: 'Click it to open a terminal there. It keeps running after you close the window.' },
  { key: 'guideStep3', fallback: 'Hand work to another terminal: itl list shows the addresses, itl send 1.2 "…" delivers. Nothing to install.' },
];

const FirstRunGuide = ({ t = null }) => (
  <div style={S.card}>
    <div style={S.title}>{t?.('guideTitle') || 'Getting started'}</div>
    <ol style={S.list}>
      {STEPS.map((step, index) => (
        <li key={step.key} style={S.item}>
          <span style={S.num}>{index + 1}</span>
          <span style={S.text}>{t?.(step.key) || step.fallback}</span>
        </li>
      ))}
    </ol>
  </div>
);

const S = {
  card: {
    display: 'flex', flexDirection: 'column', gap: space['2'],
    padding: space['3'],
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  title: {
    fontSize: fontSize['11'], fontWeight: fontWeight.medium, color: color.muted,
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, padding: 0, listStyle: 'none' },
  item: { display: 'flex', alignItems: 'flex-start', gap: '8px' },
  num: {
    flexShrink: 0, width: '16px', height: '16px', marginTop: '1px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '4px', fontFamily: font.mono, fontSize: '10px',
    color: color.subtext, background: `color-mix(in srgb, ${color.text} 7%, transparent)`,
    border: `1px solid ${color.border}`, boxSizing: 'border-box',
  },
  text: { fontSize: fontSize['11'], lineHeight: 1.55, color: color.subtext, wordBreak: 'keep-all', overflowWrap: 'anywhere' },
};

export default memo(FirstRunGuide);
