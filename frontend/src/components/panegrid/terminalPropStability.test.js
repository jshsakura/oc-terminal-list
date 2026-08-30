import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `Terminal` 은 이 앱에서 가장 무거운 컴포넌트(2,300줄+)이고 `memo()` 로 감싸져 있다.
 * 그런데 memo 는 **얕은 비교**다 — 부모가 인라인 화살표 함수나 객체 리터럴을 넘기면
 * 매 렌더 새 참조라 비교가 항상 실패하고, memo 는 한 번도 안 걸린다.
 *
 * 그리고 **모든 탭의 PaneGrid 가 상시 마운트**되므로(CLAUDE.md 의 "요청은 마운트 수만큼
 * 곱해진다") 그 손실은 탭×pane 만큼 곱해진다. App 의 상태 하나가 바뀔 때마다 열려 있는
 * 모든 터미널이 통째로 다시 렌더된다는 뜻이다.
 *
 * **이 실수는 조용하다.** 에러도, 경고도, 실패하는 테스트도 없다 — memo 는 그냥 매번
 * "달라졌다" 고 답할 뿐이다. 그래서 소스를 직접 훑는다.
 */
const PANE = resolve(__dirname, 'Pane.jsx');

// `<Terminal ... />` 여는 태그 하나를 통째로 집는다.
const terminalTag = (src) => {
  const start = src.indexOf('<Terminal\n');
  expect(start, 'Pane.jsx 에서 <Terminal 을 못 찾았다 — 테스트가 낡았다').toBeGreaterThan(-1);
  const end = src.indexOf('/>', start);
  return src.slice(start, end);
};

describe('Pane → Terminal prop stability', () => {
  const tag = terminalTag(readFileSync(PANE, 'utf8'));

  it('passes no inline arrow function to Terminal', () => {
    // `onFoo={(a) => ...}` / `ref={(h) => ...}` — 매 렌더 새 함수.
    const inline = tag.split('\n').filter((l) => /=\{\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/.test(l));
    expect(inline, `인라인 화살표는 memo(Terminal) 을 무력화한다 — hooks/useEvent 로 감쌀 것:\n${inline.join('\n')}`)
      .toEqual([]);
  });

  it('passes no inline object or array literal to Terminal', () => {
    // `paneCwdInfo={{...}}` — 매 렌더 새 객체.
    const inline = tag.split('\n').filter((l) => /=\{\s*[{[]/.test(l));
    expect(inline, `인라인 객체/배열은 memo(Terminal) 을 무력화한다 — useMemo 로 감쌀 것:\n${inline.join('\n')}`)
      .toEqual([]);
  });

  it('keeps the settings object memoized', () => {
    // paneSettings 는 테마 오버라이드가 있는 pane 에서만 새 객체가 됐다 — 그래서 이
    // 버그는 "어떤 pane 만 느린" 형태로 나타나 원인을 찾기가 특히 어렵다.
    const src = readFileSync(PANE, 'utf8');
    expect(src).toMatch(/const paneSettings = useMemo\(/);
  });
});
