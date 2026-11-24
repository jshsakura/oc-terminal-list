import { describe, it, expect, vi } from 'vitest';
import { getLinkAtClient, getFileLinkAtClient, normalizeWebUri, wrappedWebLinks } from './terminalLinkAt';

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
  it('returns the full URL from either hard-wrapped row for touch and copy', () => {
    const url = 'https://example.com/aaaa/bbbb/cccc/dddd/eeee';
    const term = makeTerm({ text: '', cols: 30 });
    term._core = { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } };
    const parts = [`see ${url.slice(0, 25)}`, `    ${url.slice(25)} end`];
    term.buffer.active.getLine = row => row < parts.length ? {
      isWrapped: false,
      translateToString: (_, start = 0, end = 30) => parts[row].padEnd(30).slice(start, end),
      getCell: col => ({ getWidth: () => 1, getChars: () => parts[row][col] || '' }),
    } : null;

    expect(getLinkAtClient(term, 105, 10)).toBe(url);
    expect(getLinkAtClient(term, 65, 30)).toBe(url);
    expect(getLinkAtClient(term, 15, 30)).toBeNull();
  });
  it('joins wrapped URLs and respects Korean display-cell widths', () => {
    const term = makeTerm({ text: '', cols: 20 });
    term.element.querySelector = () => ({ getBoundingClientRect: () => ({ left: 5, top: 8, width: 200, height: 480 }) });
    term._core = { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } };
    const parts = ['한글 https://examp', 'le.com/long-path'];
    term.buffer.active.getLine = row => {
      if (row > 1) return null;
      const chars = row === 0 ? ['한', '', '글', '', ...parts[0].slice(2)] : [...parts[1]];
      return { isWrapped: row === 1,
        getCell: col => ({ getWidth: () => chars[col] === '' ? 0 : 1, getChars: () => chars[col] || '' }),
        translateToString: (_, start = 0, end = chars.length) => chars.slice(start, end).join('') };
    };
    expect(getLinkAtClient(term, 65, 18)).toBe('https://example.com/long-path');
    expect(getLinkAtClient(term, 15, 38)).toBe('https://example.com/long-path');
    expect(getLinkAtClient(term, 25, 18)).toBeNull();
  });
  it('resolves local file links and ignores unsupported URL protocols', () => {
    const term = makeTerm({ text: 'src/main.js:12:4' });
    expect(getFileLinkAtClient(term, 50, 10)).toMatchObject({ path: 'src/main.js', line: 12, column: 4 });
    expect(getLinkAtClient(makeTerm({ text: 'javascript:alert(1)' }), 50, 10)).toBeNull();
  });
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

describe('OSC 8 named hyperlinks', () => {
  it.each(['https://terminal.example.test/?document=docs%2Fa.md', 'http://example.com/a', 'javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'invalid'])('checks the target behind a label: %s', uri => {
    const term = makeTerm({ text: '이미지 보기 테스트' });
    const line = term.buffer.active.getLine(0);
    line.getCell = () => ({ getWidth: () => 2, extended: { urlId: 7 } });
    term.buffer.active.getLine = row => row === 0 ? line : null;
    term._core = { _oscLinkService: { getLinkData: id => id === 7 ? { uri } : undefined } };
    expect(getLinkAtClient(term, 25, 10)).toBe(uri.startsWith('http') ? uri : null);
  });
});


it('opens a named file hyperlink without displaying its path', () => {
  const term = makeTerm({ text: 'photo.png' });
  const line = term.buffer.active.getLine(0);
  line.getCell = () => ({ getWidth: () => 1, extended: { urlId: 9 } });
  term.buffer.active.getLine = row => row === 0 ? line : null;
  term._core = { _oscLinkService: { getLinkData: () => ({ uri: 'file:///work/projects/images/photo.png' }) } };
  expect(getLinkAtClient(term, 25, 10)).toBeNull();
  expect(getFileLinkAtClient(term, 25, 10)).toEqual({ path: '/work/projects/images/photo.png', newTab: true });
});


describe('file paths wrapped by the output application', () => {
  const lines = [
    '  Report (/work/projects/2026-10/2026-10-19/terminal-',
    '  list-internal-document-tabs/README.md)',
  ];
  const makeLines = (rows) => {
    const term = makeTerm({ text: '', cols: 80 });
    term.buffer.active.getLine = row => row >= 0 && row < rows.length
      ? { isWrapped: false, translateToString: (_, start = 0, end = rows[row].length) => rows[row].slice(start, end) }
      : null;
    return term;
  };
  it.each([[150, 10], [150, 30]])('reads the complete parenthesized target at %s,%s', (x, y) => {
    expect(getFileLinkAtClient(makeLines(lines), x, y)?.path).toBe('/work/projects/2026-10/2026-10-19/terminal-list-internal-document-tabs/README.md');
  });
  it('does not join separate unparenthesized paths', () => {
    expect(getFileLinkAtClient(makeLines(['/work/a.md', '/work/b.md']), 50, 10)?.path).toBe('/work/a.md');
  });
  it('does not turn intervening prose into a file path', () => {
    expect(getFileLinkAtClient(makeLines(['Report (/work/a-', 'some unrelated text', 'b.md)']), 150, 10)?.path).not.toBe('/work/a-someunrelatedtextb.md');
  });
});


describe('hard-wrapped web links', () => {
  const url = 'https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid';
  const rows = ['  Guide (https://', '  developers.google.com/identity/gsi/web/guides/get-google-', '  api-clientid)'];
  const makeRows = (lines) => {
    const term = makeTerm({ text: '' });
    term.buffer.active.getLine = row => lines[row] === undefined ? null : {
      isWrapped: false,
      translateToString: (_, start = 0, end = lines[row].length) => lines[row].slice(start, end),
    };
    return term;
  };
  it.each([[120, 10], [100, 30], [70, 50]])('joins a bounded URL at %s,%s', (x, y) => {
    expect(getLinkAtClient(makeRows(rows), x, y)).toBe(url);
  });
  it('does not include adjacent prose or join separate bare URLs', () => {
    expect(getLinkAtClient(makeRows(rows), 30, 10)).toBeNull();
    expect(getLinkAtClient(makeRows(['https://example.com/a', 'https://other.example/b']), 50, 10)).toBe('https://example.com/a');
    expect(getLinkAtClient(makeRows(['(https://example.com/a', 'some unrelated prose)']), 50, 10)).toBe('https://example.com/a');
  });
});


describe('web URI normalization', () => {
  it('removes literal line breaks and indentation while preserving URL escapes', () => {
    expect(normalizeWebUri('https://example.com/a-\n  b?q=a%20b')).toBe('https://example.com/a-b?q=a%20b');
    expect(normalizeWebUri('https://example.com/a%0A%20b')).toBe('https://example.com/a%0A%20b');
    expect(normalizeWebUri('javascript:alert(1)')).toBeNull();
  });
  it('returns cell ranges for desktop link activation', () => {
    const rows = ['(https://example.com/a-', '  b)'];
    const buffer = { getLine: row => rows[row] === undefined ? null : {
      translateToString: () => rows[row], isWrapped: false,
    } };
    expect(wrappedWebLinks(buffer, 1)).toEqual([{
      text: 'https://example.com/a-b',
      range: { start: { x: 2, y: 1 }, end: { x: 3, y: 2 } },
    }]);
  });
});
