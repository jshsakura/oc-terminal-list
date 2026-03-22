export const DEFAULT_TERMINAL_FONT_FAMILY = '"MesloLGS NF", "MesloLGS Nerd Font", "CaskaydiaCove Nerd Font", "JetBrains Mono", "NerdFontsSymbols Nerd Font", Menlo, Monaco, monospace';

const NERD_FONT_FALLBACK = '"NerdFontsSymbols Nerd Font"';

export const normalizeTerminalFontFamily = (fontFamily) => {
  if (typeof fontFamily !== 'string') {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }

  const trimmed = fontFamily.trim();
  if (!trimmed) {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }

  if (trimmed.includes('NerdFontsSymbols Nerd Font')) {
    return trimmed;
  }

  return `${trimmed}, ${NERD_FONT_FALLBACK}`;
};
