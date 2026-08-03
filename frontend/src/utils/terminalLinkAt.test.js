import { describe, it, expect, vi } from 'vitest';
import { getLinkAtClient } from './terminalLinkAt';

// xterm buffer.getLine 의 미니 목 — translateToString(true) 반환.
function makeTerm({ text, cols = 80, rows = 24, rect = { left: 0, top: 0, width: 800, height: 480 } }) {
  const element = {
    getBoundingClientRect: () => rect,
  };
  return {
    cols,
    rows,
    element,
    buffer: {
      active: {
        viewportY: 0,
        getLine: (idx) => {
          // 싱글 라인 목 — row 0 만 의미 있다.
          if (idx === 0) return { translateToString: () => text };
          return null;
        },
      },
    },
  };
}

describe('getLinkAtClient', () => {
  it('URL 범위 안 좌표면 URL 을 반환한다', () => {
    // "Check https://example.com/path?q=1 now" — 80컬럼, 800px 폭 → cellWidth=10px
    // URL 시작: col 6 (x=60), 끝: col 32 (x=320)
    const term = makeTerm({ text: 'Check https://example.com/path?q=1 now' });
    const url = getLinkAtClient(term, 100, 10); // col 10 — URL 안
    expect(url).toBe('https://example.com/path?q=1');
  });

  it('URL 범위 밖 좌표면 null', () => {
    const term = makeTerm({ text: 'Check https://example.com/path?q=1 now' });
    expect(getLinkAtClient(term, 5, 10)).toBeNull(); // "Check" 영역
    expect(getLinkAtClient(term, 500, 10)).toBeNull(); // URL 뒤 "now" 영역
  });

  it('URL 이 없는 라인이면 null', () => {
    const term = makeTerm({ text: 'just some plain text without links' });
    expect(getLinkAtClient(term, 100, 10)).toBeNull();
  });

  it('term.element 가 없으면 null', () => {
    const term = makeTerm({ text: 'https://example.com' });
    term.element = null;
    expect(getLinkAtClient(term, 100, 10)).toBeNull();
  });

  it('rect 크기가 0 이면 null', () => {
    const term = makeTerm({ text: 'https://example.com', rect: { left: 0, top: 0, width: 0, height: 0 } });
    expect(getLinkAtClient(term, 100, 10)).toBeNull();
  });

  it('범위 밖 좌표(음수/초과)면 null', () => {
    const term = makeTerm({ text: 'https://example.com' });
    expect(getLinkAtClient(term, -10, 10)).toBeNull();
    expect(getLinkAtClient(term, 900, 10)).toBeNull(); // rect.width=800 밖
  });

  it('끝문자(마침표/괄호)는 URL 에서 제외된다', () => {
    // "See (https://example.com)." — 괄호와 마침표는 URL 이 아님
    const term = makeTerm({ text: 'See (https://example.com).' });
    // URL 시작 col 5 (x=50)
    const url = getLinkAtClient(term, 60, 10); // URL 안
    expect(url).toBe('https://example.com');
    expect(url).not.toMatch(/[).]$/);
  });

  it('여러 URL 중 올바른 것을 선택한다', () => {
    // "a https://a.com b https://b.com c"
    // URL1: col 2-17 (x=20-170), URL2: col 19-34 (x=190-340)
    const term = makeTerm({ text: 'a https://a.com b https://b.com c' });
    expect(getLinkAtClient(term, 100, 10)).toBe('https://a.com');
    expect(getLinkAtClient(term, 250, 10)).toBe('https://b.com');
  });
});
