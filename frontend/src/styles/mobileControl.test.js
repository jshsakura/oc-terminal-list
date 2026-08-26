import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MOBILE_CONTROL } from './mobileControl';

/**
 * 퀵바와 입력 도크는 화면에서 **위아래로 맞붙어** 있고, 도크의 일부 컨트롤은 포탈로
 * 퀵바 줄 안에 들어간다. 그래서 두 파일이 같은 치수를 각자 적어 두면 어긋난 게 코드에서는
 * 안 보이고 폰에서만 보인다 — 실제로 모서리(3px/5px)와 아이콘(12/14)이 그랬다.
 *
 * 값을 되돌리는 것을 막는 게 아니라, **한쪽만** 되돌리는 것을 막는 테스트다.
 */
const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const TOOLBAR = read('components/MobileToolbar.jsx');
const DOCK = read('components/CommandInput.jsx');

describe('모바일 하단 컨트롤 치수', () => {
  test('퀵바와 도크가 같은 상수를 쓴다', () => {
    expect(TOOLBAR).toContain("from '../styles/mobileControl'");
    expect(DOCK).toContain("from '../styles/mobileControl'");
  });

  test('퀵바 키가 크기·모서리를 직접 적지 않는다', () => {
    const key = TOOLBAR.slice(TOOLBAR.indexOf('  key: {'));
    const block = key.slice(0, key.indexOf('\n  },'));
    expect(block).toContain('MOBILE_CONTROL.size');
    expect(block).toContain('MOBILE_CONTROL.radius');
    expect(block).not.toMatch(/height: '\d+px'/);
  });

  test('구분선 높이는 양쪽 모두 상수에서 온다', () => {
    const uses = (src) => (src.match(/MOBILE_CONTROL\.dividerHeight/g) || []).length;
    expect(uses(TOOLBAR)).toBe(1);
    expect(uses(DOCK)).toBe(1);
  });

  test('아이콘은 버튼보다 작다 — 안 그러면 눌리는 면이 안 보인다', () => {
    expect(MOBILE_CONTROL.icon).toBeLessThan(MOBILE_CONTROL.size);
    expect(MOBILE_CONTROL.dividerHeight).toBeLessThan(MOBILE_CONTROL.size);
  });
});
