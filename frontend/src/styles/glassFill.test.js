import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 이북 모드는 유리를 **불투명으로** 만든다. 그 스위치는 CSS 변수 하나(`--glass-fill`)이고,
 * 이 앱의 면들이 인라인 style 객체로 나가기 때문에 CSS 특이도로는 닿을 수 없다 —
 * 각 자리가 그 변수를 **직접** 써야만 한다.
 *
 * 그래서 이 테스트는 소스를 훑는다. 리터럴 퍼센트로 중립 면을 반투명하게 칠하는 코드가
 * 새로 들어오면, 그 면만 이북 모드에서 뒤가 비친 채 남는다 — 그리고 그건 그 화면을
 * 전자잉크 기기로 열어보기 전엔 아무도 모른다.
 *
 * ⚠️ 액센트·위험색 **틴트**는 일부러 제외한다. 그건 이미 불투명한 면 *위에* 얹는 색이고,
 *    100% 로 만들면 글자를 덮는 색 블록이 된다.
 */
const SRC = join(__dirname, '..');

// 중립 면 토큰 — 이것들이 배경으로 쓰일 때만 규칙이 적용된다.
const NEUTRAL = /(surface[012]|--ui-base|--ui-mantle|--ui-crust|\.base\b|\.mantle\b|\.crust\b)/;

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'demo') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(full);
  }
  return out;
};

describe('translucent neutral surfaces route through --glass-fill', () => {
  it('has no literal-percentage neutral fill left in the app', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // A background painted as `color-mix(<colour> NN%, transparent)`.
        const m = line.match(/background(Color)?:\s*`?color-mix\(in srgb,\s*([^,]+?)\s+(\d+)%,\s*transparent\)/);
        if (!m) return;
        if (!NEUTRAL.test(m[2])) return;      // accent / semantic tint — not ours
        offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 96)}`);
      });
    }
    expect(offenders, `이북 모드에서 뒤가 비칠 면들 — \`var(--glass-fill, NN%)\` 로 바꿀 것:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('keeps every fill site pinned to its own default', () => {
    // 이름은 하나지만 값은 자리마다 다르다. fallback 없이 쓰면 이북 모드가 아닐 때
    // 그 면이 통째로 불투명해진다(변수가 정의되어 있지 않으므로).
    const bare = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/var\(--glass-(fill|line)\)/.test(line)) bare.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });
});
