/** TerminalHeader 상단 레일/패널 스타일. 값은 tokens 에서만 가져온다. */
import { tokens } from '../../styles/tokens';
import { TOP_RAIL_HEIGHT } from './panelState';

const { color, font, fontSize, fontWeight, space } = tokens;

export const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    flexShrink: 0,
    position: 'relative',
    pointerEvents: 'none',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--ui-border)',
    borderBottom: '1px solid var(--ui-border)',
    background: 'var(--ui-base)',
    overflow: 'hidden',
    fontFamily: font.sans,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: '1px solid var(--ui-border)',
    flexShrink: 0,
  },
  panelTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    minWidth: 0,
    fontSize: fontSize['12'],
    fontFamily: font.brand,
    fontWeight: 400,
    color: 'var(--ui-subtext)',
    textTransform: 'uppercase',
    letterSpacing: 0,
    lineHeight: 1,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--ui-subtext)',
    padding: '3px',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
  },
  panelBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  activityBar: {
    height: `${TOP_RAIL_HEIGHT}px`,
    width: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '2px',
    paddingLeft: '4px',
    paddingRight: '4px',
    background: 'var(--ui-surface0)',
    borderBottom: '1px solid var(--ui-border)',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'auto',
  },
  divider: {
    alignSelf: 'stretch',
    width: '1px',
    height: '18px',
    background: 'var(--ui-border)',
    margin: '0 2px',
  },
};

export default styles;
