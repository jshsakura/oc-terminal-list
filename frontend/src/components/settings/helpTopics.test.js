import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, helpTranslationKeys } from './helpTopics';
import { locales } from '../../i18n/locales';

/**
 * 도움말 문구는 **동적 키**로 읽힌다(`t(entry.termKey)`). i18n/locales.test.js 의 스캐너는
 * 소스에 문자열로 박힌 호출만 잡으므로 이 목록은 그 그물에 안 걸린다 — 여기서 직접 잰다.
 * (그 스캐너는 주석까지 읽는다. 여기에 호출 예시를 적으면 없는 키를 요구하게 된다.)
 *
 * 빠지면 화면에 키 이름(`helpVncDesc`)이 그대로 찍히거나, 한쪽 언어에서만 설명이 사라진다.
 */
describe('helpTopics', () => {
  it('한국어와 영어 양쪽에 모든 문구가 있다', () => {
    const keys = helpTranslationKeys();
    for (const [lang, dict] of Object.entries(locales)) {
      const missing = keys.filter((key) => !(key in dict));
      expect(missing, `${lang} 에 없는 도움말 키`).toEqual([]);
    }
  });

  it('설명이 비어 있거나 키 이름 그대로인 항목이 없다', () => {
    const keys = helpTranslationKeys();
    for (const [lang, dict] of Object.entries(locales)) {
      const bad = keys.filter((key) => !dict[key] || dict[key] === key || !String(dict[key]).trim());
      expect(bad, `${lang} 에서 비어 있는 도움말 문구`).toEqual([]);
    }
  });

  it('두 언어가 같은 항목 수를 갖는다 — 한쪽만 늘리면 다른 쪽 독자는 그 기능을 모른다', () => {
    const keys = helpTranslationKeys();
    const counts = Object.values(locales).map((dict) => keys.filter((k) => k in dict).length);
    expect(new Set(counts).size).toBe(1);
  });

  it('설명은 한 줄 규칙을 지킨다 — 길면 아무도 안 읽는다', () => {
    // 이름은 짧게, 설명은 두 문장 남짓. 상한을 넉넉히 두되 문단이 들어오면 잡는다.
    for (const [lang, dict] of Object.entries(locales)) {
      for (const section of HELP_TOPICS) {
        for (const entry of section.entries) {
          expect(dict[entry.termKey].length, `${lang}.${entry.termKey} 는 이름이다`).toBeLessThan(40);
          expect(dict[entry.descKey].length, `${lang}.${entry.descKey}`).toBeLessThan(220);
        }
      }
    }
  });

  it('키가 중복되지 않는다 — 한 항목을 두 번 그리면 목록이 거짓말을 한다', () => {
    const keys = helpTranslationKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});
