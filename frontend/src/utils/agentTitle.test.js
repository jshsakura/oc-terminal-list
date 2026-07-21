import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { detectAgentStatus, agentDisplayTitle, isSpinnerOnlyChange } from './agentTitle';

// 백엔드 test_agent_status.py 와 **같은 파일**을 읽는다.
// 두 구현의 판정이 갈라지면 둘 중 하나가 여기서 깨진다.
const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(
  readFileSync(join(here, '../../../shared/agent-title-cases.json'), 'utf-8'),
);

describe('detectAgentStatus (공유 케이스 표)', () => {
  it.each(CASES.status)('$title → $expect', ({ title, expect: want, why }) => {
    expect(detectAgentStatus(title), why || '').toBe(want);
  });
});

describe('agentDisplayTitle (공유 케이스 표)', () => {
  it.each(CASES.displayTitle)('$title → $expect', ({ title, expect: want }) => {
    expect(agentDisplayTitle(title)).toBe(want);
  });
});

describe('isSpinnerOnlyChange (공유 케이스 표)', () => {
  it.each(CASES.spinnerOnlyChange)('$before → $after = $expect', ({ before, after, expect: want }) => {
    expect(isSpinnerOnlyChange(before, after)).toBe(want);
  });
});

describe('표에 담기 애매한 것들', () => {
  it('null/undefined 타이틀은 에이전트가 아니다', () => {
    expect(detectAgentStatus(null)).toBe(null);
    expect(detectAgentStatus(undefined)).toBe(null);
    expect(agentDisplayTitle(null)).toBe('');
  });
});
