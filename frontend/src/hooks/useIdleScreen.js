import { useEffect, useSyncExternalStore } from 'react';
import { isRenderPaused, setRenderPaused, subscribeRenderPause } from '../utils/renderPause';

export const IDLE_SCREEN_MINUTES = [0, 1, 2, 5, 10, 15, 30];

export default function useIdleScreen({ enabled, minutes = 5 }) {
  const paused = useSyncExternalStore(subscribeRenderPause, isRenderPaused, () => false);
  const delay = (IDLE_SCREEN_MINUTES.includes(Number(minutes)) ? Number(minutes) : 5) * 60_000;

  useEffect(() => {
    if (!enabled || !delay) {
      setRenderPaused(false);
      return undefined;
    }
    let lastInput = Date.now();
    let timer;
    let previousFocus = null;
    let wakeKey = null;
    let composing = false;
    const wake = () => {
      lastInput = Date.now();
      setRenderPaused(false);
      const surface = document.querySelector('[data-app-surface]');
      if (surface) surface.inert = false;
      if (previousFocus?.isConnected && !previousFocus.readOnly && !previousFocus.disabled) {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocus = null;
      clearTimeout(timer);
      timer = setTimeout(check, delay);
    };
    const check = () => {
      clearTimeout(timer);
      if (isRenderPaused()) return;
      const remaining = delay - (Date.now() - lastInput);
      if (remaining > 0 || composing) {
        timer = setTimeout(check, composing ? delay : remaining);
        return;
      }
      previousFocus = document.activeElement;
      const surface = document.querySelector('[data-app-surface]');
      if (surface) surface.inert = true;
      setRenderPaused(true);
    };
    const activity = (event) => {
      if (isRenderPaused()) {
        // The resting surface owns the complete gesture; underlying controls never see it.
        event.stopImmediatePropagation();
        return;
      }
      lastInput = Date.now();
    };
    const keydown = (event) => {
      if (isRenderPaused() || wakeKey === event.code) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (isRenderPaused()) {
          wakeKey = event.code;
          wake();
        }
        return;
      }
      activity(event);
    };
    const keyup = (event) => {
      if (wakeKey !== null && event.code === wakeKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        wakeKey = null;
      }
    };
    const click = (event) => {
      if (!isRenderPaused()) { activity(event); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      wake();
    };
    const compositionStart = () => { composing = true; lastInput = Date.now(); };
    const compositionEnd = () => { composing = false; lastInput = Date.now(); };
    const visible = () => { if (!document.hidden) check(); };
    const activityEvents = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchend', 'wheel', 'scroll', 'input'];
    for (const name of activityEvents) window.addEventListener(name, activity, true);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('click', click, true);
    window.addEventListener('contextmenu', click, true);
    window.addEventListener('compositionstart', compositionStart, true);
    window.addEventListener('compositionend', compositionEnd, true);
    document.addEventListener('visibilitychange', visible);
    timer = setTimeout(check, delay);
    return () => {
      clearTimeout(timer);
      for (const name of activityEvents) window.removeEventListener(name, activity, true);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('contextmenu', click, true);
      window.removeEventListener('compositionstart', compositionStart, true);
      window.removeEventListener('compositionend', compositionEnd, true);
      document.removeEventListener('visibilitychange', visible);
      const surface = document.querySelector('[data-app-surface]');
      if (surface) surface.inert = false;
      setRenderPaused(false);
    };
  }, [enabled, delay]);

  return paused;
}
