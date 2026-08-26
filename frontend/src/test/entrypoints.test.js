import { describe, test, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * ⚠️ 진입 파일은 **어떤 테스트도 import 하지 않는다.** 그래서 여기 문법 오류가 나면
 * 1400개가 전부 통과한 뒤 배포 단계의 빌드에서야 터진다.
 *
 * 실제로 그랬다: main.jsx 의 전역 CSS 는 템플릿 리터럴인데 그 안의 주석에 백틱을 써서
 * 리터럴이 중간에 끊겼다. 테스트는 초록, 빌드는 빨강.
 *
 * 여기서는 파싱만 한다(실행하면 앱이 뜬다). 파싱만으로 그 사고가 잡힌다.
 * esbuild 는 별도 프로세스로 부른다 — 노드 API 는 jsdom 환경에서 뜨지 않는다.
 */
const ENTRIES = ['main.jsx', 'demo-main.jsx'];

describe('진입 파일', () => {
  for (const rel of ENTRIES) {
    const file = resolve(__dirname, '..', rel);
    if (!existsSync(file)) continue;
    test(`${rel} 는 파싱된다`, () => {
      expect(() => execFileSync(
        resolve(__dirname, '../../node_modules/.bin/esbuild'),
        [file, '--outfile=/dev/null'],
        { stdio: 'pipe' },
      )).not.toThrow();
    });
  }
});
