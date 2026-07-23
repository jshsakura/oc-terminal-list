import { describe, it, expect } from 'vitest';
import { findFileLinks, resolveWorkspacePath } from './terminalFileLinks';

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
