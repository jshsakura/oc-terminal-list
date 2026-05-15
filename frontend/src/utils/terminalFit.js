export const measureTerminalFit = (term, fallback = null) => {
  const parent = term?.element?.parentElement;
  const dims = term?._core?._renderService?.dimensions;
  const cell = dims?.css?.cell;
  if (!parent || !cell || cell.width <= 0 || cell.height <= 0) return fallback;

  const parentRect = parent.getBoundingClientRect();
  const elStyle = window.getComputedStyle(term.element);
  const padH = parseFloat(elStyle.getPropertyValue('padding-left') || '0')
    + parseFloat(elStyle.getPropertyValue('padding-right') || '0');
  const padV = parseFloat(elStyle.getPropertyValue('padding-top') || '0')
    + parseFloat(elStyle.getPropertyValue('padding-bottom') || '0');
  const availableW = Math.max(0, parentRect.width - padH);
  const availableH = Math.max(0, parentRect.height - padV);
  const cols = Math.max(2, Math.floor(availableW / cell.width));
  const rows = Math.max(1, Math.floor(availableH / cell.height));

  return {
    cols,
    rows,
    remainderX: Math.max(0, availableW - cols * cell.width),
    remainderY: Math.max(0, availableH - rows * cell.height),
  };
};
