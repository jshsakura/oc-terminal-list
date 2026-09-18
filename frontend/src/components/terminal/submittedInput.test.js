import { describe, expect, it, vi } from 'vitest';
import { createSubmittedInputCapture, readPromptInput } from './submittedInput';

export function promptTerminal(texts, { cursorY = texts.length - 1, cursorX, wrapped = [], dim = false } = {}) {
  const lines = texts.map((text, row) => ({
    isWrapped: wrapped.includes(row),
    translateToString: (trim, start = 0) => trim ? text.slice(start).trimEnd() : text.slice(start),
    getCell: () => ({ isDim: () => dim }),
  }));
  return { buffer: { active: { baseY: 0, cursorY, cursorX: cursorX ?? texts[cursorY].length,
    length: lines.length, getLine: (row) => lines[row] } } };
}

describe('submitted input capture', () => {
  it('keeps fast Korean input and IME corrections even before the server echo arrives', () => {
    const term = promptTerminal(['› ']);
    const submit = vi.fn();
    const capture = createSubmittedInputCapture(term, submit);
    capture('한그');
    capture('\x7f글');
    capture(' 질문');
    capture('해\r');
    expect(submit).toHaveBeenCalledExactlyOnceWith('한글 질문해');
  });

  it('ignores placeholder text when starting a new question', () => {
    const term = promptTerminal(['› Ask Codex anything'], { cursorX: 2, dim: true });
    const submit = vi.fn();
    const capture = createSubmittedInputCapture(term, submit);
    capture('\r');
    expect(submit).not.toHaveBeenCalled();
    capture('새 질문');
    capture('\r');
    expect(submit).toHaveBeenCalledExactlyOnceWith('새 질문');
  });

  it('does not submit bracketed multiline paste until Enter', () => {
    const submit = vi.fn();
    const capture = createSubmittedInputCapture(promptTerminal(['❯ ']), submit);
    capture('\x1b[200~첫 질문\r두 번째 줄\x1b[201~');
    expect(submit).not.toHaveBeenCalled();
    capture('\r');
    expect(submit).toHaveBeenCalledExactlyOnceWith('첫 질문\n두 번째 줄');
  });

  it('reads edited or recalled input from the actual terminal', () => {
    const term = promptTerminal(['ubuntu@host:~$ echo old']);
    const submit = vi.fn();
    const capture = createSubmittedInputCapture(term, submit);
    capture('x');
    capture('\x1b[A');
    term.buffer.active = promptTerminal(['ubuntu@host:~$ echo recalled']).buffer.active;
    capture('\r');
    expect(submit).toHaveBeenCalledExactlyOnceWith('echo recalled');
  });

  it('keeps wrapped spaces and explicit multiline continuation', () => {
    expect(readPromptInput(promptTerminal(['› 첫 번째 ', '질문', '  다음 줄'], { wrapped: [1] })))
      .toBe('첫 번째 질문\n다음 줄');
  });

  it('keeps content below a cursor editing in the middle', () => {
    expect(readPromptInput(promptTerminal(['› first ', 'second', '  third'], { cursorY: 0, cursorX: 4, wrapped: [1] })))
      .toBe('first second\nthird');
  });

  it.each(['Password: ', '[sudo] password for ubuntu: ', 'Enter PIN: ', '비밀번호: ', 'unrecognized input'])
    ('does not capture hidden entry or unknown prompts: %s', (prompt) => {
      const submit = vi.fn();
      const capture = createSubmittedInputCapture(promptTerminal([prompt]), submit);
      capture('do-not-show');
      capture('\r');
      capture('explicit\r', 'explicit');
      expect(submit).not.toHaveBeenCalled();
    });

  it('uses the complete quick-input command and starts the next question fresh', () => {
    const submit = vi.fn();
    const capture = createSubmittedInputCapture(promptTerminal(['› ']), submit);
    capture('첫 줄\n둘째 줄\r', '첫 줄\n둘째 줄');
    capture('새 질문');
    capture('\r');
    expect(submit.mock.calls.map(([text]) => text)).toEqual(['첫 줄\n둘째 줄', '새 질문']);
  });
});
