import { describe, it, expect } from 'vitest';
import { findFileLinks, resolveWorkspacePath, readLogicalLine, offsetToCell, MAX_WRAPPED_ROWS } from './terminalFileLinks';

describe('findFileLinks — 경로 감지', () => {
  it('상대경로 + line:col', () => {
    const [l] = findFileLinks('see src/components/Button.tsx:12:7 here');
    expect(l.path).toBe('src/components/Button.tsx');
    expect(l.line).toBe(12);
    expect(l.column).toBe(7);
  });

  it('절대경로', () => {
    const [l] = findFileLinks('created /tmp/out/report.html for you');
    expect(l.path).toBe('/tmp/out/report.html');
    expect(l.line).toBe(null);
  });

  it('line 만 (col 없음)', () => {
    const [l] = findFileLinks('at src/main.ts:42');
    expect(l).toMatchObject({ path: 'src/main.ts', line: 42, column: null });
  });

  it('~/ 홈 경로', () => {
    const [l] = findFileLinks('wrote ~/Documents/notes.md');
    expect(l.path).toBe('~/Documents/notes.md');
  });

  it('./ 상대경로', () => {
    const [l] = findFileLinks('run ./scripts/build.sh now');
    expect(l.path).toBe('./scripts/build.sh');
  });

  it('한 줄에 여러 경로', () => {
    const links = findFileLinks('src/a.ts uses src/b.ts');
    expect(links.map((l) => l.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('start/end 가 경로 범위를 정확히 가리킨다 (앞 경계 문자 제외)', () => {
    const line = 'see src/x.ts here';
    const [l] = findFileLinks(line);
    expect(line.slice(l.start, l.end)).toBe('src/x.ts');
  });

  it('line:col 접미사까지 밑줄 범위에 포함', () => {
    const line = 'at src/x.ts:9:2 ok';
    const [l] = findFileLinks(line);
    expect(line.slice(l.start, l.end)).toBe('src/x.ts:9:2');
  });
});

describe('findFileLinks — 오탐 방지', () => {
  it('맨 단어(디렉터리 슬래시 없음)는 경로가 아니다', () => {
    // "Button" "config" 같은 평범한 단어를 링크로 만들면 안 된다.
    expect(findFileLinks('the Button component and config value')).toEqual([]);
  });

  it('URL 은 여기서 안 잡는다 (WebLinksAddon 담당)', () => {
    // http:// 의 // 가 경로처럼 보여도 스킴이 붙으면 걸러져야 한다.
    const links = findFileLinks('see https://example.com/path/file.txt');
    expect(links.every((l) => !l.path.includes('example.com'))).toBe(true);
  });

  it('빈 줄 / null 안전', () => {
    expect(findFileLinks('')).toEqual([]);
    expect(findFileLinks(null)).toEqual([]);
  });

  it('공백 든 경로는 의도적으로 안 잡는다 (xterm range 모델 한계)', () => {
    const [l] = findFileLinks('wrote /tmp/My Project/readme.md');
    // /tmp/My 까지만 잡히거나 아예 안 잡힘 — 잘못된 전체 경로를 만들지 않는다.
    expect(l?.path).not.toBe('/tmp/My Project/readme.md');
  });
});

describe('resolveWorkspacePath — 워크스페이스 상대화', () => {
  const WS = '/home/ubuntu/app/jupyterLab/notebooks';

  it('워크스페이스 안의 절대경로 → 상대', () => {
    expect(resolveWorkspacePath(`${WS}/proj/x.ts`, { workspaceRoot: WS }))
      .toBe('proj/x.ts');
  });

  it('워크스페이스 밖 절대경로 → null (편집기가 못 연다)', () => {
    expect(resolveWorkspacePath('/etc/passwd', { workspaceRoot: WS })).toBe(null);
  });

  it('상대경로는 cwd 기준으로 이어붙인다', () => {
    expect(resolveWorkspacePath('src/x.ts', { cwd: 'proj' })).toBe('proj/src/x.ts');
    expect(resolveWorkspacePath('./src/x.ts', { cwd: 'proj' })).toBe('proj/src/x.ts');
  });

  it('.. 로 워크스페이스를 벗어나면 null', () => {
    expect(resolveWorkspacePath('../../../etc/x', { cwd: 'proj' })).toBe(null);
  });

  it('~/ 홈 경로는 워크스페이스로 못 여니 null', () => {
    expect(resolveWorkspacePath('~/Documents/x.md', { workspaceRoot: WS })).toBe(null);
  });
});

describe('접힌 줄 되살리기', () => {
  /* 실제 증상: 폭 52 터미널에서 긴 경로가 두 행으로 접혔고, 링크 프로바이더가 행 단위로
     불리는 탓에 **뒷조각만** 매치됐다 — `nd-watch-retro-go-sd/…/scratchp` 라는 있지도 않은
     상대경로로 빈 편집기 탭이 열렸다. */
  const makeBuffer = (rows) => ({
    getLine: (i) => (rows[i]
      ? { isWrapped: rows[i].wrapped, translateToString: () => rows[i].text }
      : undefined),
  });

  const COLS = 10;
  const pad = (t) => t.padEnd(COLS, ' ');

  it('이어지는 행을 붙여 논리 줄 하나로 만든다', () => {
    const buf = makeBuffer([
      { text: 'see /tmp/a', wrapped: false },   // 정확히 COLS — 그래서 접혔다
      { text: 'bc/def.txt', wrapped: true },
    ]);
    const { text, startRow } = readLogicalLine(buf, 2, COLS);
    expect(text).toBe('see /tmp/abc/def.txt');
    expect(startRow).toBe(0);
  });

  it('접힌 경로를 통째로 잡는다 (조각이 아니라)', () => {
    // 행이 **꽉 찼기 때문에** 접힌다 — 이어지는 행 앞의 행에는 패딩이 없다.
    const buf = makeBuffer([
      { text: '/tmp/aaaa/', wrapped: false },   // 정확히 COLS
      { text: pad('bbb/c.txt'), wrapped: true },
    ]);
    const { text } = readLogicalLine(buf, 1, COLS);
    const [link] = findFileLinks(text);
    expect(link.path).toBe('/tmp/aaaa/bbb/c.txt');
  });

  it('안 접힌 줄은 그 줄만 본다', () => {
    const buf = makeBuffer([
      { text: pad('/tmp/a.txt'), wrapped: false },
      { text: pad('/tmp/b.txt'), wrapped: false },
    ]);
    expect(readLogicalLine(buf, 2, COLS).text.trim()).toBe('/tmp/b.txt');
  });

  it('중간 행은 트림하지 않는다 — 트림하면 밑줄 좌표가 밀린다', () => {
    const buf = makeBuffer([
      { text: 'ab        ', wrapped: false },   // 뒤가 공백인 행
      { text: pad('cd'), wrapped: true },
    ]);
    expect(readLogicalLine(buf, 1, COLS).text).toBe('ab        cd        ');
  });

  it('병적으로 긴 접힘에도 상한이 있다', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ text: pad('x'), wrapped: i > 0 }));
    const { text } = readLogicalLine(makeBuffer(rows), 1, COLS);
    expect(text.length).toBe(MAX_WRAPPED_ROWS * COLS);
  });

  it('오프셋을 셀 좌표로 되돌린다 (행을 넘어가면 다음 줄)', () => {
    expect(offsetToCell(0, 0, COLS)).toEqual({ x: 1, y: 1 });
    expect(offsetToCell(9, 0, COLS)).toEqual({ x: 10, y: 1 });
    expect(offsetToCell(10, 0, COLS)).toEqual({ x: 1, y: 2 });
    expect(offsetToCell(14, 3, COLS)).toEqual({ x: 5, y: 5 });
  });
});
