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

// 경계 두 개 사이를 고른다(끝 경계는 포함하지 않는다). 길이가 0 이면 고를 것이 없다.
export const selectionArgsFromEdges = (start, end, cols) => {
  if (!start || !end || !Number.isFinite(cols) || cols <= 0) return null;
  const a = start.row < end.row || (start.row === end.row && start.col <= end.col) ? start : end;
  const b = a === start ? end : start;
  const length = (b.row - a.row) * cols + (b.col - a.col);
  if (length <= 0) return null;
  // 줄 끝 경계(col === cols)에서 시작하면 다음 줄 첫 칸과 같은 자리다.
  const row = Math.max(0, a.row) + (a.col >= cols ? 1 : 0);
  return { column: a.col >= cols ? 0 : Math.max(0, a.col), row, length };
};

export const shouldRouteWheelToPty = ({ bufferType = 'normal', mouseTrackingMode = 'none' } = {}) => (
  (mouseTrackingMode && mouseTrackingMode !== 'none') || bufferType !== 'normal'
);

export const shouldClearSelectionOnScroll = ({ hasSelection = false, lines = 0 } = {}) => (
  hasSelection && Number.isFinite(lines) && lines !== 0
);
