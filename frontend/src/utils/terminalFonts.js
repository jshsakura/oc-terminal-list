// 로컬 번들 패치 폰트가 1순위. 사용자 시스템 설치 폰트는 그 다음.
export const DEFAULT_TERMINAL_FONT_FAMILY = '"JetBrainsMono Nerd Font Mono", "MesloLGS NF", "CaskaydiaCove Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace';

const NERD_FONT_FALLBACK = '"JetBrainsMono Nerd Font Mono"';

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

// Default terminal font size. Mobile is deliberately smaller: the phone screen is
// narrow, so the desktop size (12-13px) reads oversized there.
// Keep the fallbacks pointing here — a literal copied into a call site silently
// keeps the old default when this one changes.
export const DEFAULT_FONT_SIZE = 12;
export const DEFAULT_FONT_SIZE_MOBILE = 10;
