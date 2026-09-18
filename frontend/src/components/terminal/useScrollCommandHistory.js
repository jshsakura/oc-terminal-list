import { useEffect, useRef } from 'react';
import { COMMAND_HISTORY_EVENT, fetchPage, readLocalCommands } from '../../utils/commandHistory';

// Share the Recent commands store. Read once when browsing local scrollback,
// then only after history changes, never once per scroll frame or output chunk.
export default function useScrollCommandHistory(terminalKey, enabled, onChange) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    changeRef.current([]);
    if (!enabled || !terminalKey) return;
    let disposed = false;
    let generation = 0;
    let controller;
    let debounce;
    changeRef.current(readLocalCommands(terminalKey));
    const reload = async () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      const version = ++generation;
      const timeout = setTimeout(() => current.abort(), 5000);
      try {
        const { items } = await fetchPage(terminalKey, { limit: 100, signal: current.signal });
        if (!disposed && version === generation) changeRef.current(items);
      } finally {
        clearTimeout(timeout);
      }
    };
    const onUpdate = (event) => {
      if (event.detail?.terminalKey && event.detail.terminalKey !== terminalKey) return;
      clearTimeout(debounce);
      debounce = setTimeout(reload, 150);
    };
    window.addEventListener(COMMAND_HISTORY_EVENT, onUpdate);
    reload();
    return () => {
      disposed = true;
      clearTimeout(debounce);
      controller?.abort();
      window.removeEventListener(COMMAND_HISTORY_EVENT, onUpdate);
    };
  }, [terminalKey, enabled]);
}
