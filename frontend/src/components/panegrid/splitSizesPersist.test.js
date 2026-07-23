import { describe, it, expect } from 'vitest';

// splitSizes 영속의 순수 로직 — 하이드레이션과 균등화 시 키 필터.
// (드래그 자체는 DOM 이벤트라 여기선 로직만 고정한다.)

// PaneGrid 초기값: 탭에 저장된 splitSizes 로 시작해야 새로고침 후 복원된다.
const hydrate = (tab) => tab?.splitSizes || {};

// equalizeCurrentTab: 이 탭 키만 지우고 나머지 탭 크기는 보존.
const equalizeForTab = (prev, tabId) => {
  const prefix = `${tabId}:`;
  const next = {};
  Object.keys(prev).forEach((k) => { if (!k.startsWith(prefix)) next[k] = prev[k]; });
  return next;
};

describe('splitSizes 하이드레이션', () => {
  it('탭에 저장된 크기로 시작한다 — 새로고침 복원의 핵심', () => {
    const sizes = { 't1:root': [0.7, 0.3] };
    expect(hydrate({ id: 't1', splitSizes: sizes })).toEqual(sizes);
  });

  it('저장된 게 없으면 빈 객체(균등분할 기본값으로 떨어짐)', () => {
    expect(hydrate({ id: 't1' })).toEqual({});
    expect(hydrate(null)).toEqual({});
  });
});

describe('equalize 시 키 필터', () => {
  it('이 탭 키만 지우고 다른 탭 크기는 남긴다', () => {
    const prev = { 't1:root': [0.7, 0.3], 't1:root.0': [0.5, 0.5], 't2:root': [0.6, 0.4] };
    expect(equalizeForTab(prev, 't1')).toEqual({ 't2:root': [0.6, 0.4] });
  });

  it('이름이 겹치는 다른 탭을 잘못 지우지 않는다', () => {
    // 't1' prefix 가 't10:...' 을 물면 안 된다 — 콜론이 경계다.
    const prev = { 't1:root': [0.7, 0.3], 't10:root': [0.6, 0.4] };
    expect(equalizeForTab(prev, 't1')).toEqual({ 't10:root': [0.6, 0.4] });
  });
});
