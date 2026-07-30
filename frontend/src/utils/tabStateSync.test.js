import { describe, it, expect } from 'vitest';
import { tabsFingerprint, areTabsEquivalent, pickFallbackTabId } from './tabStateSync';

const tab = (id, extra = {}) => ({
  id, type: 'local', name: id, panes: [{ id: `${id}-p0`, mode: 'terminal', sessionId: id }], ...extra,
});

describe('areTabsEquivalent', () => {
  it('두 배열이 참조는 달라도 내용이 같으면 동일로 본다 (에코 PUT 차단의 핵심)', () => {
    // Arrange
    const local = [tab('a'), tab('b')];
    const fromServer = JSON.parse(JSON.stringify(local));   // 서버 왕복 시뮬레이션

    // Act & Assert
    expect(areTabsEquivalent(local, fromServer)).toBe(true);
  });

  it('키 순서가 달라도 동일로 본다', () => {
    expect(areTabsEquivalent(
      [{ id: 'a', name: 'x', panes: [] }],
      [{ panes: [], name: 'x', id: 'a' }],
    )).toBe(true);
  });

  it('undefined 값 키는 없는 것으로 본다 (JSON 왕복과 동일)', () => {
    expect(areTabsEquivalent(
      [{ id: 'a', cwd: undefined }],
      [{ id: 'a' }],
    )).toBe(true);
  });

  it('탭 순서가 바뀌면 다르다', () => {
    expect(areTabsEquivalent([tab('a'), tab('b')], [tab('b'), tab('a')])).toBe(false);
  });

  it('pane 내부 한 필드만 달라도 다르다', () => {
    const changed = [{ ...tab('a'), panes: [{ id: 'a-p0', mode: 'terminal', sessionId: 'other' }] }];
    expect(areTabsEquivalent([tab('a')], changed)).toBe(false);
  });

  it('null 과 빈 배열은 서로 다르고, 빈 입력은 안전하다', () => {
    expect(tabsFingerprint()).toBe('[]');
    expect(areTabsEquivalent([], [])).toBe(true);
    expect(areTabsEquivalent([{ id: 'a', cwd: null }], [{ id: 'a' }])).toBe(false);
  });
});

describe('pickFallbackTabId', () => {
  it('사라진 자리의 이웃 탭을 고른다 (첫 탭으로 튕기지 않음)', () => {
    expect(pickFallbackTabId([tab('a'), tab('b'), tab('c')], 2)).toBe('c');
  });

  it('마지막 탭이 사라졌으면 새 마지막으로 클램프', () => {
    expect(pickFallbackTabId([tab('a'), tab('b')], 5)).toBe('b');
  });

  it('탭이 하나도 없으면 null (홈 화면)', () => {
    expect(pickFallbackTabId([], 3)).toBeNull();
  });

  it('위치를 모르면 첫 탭', () => {
    expect(pickFallbackTabId([tab('a'), tab('b')], -1)).toBe('a');
    expect(pickFallbackTabId([tab('a'), tab('b')])).toBe('a');
  });
});
