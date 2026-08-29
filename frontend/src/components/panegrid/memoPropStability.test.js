import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * memo 사슬의 무결성 검사.
 *
 * 터미널 트리는 App → PaneGrid → Pane → TerminalHeader/Terminal 로 내려간다. 네 컴포넌트가
 * 전부 `memo()` 인데, memo 는 **얕은 비교**라 부모가 인라인 화살표나 객체 리터럴을 하나만
 * 넘겨도 그 아래 전체가 매번 다시 렌더된다. 그리고 **모든 탭의 PaneGrid 가 상시 마운트**
 * 되므로(CLAUDE.md) 손실은 탭×pane 만큼 곱해진다.
 *
 * ⚠️ **이 실수는 조용하다.** 에러도 경고도 실패하는 테스트도 없다 — memo 가 그냥 매번
 *    "달라졌다" 고 답할 뿐이다. 실제로 `memo(Terminal)` 은 한 번도 걸린 적이 없었고,
 *    아무도 알아채지 못했다. 그래서 소스를 직접 훑는다.
 *
 * 고치는 도구: 함수는 `hooks/useEvent`(identity 고정 + 호출은 항상 최신), 객체는 `useMemo`.
 * pane 처럼 항목별 인자를 잡아야 하면 PaneGrid 의 `paneHandlers` 처럼 id 별로 캐시한다.
 */
const SRC = resolve(__dirname, '..', '..');

/** `<Tag ... />` 여는 태그를 중괄호 짝을 세어 통째로 집는다(여러 곳에 나와도 전부). */
const openingTags = (src, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}\\b`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index, depth = 0, end = null;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (depth === 0 && src.startsWith('/>', i)) { end = i + 2; break; }
      else if (depth === 0 && c === '>' && src[i - 1] !== '/') { end = i + 1; break; }
      i += 1;
    }
    if (end) out.push(src.slice(m.index, end));
  }
  return out;
};

const ARROW = /^(async\s*)?(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/;
const LITERAL = /^[{[]/;

/** 태그 안에서 값이 화살표/객체/배열 리터럴인 prop 이름들. */
const unstableProps = (tagText) => {
  const found = [];
  let j = 0;
  for (;;) {
    const m = /\n\s+([a-zA-Z][\w]*)=\{/.exec(tagText.slice(j));
    if (!m) break;
    const at = j + m.index;
    const name = m[1];
    let k = at + m[0].length - 1, depth = 0;
    while (k < tagText.length) {
      if (tagText[k] === '{') depth += 1;
      else if (tagText[k] === '}') { depth -= 1; if (depth === 0) break; }
      k += 1;
    }
    const value = tagText.slice(at + m[0].length, k).trim();
    if (ARROW.test(value) || LITERAL.test(value)) found.push(name);
    j = k;
  }
  return found;
};

const CHAIN = [
  ['App.jsx', 'PaneGrid'],
  ['components/PaneGrid.jsx', 'Pane'],
  ['components/panegrid/Pane.jsx', 'TerminalHeader'],
  ['components/panegrid/Pane.jsx', 'Terminal'],
];

describe('memo 사슬 — 자식으로 내려가는 prop 의 참조 안정성', () => {
  it.each(CHAIN)('%s → <%s> 에 인라인 함수·객체를 넘기지 않는다', (file, tag) => {
    const src = readFileSync(resolve(SRC, file), 'utf8');
    const tags = openingTags(src, tag);
    expect(tags.length, `${file} 에서 <${tag} 을 못 찾았다 — 테스트가 낡았다`).toBeGreaterThan(0);

    const bad = tags.flatMap(unstableProps);
    expect(
      [...new Set(bad)],
      `<${tag}> 의 memo 를 무력화한다 (${file}) — 함수는 useEvent, 객체는 useMemo 로:\n  ${[...new Set(bad)].join('\n  ')}`,
    ).toEqual([]);
  });

  it.each([
    ['components/PaneGrid.jsx', 'PaneGrid'],
    ['components/panegrid/Pane.jsx', 'Pane'],
    ['components/TerminalHeader.jsx', 'TerminalHeader'],
    ['components/Terminal.jsx', 'TerminalComponent'],
  ])('%s 는 memo 로 내보낸다', (file, name) => {
    const src = readFileSync(resolve(SRC, file), 'utf8');
    expect(src).toContain(`export default memo(${name});`);
  });

  it('per-pane 핸들러는 id 별로 캐시된다', () => {
    // pane 마다 다른 인자를 잡아야 하는 자리는 통짜 useEvent 로 안 된다. 이 캐시가 사라지면
    // 위의 스캔은 통과하면서(값이 리터럴이 아니므로) memo 는 다시 안 걸린다 — 조용한 회귀다.
    const src = readFileSync(resolve(SRC, 'components/PaneGrid.jsx'), 'utf8');
    expect(src).toMatch(/const paneHandlers = useCallback\(/);
    expect(src, 'pane 이 닫혀도 Map 이 안 줄면 세션 내내 자란다').toMatch(/paneHandlersRef\.current\.delete/);
  });
});
