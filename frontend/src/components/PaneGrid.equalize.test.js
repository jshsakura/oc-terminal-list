import { describe, test, expect } from 'vitest';
import { countLeaves, balancedRatios } from './PaneGrid';

const pane = (id) => ({ type: 'pane', paneId: id });
const split = (direction, ...children) => ({ type: 'split', direction, children });

/**
 * renderNode 와 같은 규칙으로 레이아웃을 흉내내 각 leaf 의 면적을 구한다.
 * ratiosFor 를 바꿔 끼워 "기본값" 과 "옛 1/n" 을 비교한다.
 */
const leafAreas = (node, width, height, ratiosFor) => {
  if (node.type === 'pane') return { [node.paneId]: width * height };
  const ratios = ratiosFor(node.children);
  const isRow = node.direction === 'row';
  return node.children.reduce((acc, child, i) => Object.assign(acc, leafAreas(
    child,
    isRow ? width * ratios[i] : width,
    isRow ? height : height * ratios[i],
    ratiosFor,
  )), {});
};

const evenRatios = (children) => children.map(() => 1 / children.length);

// 루트가 4분할이고 첫 칸이 다시 2분할 — 사용자가 보고한 불균등 레이아웃의 형태.
const NESTED_TREE = split('row', split('row', pane('a'), pane('b')), pane('c'), pane('d'), pane('e'));

describe('countLeaves', () => {
  test('counts a bare pane as one leaf', () => {
    expect(countLeaves(pane('a'))).toBe(1);
  });

  test('sums leaves across nested splits', () => {
    expect(countLeaves(NESTED_TREE)).toBe(5);
  });
});

describe('balancedRatios', () => {
  test('weights each child by its leaf count', () => {
    expect(balancedRatios(NESTED_TREE.children)).toEqual([0.4, 0.2, 0.2, 0.2]);
  });

  test('splits evenly when every child is a single pane', () => {
    expect(balancedRatios([pane('a'), pane('b')])).toEqual([0.5, 0.5]);
  });

  test('returns an empty list for a node with no children', () => {
    expect(balancedRatios([])).toEqual([]);
  });

  test('gives every pane equal area in a nested same-direction split', () => {
    const areas = leafAreas(NESTED_TREE, 1000, 600, balancedRatios);

    expect(areas).toEqual({ a: 120000, b: 120000, c: 120000, d: 120000, e: 120000 });
  });

  test('gives every pane equal area when row and column nesting are mixed', () => {
    const tree = split('row', split('column', pane('a'), pane('b')), pane('c'));

    const areas = leafAreas(tree, 900, 600, balancedRatios);

    expect(areas).toEqual({ a: 180000, b: 180000, c: 180000 });
  });

  test('the old even-split default left nested panes at half size', () => {
    // 회귀 방지 — 기본값이 1/n 으로 돌아가면 새로고침 후 다시 이 모양이 된다.
    const areas = leafAreas(NESTED_TREE, 1000, 600, evenRatios);

    expect(areas).toEqual({ a: 75000, b: 75000, c: 150000, d: 150000, e: 150000 });
  });
});
