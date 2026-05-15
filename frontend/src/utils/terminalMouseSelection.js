export const shouldUseNaturalMouseSelection = ({ event, isMobile = false, mouseTrackingMode = 'none' }) => {
  if (!event || isMobile) return false;
  if (event.button !== 0) return false;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
  return mouseTrackingMode && mouseTrackingMode !== 'none';
};

export const selectionArgsFromCells = (start, end, cols) => {
  if (!start || !end || !Number.isFinite(cols) || cols <= 0) return null;
  const a = start.row < end.row || (start.row === end.row && start.col <= end.col) ? start : end;
  const b = a === start ? end : start;
  return {
    column: Math.max(0, a.col),
    row: Math.max(0, a.row),
    length: Math.max(1, (b.row - a.row) * cols + (b.col - a.col) + 1),
  };
};

export const shouldRouteWheelToPty = ({ bufferType = 'normal', mouseTrackingMode = 'none' } = {}) => (
  (mouseTrackingMode && mouseTrackingMode !== 'none') || bufferType !== 'normal'
);
