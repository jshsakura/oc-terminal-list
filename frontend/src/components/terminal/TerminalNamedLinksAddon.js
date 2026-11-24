import { getPresentedNamedLinks, namedFileLink, rangeContainsCell, terminalNamedLinkPresentations as presentations } from '../../utils/terminalNamedLinks';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import terminalNamedLinkIcon from './terminalNamedLinkIcon';

export const showTerminalLinkTarget = (term, target, point) => {
  presentations.get(term)?.showTarget(target, point);
};

export const toggleTerminalNamedLink = (term, point) => {
  return presentations.get(term)?.toggleAt(point) || false;
};

export default class TerminalNamedLinksAddon {
  constructor({ onFileLinkClick = null } = {}) {
    this.onFileLinkClick = onFileLinkClick;
    this.disposables = [];
    this.frame = null;
    this.signature = null;
  }

  activate(term) {
    this.term = term;
    presentations.set(term, this);
    this.disposables.push(term.registerLinkProvider({
      provideLinks: (line, callback) => {
        const links = this.links(line - 1, line - 1);
        callback(links.flatMap(link => [{
          text: link.target,
          range: link.labelRange,
          activate() {},
        }, ...link.hiddenRanges.map(range => ({
          text: link.target, range,
          decorations: { pointerCursor: false, underline: false },
          activate() {},
        }))]));
      },
    }));
    for (const event of ['onRender', 'onScroll', 'onResize', 'onSelectionChange']) {
      this.disposables.push(term[event](() => {
        if ((event === 'onScroll' || event === 'onResize') && this.status) {
          this.status.hidden = true;
          this.expandedKey = null;
        }
        this.schedule();
      }));
    }
    this.schedule();
  }

  links(start, end) {
    return getPresentedNamedLinks(this.term, Math.max(0, start - 1), end, { allowFiles: !!this.onFileLinkClick }).map(link => {
      const { cols, buffer } = this.term;
      const sourceRange = link.labelRange;
      const iconCells = Math.min(2, cols - sourceRange.start.x + 1);
      let x = sourceRange.start.x + iconCells + 1;
      let y = sourceRange.start.y;
      const glyphs = [];
      for (let row = sourceRange.start.y; row <= sourceRange.end.y; row++) {
        const line = buffer.active.getLine(row - 1);
        const startCol = row === sourceRange.start.y ? sourceRange.start.x : 1;
        let endCol = row === sourceRange.end.y ? sourceRange.end.x : cols;
        while (endCol >= startCol && !line.getCell(endCol - 1).getChars()) { endCol--; }
        for (let col = startCol; col <= endCol; col++) {
          const cell = line.getCell(col - 1);
          const width = cell.getWidth();
          const text = cell.isInvisible() ? ' ' : cell.getChars() || ' ';
          if (!width) { continue; }
          if (x + width - 1 > cols) { x = 1; y++; }
          glyphs.push({ x, y, width, text, style: this.cellStyle(cell) });
          x += width;
        }
      }
      return { ...link, sourceRange, iconCells, glyphs, labelRange: { start: sourceRange.start, end: { x: x - 1, y } } };
    });
  }

  cellStyle(cell) {
    const { options } = this.term;
    const colors = this.term._core._themeService.colors;
    const color = foreground => {
      const value = foreground ? cell.getFgColor() : cell.getBgColor();
      if (foreground ? cell.isFgRGB() : cell.isBgRGB()) { return { css: `#${value.toString(16).padStart(6, '0')}`, rgba: ((value << 8) | 255) >>> 0 }; }
      if (foreground ? cell.isFgPalette() : cell.isBgPalette()) {
        const bright = foreground && cell.isBold() && options.drawBoldTextInBrightColors && value < 8;
        return colors.ansi[value + (bright ? 8 : 0)];
      }
      return foreground ? colors.foreground : colors.background;
    };
    const foreground = color(!cell.isInverse());
    const background = color(!!cell.isInverse());
    const cache = cell.isDim() ? colors.halfContrastCache : colors.contrastCache;
    const backgroundKey = cell.isDim() ? ((background.rgba & 0xffffff00) | Math.round((background.rgba & 255) / 2)) >>> 0 : background.rgba;
    const adjusted = options.minimumContrastRatio === 1 ? null : cache.getColor(backgroundKey, foreground.rgba) ?? cache.getColor(cell.bg, cell.fg);
    return {
      color: (adjusted || foreground).css, backgroundColor: background.css,
      fontWeight: cell.isBold() ? options.fontWeightBold : options.fontWeight,
      fontStyle: cell.isItalic() ? 'italic' : 'normal', opacity: cell.isDim() ? 0.5 : 1,
      textDecorationLine: [cell.isStrikethrough() && 'line-through', cell.isOverline() && 'overline'].filter(Boolean).join(' ') || 'none',
    };
  }

  open(link) {
    if (link.kind === 'file') {
      this.onFileLinkClick?.(namedFileLink(link.target));
    } else {
      window.open(link.target, '_blank', 'noopener,noreferrer');
    }
  }

  mount() {
    const container = this.term.element?.parentElement;
    const parent = container?.parentElement;
    if (!parent) { return false; }
    if (!this.layer) {
      this.clickContainer = container;
      this.handleClick = event => {
        if (event.button === 0 && this.toggleAt({ x: event.clientX, y: event.clientY })) {
          event.stopPropagation();
        }
      };
      container.addEventListener('click', this.handleClick, true);
      this.layer = document.createElement('div');
      this.layer.className = 'terminal-named-links';
      this.iconHost = document.createElement('div');
      this.iconRoot = createRoot(this.iconHost);
      this.status = document.createElement('div');
      this.status.className = 'terminal-link-target';
      this.status.hidden = true;
      this.status.setAttribute('role', 'status');
      this.address = document.createElement('span');
      this.status.append(this.address);
      parent.append(this.layer, this.status);
    }
    const theme = this.term.options.theme;
    this.layer.style.setProperty('--terminal-link-bg', theme.background);
    this.layer.style.setProperty('--terminal-link-fg', theme.foreground);
    this.layer.style.fontFamily = this.term.options.fontFamily;
    this.layer.style.fontSize = `${this.term.options.fontSize}px`;
    this.status.style.background = theme.background;
    this.status.style.color = theme.foreground;
    this.status.style.fontFamily = this.term.options.fontFamily;
    this.status.style.fontSize = `${this.term.options.fontSize}px`;
    return true;
  }

  toggle(link) {
    if (this.expandedKey === link.key && this.status && !this.status.hidden) {
      this.status.hidden = true;
      this.expandedKey = null;
      return;
    }
    const buffer = this.term.buffer.active;
    const below = this.term.rows - (link.labelRange.end.y - buffer.viewportY);
    const needed = Math.min(3, Math.ceil(link.target.length / this.term.cols));
    if (below < needed && buffer.viewportY < buffer.baseY) {
      this.term.scrollLines(needed - below);
    }
    this.expandedKey = link.key;
    this.showTarget(link.target, null, link.labelRange);
  }

  toggleAt(point) {
    const rect = this.term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
    const cell = this.term._core?._renderService?.dimensions?.css?.cell;
    if (!rect || !cell?.width || !cell?.height) { return false; }
    const row = this.term.buffer.active.viewportY + Math.floor((point.y - rect.top) / cell.height);
    const col = Math.floor((point.x - rect.left) / cell.width);
    const link = this.links(row, row).find(link => rangeContainsCell(link.labelRange, row, col));
    if (!link) { return false; }
    this.toggle(link);
    return true;
  }

  showTarget(target, point = null, range = null) {
    if (!this.mount()) { return; }
    const term = this.term;
    const screen = term.element.querySelector('.xterm-screen');
    const rect = screen?.getBoundingClientRect();
    const parent = this.status.parentElement.getBoundingClientRect();
    const cell = term._core?._renderService?.dimensions?.css?.cell;
    if (!rect?.width || !cell?.width || !cell?.height) { return; }
    const viewport = term.buffer.active.viewportY;
    if (!range && point) {
      const row = viewport + Math.floor((point.y - rect.top) / cell.height);
      const col = Math.floor((point.x - rect.left) / cell.width);
      range = this.links(row, row).find(link => rangeContainsCell(link.labelRange, row, col))?.labelRange
        || { start: { x: col + 1, y: row + 1 }, end: { x: col + 1, y: row + 1 } };
    }
    if (!range) { return; }
    const buttonWrap = range.end.x * cell.width + 24 > rect.width;
    const left = Math.max(rect.left - parent.left + (buttonWrap ? 24 : 0), rect.left - parent.left + (range.start.x - 1) * cell.width);
    const top = rect.top - parent.top + (range.end.y - viewport) * cell.height;
    this.address.textContent = target;
    Object.assign(this.status.style, {
      left: `${left}px`, top: `${top}px`, lineHeight: `${cell.height}px`,
      width: `${Math.max(0, Math.min(rect.right, parent.right) - parent.left - left)}px`,
      maxHeight: `${Math.max(cell.height, Math.min(parent.height * 0.3, parent.height - top))}px`,
    });
    this.status.hidden = false;
  }

  schedule() {
    if (this.frame !== null) { return; }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  render() {
    if (!this.mount()) { return; }
    const term = this.term;
    const screen = term.element.querySelector('.xterm-screen');
    const rect = screen?.getBoundingClientRect();
    const parent = this.layer.parentElement.getBoundingClientRect();
    const cell = term._core?._renderService?.dimensions?.css?.cell;
    if (!rect?.width || !cell?.width || !cell?.height) { this.layer.replaceChildren(); this.signature = null; return; }
    const top = term.buffer.active.viewportY;
    const links = this.links(top, top + term.rows - 1);
    if (this.expandedKey && !links.some(link => link.key === this.expandedKey)) {
      this.status.hidden = true;
      this.expandedKey = null;
    }
    const geometry = [rect.left - parent.left, rect.top - parent.top, rect.width, rect.height, cell.width, cell.height, top];
    const signature = JSON.stringify([geometry, links]);
    if (signature === this.signature) { return; }
    this.signature = signature;
    Object.assign(this.layer.style, { left: `${geometry[0]}px`, top: `${geometry[1]}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const fragment = document.createDocumentFragment();
    const icons = [];
    const draw = (range, className) => {
      for (let row = Math.max(range.start.y, top + 1); row <= Math.min(range.end.y, top + term.rows); row++) {
        const start = row === range.start.y ? range.start.x : 1;
        const end = row === range.end.y ? range.end.x : term.cols;
        const block = document.createElement('span');
        block.className = className;
        Object.assign(block.style, { left: `${(start - 1) * cell.width}px`, top: `${(row - top - 1) * cell.height}px`, width: `${(end - start + 1) * cell.width}px`, height: `${cell.height}px` });
        fragment.append(block);
      }
    };
    for (const link of links) {
      for (const range of link.hiddenRanges) { draw(range, 'terminal-named-link-mask'); }
      draw(link.sourceRange, 'terminal-named-link-mask');
      for (const glyph of link.glyphs) {
        if (glyph.y <= top || glyph.y > top + term.rows) { continue; }
        const label = document.createElement('span');
        label.className = 'terminal-named-link-label';
        label.textContent = glyph.text;
        label.setAttribute('aria-hidden', 'true');
        Object.assign(label.style, {
          ...glyph.style,
          left: `${(glyph.x - 1) * cell.width}px`, top: `${(glyph.y - top - 1) * cell.height}px`,
          width: `${glyph.width * cell.width}px`, height: `${cell.height}px`, lineHeight: `${cell.height}px`,
        });
        fragment.append(label);
      }
      if (link.sourceRange.start.y > top && link.sourceRange.start.y <= top + term.rows) {
        icons.push(createElement('span', {
          key: link.key, className: 'terminal-named-link-icon', 'aria-hidden': true,
          style: {
            left: (link.sourceRange.start.x - 1) * cell.width, top: (link.sourceRange.start.y - top - 1) * cell.height,
            width: link.iconCells * cell.width, height: cell.height,
          },
        }, terminalNamedLinkIcon(link)));
      }
      const wrapButton = link.labelRange.end.x * cell.width + 24 > rect.width;
      const row = link.labelRange.end.y - top - 1 + (wrapButton ? 1 : 0);
      if (row >= 0 && row < term.rows) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'terminal-named-link-open';
        button.textContent = '↗';
        button.setAttribute('aria-label', `Open ${link.label}`);
        Object.assign(button.style, {
          left: `${wrapButton ? 0 : link.labelRange.end.x * cell.width}px`,
          top: `${row * cell.height}px`, height: `${cell.height}px`,
        });
        button.addEventListener('click', event => {
          event.stopPropagation();
          this.open(link);
        });
        fragment.append(button);
      }
    }
    this.layer.replaceChildren(fragment, this.iconHost);
    this.iconRoot.render(icons);
  }

  dispose() {
    if (this.frame !== null) { cancelAnimationFrame(this.frame); }
    for (const disposable of this.disposables) { disposable.dispose(); }
    this.clickContainer?.removeEventListener('click', this.handleClick, true);
    this.iconRoot?.unmount();
    this.layer?.remove();
    this.status?.remove();
    presentations.delete(this.term);
  }
}
