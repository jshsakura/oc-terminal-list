import { useEffect, useRef, useState } from 'react';

export default function useQuickBarReorder({ keys, setId, scrollRef, onReorder }) {
  const latest = useRef({ keys, onReorder });
  latest.current = { keys, onReorder };
  const gesture = useRef(null);
  const suppressed = useRef(null);
  const [preview, setPreview] = useState(null);
  const [dragId, setDragId] = useState(null);
  const cancelRef = useRef(() => {});

  useEffect(() => {
    let frame = 0;
    const finish = (commit = false) => {
      const current = gesture.current;
      if (!current) return;
      clearTimeout(current.timer);
      cancelAnimationFrame(frame);
      suppressed.current = { target: current.button, until: Date.now() + 800 };
      gesture.current = null;
      setPreview(null);
      setDragId(null);
      if (commit && current.dragging && current.changed) latest.current.onReorder?.(current.keys);
    };
    cancelRef.current = () => finish();
    const moveKey = () => {
      const current = gesture.current;
      const scroll = scrollRef.current;
      if (!current?.dragging || !scroll) return;
      const bounds = scroll.getBoundingClientRect();
      const edge = current.x < bounds.left + 24 ? -12 : current.x > bounds.right - 24 ? 12 : 0;
      if (edge) scroll.scrollLeft += edge;
      const buttons = [...scroll.querySelectorAll('[data-mobile-key-id]')];
      const target = buttons.find(button => {
        const rect = button.getBoundingClientRect();
        return current.x >= rect.left && current.x <= rect.right;
      });
      if (target && target.dataset.mobileKeyId !== current.id) {
        const from = current.keys.findIndex(key => key.id === current.id);
        const to = current.keys.findIndex(key => key.id === target.dataset.mobileKeyId);
        const rect = target.getBoundingClientRect();
        if (from >= 0 && to >= 0 && (from < to ? current.x >= (rect.left + rect.right) / 2 : current.x <= (rect.left + rect.right) / 2)) {
          const next = [...current.keys];
          const [key] = next.splice(from, 1);
          next.splice(to, 0, key);
          current.keys = next;
          current.changed = true;
          setPreview(next);
        }
      }
      frame = requestAnimationFrame(moveKey);
    };
    const move = event => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX;
      if (!current.dragging && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 8) {
        current.moved = true;
        clearTimeout(current.timer);
      }
    };
    const up = event => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const tap = !current.dragging && !current.moved;
      const button = current.button;
      finish(true);
      if (tap) button.click();
    };
    const cancel = () => finish();
    const touchMove = event => { if (gesture.current?.dragging) event.preventDefault(); };
    const start = event => {
      const button = event.target.closest?.('[data-mobile-key-id]');
      if (!latest.current.onReorder || !button || button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      finish();
      const current = { button, id: button.dataset.mobileKeyId, pointerId: event.pointerId,
        startX: event.clientX, startY: event.clientY, x: event.clientX, keys: latest.current.keys,
        dragging: false, moved: false, changed: false };
      gesture.current = current;
      current.timer = setTimeout(() => {
        if (gesture.current !== current || current.moved) return;
        current.dragging = true;
        setDragId(current.id);
        frame = requestAnimationFrame(moveKey);
      }, 400);
    };
    const scroll = scrollRef.current;
    scroll?.addEventListener('pointerdown', start, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('touchmove', touchMove, { capture: true, passive: false });
    window.addEventListener('blur', cancel);
    return () => {
      finish();
      scroll?.removeEventListener('pointerdown', start, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('touchmove', touchMove, true);
      window.removeEventListener('blur', cancel);
    };
  }, [scrollRef]);
  useEffect(() => { cancelRef.current(); }, [setId]);

  const intercept = event => {
    if (!gesture.current) return;
    event.stopPropagation();
    if (event.type === 'mousedown') event.preventDefault();
  };
  return { keys: preview || keys, dragId, handlers: {
    onMouseDownCapture: intercept,
    onTouchStartCapture: intercept,
    onClickCapture: event => {
      if (event.detail !== 0 && suppressed.current?.target === event.target.closest('[data-mobile-key-id]')
        && Date.now() < suppressed.current.until) { event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenu: event => { if (onReorder) event.preventDefault(); },
  } };
}
