import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 정보 패널에 **번역을 지나지 않는 문구**가 섞이지 않게 한다.
 *
 * ⚠️ locales 테스트는 번역 함수로 **호출된 키**가 사전에 있는지만 본다 — 애초에 그
 * 함수를 안 지나는 하드코딩 문자열은 그 그물에 안 걸린다. 실제로 CPU·Disk·Network·Load·
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

  /* ⚠️ 번역 호출 모양을 이 파일에 **글자로 적지 않는다**(주석에도). locales 테스트가
     소스 전체에서 그 모양을 긁어 사전과 대조하는데, 테스트 파일도 긁으므로 여기 적힌
     예시가 "없는 키" 로 잡힌다(실제로 그래서 한 번 빨개졌다). 키 이름만 확인한다. */
  test('메모리 막대의 구간 이름이 번역을 지난다', () => {
    const src = readFileSync(resolve(HERE, 'info/InfoParts.jsx'), 'utf8');
    const segments = src.slice(src.indexOf('const segments = ['), src.indexOf('].filter('));
    for (const name of ['Used', 'Cache', 'Swap', 'Free']) {
      expect(segments, name).toContain(`'mem${name}'`);
    }
  });
});
