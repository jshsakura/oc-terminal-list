import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from './tokens';

/**
 * 스케일에 없는 키는 **조용히 다른 값**이 된다 — 그리고 어디에도 에러가 안 난다.
 *
 * fontSize 는 커지고(아래), space·radius 는 **선언 전체가 무효화된다**: 템플릿 문자열이
 * `undefined 16px` 가 되면 CSS 파서가 그 속성을 통째로 버린다. 실제로 `space['2.5']` 가
 * 스케일에 없어서 로그인 화면의 패스키 버튼과 링크 버튼이 **패딩 0 으로** 렌더되고 있었다
 * (2026-08-30, 이북 모드 버튼을 손보다 발견). 그래서 세 스케일을 다 훑는다.
 *
 * A size that is not in the scale silently gets BIGGER.
 *
 * A missing key like `fontSize['10.5']` yields undefined, and an undefined fontSize is
 * ignored — the element renders at the **inherited size** (the browser default of 16px,
 * since there is no global CSS). A label meant to be small becomes the largest text on
 * screen and nothing errors. Every secondary label on the dashboard was in that state,
 * so a source scan guards it.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyRe = (name) => new RegExp(`${name}\\[['"]([^'"]+)['"]\\]`, 'g');

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (statSync(full).isDirectory()) return walk(full);
  // Test files carry example strings, so they are not scanned.
  return /\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry) ? [full] : [];
});

const FILES = walk(SRC).map((file) => [file, readFileSync(file, 'utf8')]);

describe.each(['fontSize', 'space', 'radius'])('%s token scale', (name) => {
  it('is only referenced with keys that exist', () => {
    const scale = new Set(Object.keys(tokens[name]));
    const offenders = [];
    for (const [file, source] of FILES) {
      for (const [, key] of source.matchAll(keyRe(name))) {
        if (!scale.has(key)) offenders.push(`${file.replace(SRC, '')}: ${name}['${key}']`);
      }
    }
    expect(
      offenders,
      `스케일에 없는 키 — 그 선언은 조용히 버려진다:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
