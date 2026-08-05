import { Monitor } from 'lucide-react';
import GlassModal from '../common/GlassModal';
import { tokens } from '../../styles/tokens';
import { VNC_VIEW_FIT, VNC_VIEW_PAN } from '../../utils/vncResize';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * VNC settings for one pane, in a modal.
 *
 * The remote desktop *is* the content, so nothing may sit on top of it: no rail,
 * no floating buttons. Settings open from the tab menu, are changed here, and the
 * screen goes back to being just the desktop.
 *
 * Changes are applied to the live RFB by `VncPane` the moment they are picked —
 * this modal only reports the choice.
 */
const VncSettingsModal = ({
  isOpen, onClose, viewMode, quality, onViewMode, onQuality, remoteSize, t,
}) => (
  <GlassModal
    isOpen={isOpen}
    onClose={onClose}
    title={t?.('vncSettings') || 'VNC settings'}
    titleIcon={Monitor}
    ariaLabel={t?.('vncSettings') || 'VNC settings'}
    maxWidth="360px"
    closeTitle={t?.('close') || 'Close'}
  >
    <Group label={t?.('vncView') || 'View'}>
      <Choice
        active={viewMode !== VNC_VIEW_PAN}
        label={t?.('vncViewFit') || 'Fit to screen'}
        hint={t?.('vncViewFitHint') || 'Scale the whole desktop down to the pane'}
        onClick={() => onViewMode?.(VNC_VIEW_FIT)}
      />
      <Choice
        active={viewMode === VNC_VIEW_PAN}
        label={t?.('vncViewPan') || 'Actual size · drag'}
        hint={t?.('vncViewPanHint') || 'Real pixels; drag to move, tap to click'}
        onClick={() => onViewMode?.(VNC_VIEW_PAN)}
      />
    </Group>

    {remoteSize && (
      <Group label={t?.('vncResolution') || 'Resolution'}>
        <div style={{
          fontSize: fontSize['12'], color: color.text, fontFamily: font.mono, padding: '2px 2px 0',
        }}>
          {remoteSize.width} × {remoteSize.height}
        </div>
        {/* A desktop this small was created from (or shrunk by) a phone-sized pane.
            No client setting can un-crop it — the window layout is already clipped
            on the remote — so say what to do instead. */}
        {(remoteSize.width < 1024 || remoteSize.height < 600) && (
          <div style={{ fontSize: fontSize['10'], color: color.warning, lineHeight: 1.4, padding: '2px' }}>
            {t?.('vncTinyDesktop')
              || 'This desktop was created at a phone-sized resolution, so its windows are cut off. Terminate it in the display picker and create it again.'}
          </div>
        )}
      </Group>
    )}

    <Group label={t?.('vncQuality') || 'Quality'}>
      {[
        ['sharp', t?.('vncQualitySharp') || 'Sharp', t?.('vncQualitySharpHint') || 'Best image, heaviest traffic'],
        ['balanced', t?.('vncQualityBalanced') || 'Balanced', t?.('vncQualityBalancedHint') || 'Default'],
        ['light', t?.('vncQualityLight') || 'Light', t?.('vncQualityLightHint') || 'Strong compression for slow links'],
      ].map(([value, label, hint]) => (
        <Choice
          key={value}
          active={quality === value}
          label={label}
          hint={hint}
          onClick={() => onQuality?.(value)}
        />
      ))}
    </Group>
  </GlassModal>
);

const Group = ({ label, children }) => (
  <div style={{ marginBottom: space['4'] }}>
    <div style={{
      fontSize: fontSize['10'],
      fontWeight: fontWeight.semibold,
      color: color.subtext,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: '6px',
    }}>
      {label}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{children}</div>
  </div>
);

const Choice = ({ active, label, hint, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      width: '100%',
      textAlign: 'left',
      padding: '8px 10px',
      minHeight: '44px',          // finger-sized: this is used on a phone
      background: active ? color.accentSubtle : color.surface1,
      border: `1px solid ${active ? color.accentBorder : color.border}`,
      borderRadius: radius.md,
      cursor: 'pointer',
      fontFamily: font.sans,
      outline: 'none',
    }}
  >
    <span style={{
      fontSize: fontSize['12'],
      fontWeight: active ? fontWeight.semibold : fontWeight.medium,
      color: active ? color.accent : color.text,
    }}>
      {label}
    </span>
    {hint && (
      <span style={{ fontSize: fontSize['10'], color: color.subtext, lineHeight: 1.35 }}>
        {hint}
      </span>
    )}
  </button>
);

export default VncSettingsModal;
