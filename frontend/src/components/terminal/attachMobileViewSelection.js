import createTerminalGeometry from '../../utils/terminalGeometry';
import { selectionArgsFromCells } from '../../utils/terminalMouseSelection';
import { getLinkAtClient, getFileLinkAtClient } from '../../utils/terminalLinkAt';

const HOLD_MS = 500;
const MOVE_PX = 5;

export const clampViewFontSize = (size) => Math.max(8, Math.min(28, Math.round(size)));

// xterm paints text on a canvas, so removing the touch shield alone cannot give
// phones a text selection. Keep the input shield and select actual buffer cells.
export default function attachMobileViewSelection({ term, overlay, isReadOnly,
  scroll, setContextMenu, onFileLinkClick, onViewFontSize }) {
  if (!overlay) return { detach() {} };
  const { bufferCellFromClientPoint } = createTerminalGeometry(term);
  let gesture = null;
  let holdTimer = null;
  let lastTouchAt = 0;
  const cancel = () => { clearTimeout(holdTimer); gesture = null; };
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const cellAt = (p) => bufferCellFromClientPoint(p.x, p.y);
  const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY);
  const startPinch = (touches) => {
    cancel();
    const span = distance(touches);
    if (!onViewFontSize || span <= 0) { return; }
    term.clearSelection();
    gesture = { kind: 'pinch', span, fontSize: term.options.fontSize };
  };
  const select = (end) => {
    const args = selectionArgsFromCells(gesture.anchor, end, term.cols);
    if (args) term.select(args.column, args.row, args.length);
  };
  const selectWord = () => {
    if (!gesture || !isReadOnly()) return;
    gesture.selecting = true;
    const cell = gesture.anchor;
    const line = term.buffer.active.getLine?.(cell.row);
    const wordCell = (col) => {
      const c = line?.getCell?.(col);
      return c && (c.getWidth() === 0 || !/[\s()[\]{}"'`,;]/u.test(c.getChars() || ' '));
    };
    let start = cell.col;
    let end = cell.col;
    if (wordCell(start)) {
      while (start > 0 && wordCell(start - 1)) start--;
      while (end + 1 < term.cols && wordCell(end + 1)) end++;
    }
    gesture.word = { start: { row: cell.row, col: start }, end: { row: cell.row, col: end } };
    gesture.anchor = gesture.word.start;
    select(gesture.word.end);
  };
  const start = (p, kind) => {
    cancel();
    gesture = { kind, origin: p, last: p, anchor: cellAt(p), selecting: false, scrolling: false };
    if (kind === 'touch') holdTimer = setTimeout(selectWord, HOLD_MS);
  };
  const move = (p, event) => {
    if (!gesture || !isReadOnly()) { cancel(); return; }
    const dx = p.x - gesture.origin.x;
    const dy = p.y - gesture.origin.y;
    if (!gesture.selecting && !gesture.scrolling && Math.max(Math.abs(dx), Math.abs(dy)) <= MOVE_PX) return;
    clearTimeout(holdTimer);
    stop(event);
    if (!gesture.selecting && !gesture.scrolling) {
      // A vertical swipe still browses history. A hold or horizontal drag selects.
      if (gesture.kind === 'touch' && Math.abs(dy) > Math.abs(dx)) {
        gesture.scrolling = true;
        term.clearSelection();
      } else gesture.selecting = true;
    }
    if (gesture.scrolling) scroll((gesture.last.y - p.y) * 0.5, p.x, p.y);
    else {
      const end = cellAt(p);
      if (gesture.word) {
        const before = end.row < gesture.word.start.row || (end.row === gesture.word.start.row && end.col < gesture.word.start.col);
        gesture.anchor = before ? gesture.word.end : gesture.word.start;
      }
      select(end);
    }
    gesture.last = p;
  };
  const end = () => {
    const completed = gesture;
    cancel();
    if (!completed || !isReadOnly() || completed.scrolling) return;
    if (completed.selecting) {
      setContextMenu({ x: completed.last.x, y: completed.last.y,
        hasSelection: term.hasSelection(), linkUrl: getLinkAtClient(term, completed.origin.x, completed.origin.y) });
      return;
    }
    term.clearSelection();
    const { x, y } = completed.origin;
    const url = getLinkAtClient(term, x, y);
    // This must stay in touchend/mouseup to retain the browser's user activation.
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else if (onFileLinkClick) {
      const file = getFileLinkAtClient(term, x, y);
      if (file) onFileLinkClick(file);
    }
  };
  const touchStart = (event) => {
    if (!isReadOnly()) return;
    lastTouchAt = Date.now();
    stop(event);
    if (event.touches.length === 2) { startPinch(event.touches); return; }
    if (event.touches.length !== 1) { cancel(); return; }
    start(point(event.touches[0]), 'touch');
  };
  const touchMove = (event) => {
    if (!isReadOnly()) { cancel(); return; }
    if (gesture?.kind === 'pinch') {
      stop(event);
      if (event.touches.length !== 2) { cancel(); return; }
      onViewFontSize(clampViewFontSize(gesture.fontSize * distance(event.touches) / gesture.span));
      return;
    }
    if (event.touches.length !== 1) { cancel(); return; }
    move(point(event.touches[0]), event);
  };
  const touchEnd = (event) => {
    if (!isReadOnly()) { cancel(); return; }
    stop(event);
    lastTouchAt = Date.now();
    if (gesture?.kind === 'pinch' || event.touches.length > 0) { cancel(); return; }
    end();
  };
  const mouseDown = (event) => {
    if (!isReadOnly() || event.button !== 0) return;
    stop(event);
    if (Date.now() - lastTouchAt < 700) return;
    start(point(event), 'mouse');
  };
  const mouseMove = (event) => {
    if (gesture?.kind !== 'mouse') return;
    if (!(event.buttons & 1)) { cancel(); return; }
    move(point(event), event);
  };
  const mouseUp = (event) => {
    if (gesture?.kind !== 'mouse' || event.button !== 0) return;
    stop(event);
    end();
  };
  overlay.addEventListener('touchstart', touchStart, { passive: false });
  overlay.addEventListener('touchmove', touchMove, { passive: false });
  overlay.addEventListener('touchend', touchEnd, { passive: false });
  overlay.addEventListener('touchcancel', cancel);
  overlay.addEventListener('mousedown', mouseDown);
  document.addEventListener('mousemove', mouseMove, true);
  document.addEventListener('mouseup', mouseUp, true);
  window.addEventListener('blur', cancel);
  return { detach() {
    cancel();
    overlay.removeEventListener('touchstart', touchStart);
    overlay.removeEventListener('touchmove', touchMove);
    overlay.removeEventListener('touchend', touchEnd);
    overlay.removeEventListener('touchcancel', cancel);
    overlay.removeEventListener('mousedown', mouseDown);
    document.removeEventListener('mousemove', mouseMove, true);
    document.removeEventListener('mouseup', mouseUp, true);
    window.removeEventListener('blur', cancel);
  } };
}
