import { expect, it } from 'vitest';
import { readTerminalPromptContext } from './terminalPromptContext';

function terminal(lines, top, wrapped = []) {
  return { buffer: { active: { type: 'normal', baseY: lines.length - 1, viewportY: top, length: lines.length,
    getLine: (row) => row >= 0 && row < lines.length ? {
      isWrapped: wrapped.includes(row),
      translateToString: (trim) => trim ? lines[row].trimEnd() : lines[row],
    } : null,
  } } };
}

it('selects each question as its answer reaches the viewport top', () => {
  const lines = ['preamble', '› 질문 A', '', 'answer A', 'answer A', '❯ 질문 B', '  둘째 줄', '',
    'answer B', '› 질문 C', '', 'answer C', 'live prompt'];
  for (const [top, text] of [[0, null], [3, '질문 A'], [4, '질문 A'], [5, '질문 B\n둘째 줄'],
    [8, '질문 B\n둘째 줄'], [11, '질문 C'], [3, '질문 A']]) {
    expect(readTerminalPromptContext(terminal(lines, top))?.text || null).toBe(text);
  }
});

it('joins wrapped Korean lines and includes the part below the viewport boundary', () => {
  const lines = ['› 한글 질문 ', '내용 계속', '  다음 줄', '', 'answer', 'live'];
  expect(readTerminalPromptContext(terminal(lines, 1, [1]))?.text).toBe('한글 질문 내용 계속\n다음 줄');
});

it('does not mistake shell examples, quotes, or a wrapped glyph for a question', () => {
  const lines = ['answer', '$ echo test', '> quote', '› not a prompt', 'answer', 'live'];
  expect(readTerminalPromptContext(terminal(lines, 4, [3]))).toBeNull();
});

it('hides after history is cleared or trimmed, at the bottom, and in alternate screens', () => {
  const term = terminal(['› A', '', 'answer', 'live'], 2);
  expect(readTerminalPromptContext(term)?.text).toBe('A');
  expect(readTerminalPromptContext(terminal(['answer', 'answer', 'live'], 1))).toBeNull();
  term.buffer.active.viewportY = 3;
  expect(readTerminalPromptContext(term)).toBeNull();
  term.buffer.active.viewportY = 2;
  term.buffer.active.type = 'alternate';
  expect(readTerminalPromptContext(term)).toBeNull();
});

it('uses the original formatting from a matching recent command, not the newest command', () => {
  const term = terminal(['› 첫 줄', '  들여쓴 둘째 줄', '', 'answer A', 'live'], 3);
  const commands = [{ text: '가장 최근의 다른 질문', ts: 200 }, { text: '첫 줄\n    들여쓴 둘째 줄', ts: 100 }];
  expect(readTerminalPromptContext(term, commands)?.text).toBe('첫 줄\n    들여쓴 둘째 줄');
  expect(readTerminalPromptContext(term, [])?.text).toBe('첫 줄\n들여쓴 둘째 줄');
});

it('does not infer positions from stored commands or guess a truncated question', () => {
  const commands = [{ text: '이 질문의 전체 내용을 확인해 주세요', ts: 100 }];
  expect(readTerminalPromptContext(terminal(['only an answer', 'live'], 0), commands)).toBeNull();
  expect(readTerminalPromptContext(terminal(['› 이 질문의 전체 내용을…', '', 'answer', 'live'], 2), commands)?.text)
    .toBe('이 질문의 전체 내용을…');
});
