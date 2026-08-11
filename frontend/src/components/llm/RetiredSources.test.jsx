import { describe, it, expect } from 'vitest';
import { retentionNote } from './RetiredSources';

/* 보관이 1년이라 남은 기간이 대개 세 자리다. "364일 후 정리" 는 정밀하지만 아무도
   그 정밀도를 쓰지 않는다 — 한 달 안쪽에서만 일 단위가 의미를 갖는다. */
describe('retentionNote', () => {
  it('한 달 안쪽은 일 단위로 센다', () => {
    expect(retentionNote(1)).toBe('1일 후 정리');
    expect(retentionNote(30)).toBe('30일 후 정리');
  });

  it('그보다 멀면 개월로 뭉뚱그린다', () => {
    expect(retentionNote(31)).toBe('약 1개월 후 정리');
    expect(retentionNote(365)).toBe('약 12개월 후 정리');
  });

  it('만료됐거나 값이 없으면 곧 정리된다고 말한다', () => {
    expect(retentionNote(0)).toBe('곧 정리됨');
    expect(retentionNote(null)).toBe('곧 정리됨');
    expect(retentionNote(undefined)).toBe('곧 정리됨');
  });

  it('번역이 있으면 그걸 쓴다', () => {
    const t = (k) => ({ llmRetiredDaysLeft: 'in {n}d', llmRetiredMonthsLeft: '~{n}mo' }[k]);
    expect(retentionNote(5, t)).toBe('in 5d');
    expect(retentionNote(90, t)).toBe('~3mo');
  });
});
