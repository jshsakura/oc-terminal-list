import { useEffect, useRef } from 'react';
import useEvent from './useEvent';

export const SELECTION_TO_COMMAND_INPUT_EVENT = 'iterm:selection-to-command-input';

export default function useSelectionToCommandInput({ isMobile, mobileViewOnly, enableMobileInput,
  isSourceAvailable, onActivateSource, setCommandText, setCommandInputOpen }) {
  const pending = useRef(false);
  const mounted = useRef(false);
  const receiveSelection = useEvent(async (event) => {
    const detail = event.detail;
    if (pending.current || typeof detail?.text !== 'string' || !detail.text.trim()
      || !isSourceAvailable(detail)) {
      return;
    }
    pending.current = true;
    try {
      if (isMobile && mobileViewOnly && !await enableMobileInput()) {
        return;
      }
      if (!mounted.current || !isSourceAvailable(detail)) {
        return;
      }
      onActivateSource(detail);
      setCommandText(previous => previous
        ? `${previous}${previous.endsWith('\n') ? '' : '\n'}${detail.text}` : detail.text);
      setCommandInputOpen(true);
    } finally {
      pending.current = false;
    }
  });
  useEffect(() => {
    mounted.current = true;
    window.addEventListener(SELECTION_TO_COMMAND_INPUT_EVENT, receiveSelection);
    return () => {
      mounted.current = false;
      window.removeEventListener(SELECTION_TO_COMMAND_INPUT_EVENT, receiveSelection);
    };
  }, [receiveSelection]);
}
