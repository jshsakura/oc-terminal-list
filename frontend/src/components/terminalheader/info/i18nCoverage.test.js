import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 정보 패널에 **번역을 지나지 않는 문구**가 섞이지 않게 한다.
 *
 * ⚠️ locales 테스트는 `t('key')` 로 쓰인 키가 사전에 있는지만 본다 — 애초에 `t` 를
 * 안 지나는 하드코딩 문자열은 그 그물에 안 걸린다. 실제로 CPU·Disk·Network·Load·
 * Memory·Used/Cache/Swap/Free·Copy 가 그렇게 영어로 남아 있었고, 한국어 화면에서
 * 그 줄만 영어로 보였다.
 */
const FILES = ['InfoPanel.jsx', 'info/InfoParts.jsx'];
const HERE = resolve(__dirname, '..');

// 번역할 것이 없는 값들 — 고유명사·단위·기호.
const ALLOWED = new Set(['CPU', 'SSH', 'tmux', 'RAM', 'GPU', 'IP', 'ID']);

describe('정보 패널 한글화 커버리지', () => {
  for (const rel of FILES) {
    test(`${rel} 의 label/title 은 번역을 지난다`, () => {
      const src = readFileSync(resolve(HERE, rel), 'utf8');
      // label="..." / title="..." — 중괄호가 아닌 **리터럴** 문자열만 잡는다.
      const literals = [...src.matchAll(/\b(?:label|title)="([^"]+)"/g)].map((m) => m[1]);
      const untranslated = literals.filter((text) => !ALLOWED.has(text));
      expect(untranslated).toEqual([]);
    });
  }

  test('메모리 막대의 구간 이름이 번역을 지난다', () => {
    const src = readFileSync(resolve(HERE, 'info/InfoParts.jsx'), 'utf8');
    const segments = src.slice(src.indexOf('const segments = ['), src.indexOf('].filter('));
    for (const key of ['used', 'cache', 'swap', 'free']) {
      expect(segments, key).toMatch(new RegExp(`t\\?\\.\\('mem${key[0].toUpperCase()}${key.slice(1)}'\\)`));
    }
  });
});
