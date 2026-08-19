import { describe, it, expect } from 'vitest';
import { segmentedItemStyle, segmentedTrackStyle, applySegmentedHover } from './segmented';

/**
 * 세 칸이 나란히 서고 나서야 드러난 문제: 호버가 칸의 **면**을 칠하면 선택된 칸과
 * 나란히 놓였을 때 "선택이 둘" 처럼 읽힌다. 그래서 이 파일이 지키는 것은 색 값이 아니라
 * **호버는 선택보다 항상 약하다** 는 관계다.
 */
describe('segmented switch', () => {
  it('선택된 칸만 두께를 갖는다 — 호버는 그림자를 얻지 못한다', () => {
    expect(segmentedItemStyle({ active: true }).boxShadow).not.toBe('none');
    expect(segmentedItemStyle({ active: false }).boxShadow).toBe('none');
  });

  it('호버는 글자를 밝히고 바닥은 겨우 스친다', () => {
    const el = { style: {} };
    applySegmentedHover(el, true);
    expect(el.style.color).toBeTruthy();
    // 선택된 칸의 면(--ui-surface1)을 쓰지 않는다 — 그러면 구별이 사라진다.
    expect(el.style.background).not.toContain('surface1');
    expect(el.style.background).toContain('4%');
  });

  it('호버를 풀면 원래대로 — 배경과 글자색이 함께 되돌아간다', () => {
    const el = { style: {} };
    applySegmentedHover(el, true);
    applySegmentedHover(el, false);
    expect(el.style.background).toBe('transparent');
    expect(el.style.color).toBeTruthy();
  });

  it('칸 모서리는 홈보다 작다 — 크면 모서리마다 트랙이 비어져 나온다', () => {
    const inset = parseInt(segmentedTrackStyle().padding, 10);
    const outer = parseInt(segmentedTrackStyle().borderRadius, 10);
    const inner = parseInt(segmentedItemStyle().borderRadius, 10);
    expect(inner).toBe(outer - inset);
  });

  it('요소가 없어도 죽지 않는다', () => {
    expect(() => applySegmentedHover(null, true)).not.toThrow();
  });
});
