import { useEffect, useState } from 'react';
import { machineStatsStore } from '../utils/machineStatsStore';

const useMachineStats = (enabled = true, monitoring = false) => {
  const [state, setState] = useState(() => machineStatsStore.getState());

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return machineStatsStore.subscribe(setState, { monitoring });
  }, [enabled, monitoring]);

  return { ...state, refresh: machineStatsStore.refresh };
};

export default useMachineStats;
