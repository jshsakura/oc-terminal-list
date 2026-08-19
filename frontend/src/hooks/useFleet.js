import { useEffect, useState } from 'react';
import { fleetStore } from '../utils/fleetStore';

/**
 * Subscribe to the shared fleet picture while this view is actually on screen.
 *
 * `enabled` is not a nicety: each refresh costs the backend one SSH round trip per
 * remote host, so a board mounted behind another screen would keep every machine busy
 * for nobody. Unsubscribing stops the shared timer once the last viewer leaves.
 */
const useFleet = (enabled = true) => {
  const [state, setState] = useState(() => fleetStore.getState());

  useEffect(() => {
    if (!enabled) return undefined;
    return fleetStore.subscribe(setState);
  }, [enabled]);

  return { ...state, refresh: fleetStore.refresh };
};

export default useFleet;
