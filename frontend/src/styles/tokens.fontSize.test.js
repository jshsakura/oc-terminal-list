import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from './tokens';

/**
 * 스케일에 없는 치수를 쓰면 조용히 커진다.
 *
 * `fontSize['10.5']` 처럼 없는 키는 undefined 를 내고, undefined 인 fontSize 는 무시되어
 * **상속 크기(글로벌 CSS 가 없으므로 브라우저 기본 16px)** 로 렌더된다. 작게 만들려던
 * 라벨이 화면에서 가장 큰 글씨가 되는데 에러는 어디에도 안 난다 — 실제로 대시보드
 * 보조 라벨 전부가 그 상태였다. 그래서 소스 스캔으로 막는다.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_RE = /fontSize\[['"]([^'"]+)['"]\]/g;

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (statSync(full).isDirectory()) return walk(full);
  // 테스트 파일 자신은 예시 문자열을 품고 있으므로 스캔 대상이 아니다.
  return /\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry) ? [full] : [];
});

describe('fontSize token scale', () => {
  it('is only referenced with keys that exist', () => {
    const scale = new Set(Object.keys(tokens.fontSize));
    const offenders = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(KEY_RE)) {
        if (!scale.has(key)) offenders.push(`${file.replace(SRC, '')}: fontSize['${key}']`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
