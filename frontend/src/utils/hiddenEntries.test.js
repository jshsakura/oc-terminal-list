import { describe, it, expect, beforeEach } from 'vitest';
import { isHiddenName, splitHiddenEntries, readShowHidden, writeShowHidden } from './hiddenEntries';

describe('hiddenEntries', () => {
  it('점으로 시작하면 숨김', () => {
    expect(isHiddenName('.config')).toBe(true);
    expect(isHiddenName('.git')).toBe(true);
    expect(isHiddenName('workspace')).toBe(false);
    expect(isHiddenName('my.folder')).toBe(false);
  });

  it('. 과 .. 는 이동이지 숨김이 아니다', () => {
    expect(isHiddenName('.')).toBe(false);
    expect(isHiddenName('..')).toBe(false);
  });

  it('이름이 없거나 이상해도 터지지 않는다', () => {
    expect(isHiddenName(undefined)).toBe(false);
    expect(isHiddenName(null)).toBe(false);
    expect(isHiddenName(123)).toBe(false);
  });

  const items = [
    { name: '.git' }, { name: 'src' }, { name: '.cache' }, { name: 'docs' },
  ];

  it('기본은 숨김을 걸러내고 몇 개인지 알려준다', () => {
    const { shown, hiddenCount } = splitHiddenEntries(items, false);
    expect(shown.map((i) => i.name)).toEqual(['src', 'docs']);
    expect(hiddenCount).toBe(2);
  });

  it('토글을 켜면 순서를 유지한 채 전부 보여준다', () => {
    const { shown, hiddenCount } = splitHiddenEntries(items, true);
    expect(shown.map((i) => i.name)).toEqual(['.git', 'src', '.cache', 'docs']);
    // 켜져 있어도 개수는 계속 센다 — 토글 라벨이 이걸 쓴다.
    expect(hiddenCount).toBe(2);
  });

  it('전부 숨김이면 빈 목록 + 개수 — "폴더 없음" 과 구별된다', () => {
    const { shown, hiddenCount } = splitHiddenEntries([{ name: '.a' }, { name: '.b' }], false);
    expect(shown).toEqual([]);
    expect(hiddenCount).toBe(2);
  });

  it('입력이 배열이 아니어도 터지지 않는다', () => {
    expect(splitHiddenEntries(undefined, false)).toEqual({ shown: [], hiddenCount: 0 });
    expect(splitHiddenEntries(null, true)).toEqual({ shown: [], hiddenCount: 0 });
  });

  describe('선호도 저장', () => {
    beforeEach(() => window.localStorage.clear());

    it('기본은 꺼짐', () => {
      expect(readShowHidden()).toBe(false);
    });

    it('켠 값은 다음에 열 때도 남는다', () => {
      writeShowHidden(true);
      expect(readShowHidden()).toBe(true);
      writeShowHidden(false);
      expect(readShowHidden()).toBe(false);
    });
  });
});
