import { Monitor } from 'lucide-react';
import { MenuItem } from '../tabBar/MenuItem';
import { emitVncControl } from './vncControlBus';

/**
 * The VNC pane's entry in the tab / sub-tab menu: one row that opens the
 * settings modal.
 *
 * A VNC pane draws no TerminalHeader (see `Pane.jsx`), and nothing may float on
 * top of the desktop either — the desktop is the content. So the menu holds a
 * single door, and everything else happens in the modal.
 *
 * @param {string} paneId  the VNC pane this menu belongs to
 * @param {() => void} onDone  close the menu
 */
const VncMenuItems = ({ paneId, onDone, t }) => {
  if (!paneId) return null;
  return (
    <MenuItem
      icon={Monitor}
      onClick={() => { emitVncControl(paneId, { openSettings: true }); onDone?.(); }}
    >
      {t?.('vncSettings') || 'VNC settings'}
    </MenuItem>
  );
};

export default VncMenuItems;
