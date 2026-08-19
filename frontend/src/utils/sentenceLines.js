/**
 * Split a one-or-two sentence hint into the lines it should actually be drawn on.
 *
 * Left to the browser, a Korean hint wraps wherever the box runs out — and CJK text has
 * no spaces to break on, so it snaps mid-word: "실행 중" / "인 작업은". The sentence is
 * already the natural break, so we use it, and `keep-all` handles what is left.
 *
 * Deliberately not a sentence tokenizer: it splits after `.`/`!`/`?` followed by
 * whitespace, which is exactly the shape of the copy in this app. A decimal ("12.5s") or
 * an ellipsis has no space after the dot, so neither is cut.
 */
export const sentenceLines = (text) => {
  const value = String(text ?? '').trim();
  if (!value) return [];
  return value
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
};

/** Style that keeps CJK from breaking inside a word when a line still has to wrap. */
export const KEEP_WORDS_TOGETHER = { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere' };

export default sentenceLines;
