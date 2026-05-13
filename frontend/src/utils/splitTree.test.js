import { describe, it, expect } from 'vitest';
import {
  makeLeaf, makeSplit, treeFromLegacyLayout,
  splitLeaf, removeLeaf, ensureTree, appendLeaves, findLeaf,
  swapLeaves,
} from '../utils/splitTree';

describe('splitTree utilities', () => {
  // ── constructors ────────────────────────────────────────────────────────────
  it('makeLeaf creates a pane node', () => {
    const leaf = makeLeaf('abc');
    expect(leaf).toEqual({ type: 'pane', paneId: 'abc' });
  });

  it('makeSplit creates a split node', () => {
    const split = makeSplit('row', [makeLeaf('a'), makeLeaf('b')]);
    expect(split.type).toBe('split');
    expect(split.direction).toBe('row');
    expect(split.children).toHaveLength(2);
  });

  // ── legacy migration ────────────────────────────────────────────────────────
  it('treeFromLegacyLayout single pane → leaf', () => {
    const panes = [{ id: 'p1' }];
    const tree = treeFromLegacyLayout(panes, 'single');
    expect(tree).toEqual({ type: 'pane', paneId: 'p1' });
  });

  it('treeFromLegacyLayout h → row split', () => {
    const panes = [{ id: 'p1' }, { id: 'p2' }];
    const tree = treeFromLegacyLayout(panes, 'h');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('row');
    expect(tree.children).toHaveLength(2);
  });

  it('treeFromLegacyLayout v → column split', () => {
    const panes = [{ id: 'p1' }, { id: 'p2' }];
    const tree = treeFromLegacyLayout(panes, 'v');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('column');
  });

  it('treeFromLegacyLayout 2x2 → nested column of rows', () => {
    const panes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const tree = treeFromLegacyLayout(panes, '2x2');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('column');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].direction).toBe('row');
    expect(tree.children[0].children[0].paneId).toBe('a');
    expect(tree.children[0].children[1].paneId).toBe('b');
    expect(tree.children[1].children[0].paneId).toBe('c');
    expect(tree.children[1].children[1].paneId).toBe('d');
  });

  // ── splitLeaf ───────────────────────────────────────────────────────────────
  it('splitLeaf on root leaf creates a split', () => {
    const root = makeLeaf('p1');
    const { tree } = splitLeaf(root, 'p1', 'right', 'p2');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('row');
    expect(tree.children[0].paneId).toBe('p1');
    expect(tree.children[1].paneId).toBe('p2');
  });

  it('splitLeaf left puts new pane first', () => {
    const root = makeLeaf('p1');
    const { tree } = splitLeaf(root, 'p1', 'left', 'p2');
    expect(tree.children[0].paneId).toBe('p2');
    expect(tree.children[1].paneId).toBe('p1');
  });

  it('splitLeaf down creates column split', () => {
    const root = makeLeaf('p1');
    const { tree } = splitLeaf(root, 'p1', 'down', 'p2');
    expect(tree.direction).toBe('column');
    expect(tree.children[1].paneId).toBe('p2');
  });

  it('splitLeaf up puts new pane first in column', () => {
    const root = makeLeaf('p1');
    const { tree } = splitLeaf(root, 'p1', 'up', 'p2');
    expect(tree.direction).toBe('column');
    expect(tree.children[0].paneId).toBe('p2');
  });

  it('splitLeaf reuses parent split with same direction', () => {
    // row split with p1, p2 — split p1 right → insert p3 after p1
    const root = makeSplit('row', [makeLeaf('p1'), makeLeaf('p2')]);
    const { tree } = splitLeaf(root, 'p1', 'right', 'p3');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('row');
    expect(tree.children).toHaveLength(3);
    expect(tree.children[0].paneId).toBe('p1');
    expect(tree.children[1].paneId).toBe('p3');
    expect(tree.children[2].paneId).toBe('p2');
  });

  it('splitLeaf nests when direction differs from parent', () => {
    // row split with p1, p2 — split p1 down → create nested column
    const root = makeSplit('row', [makeLeaf('p1'), makeLeaf('p2')]);
    const { tree } = splitLeaf(root, 'p1', 'down', 'p3');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('row');
    expect(tree.children).toHaveLength(2);
    // p1 should now be a column split
    expect(tree.children[0].type).toBe('split');
    expect(tree.children[0].direction).toBe('column');
    expect(tree.children[0].children[0].paneId).toBe('p1');
    expect(tree.children[0].children[1].paneId).toBe('p3');
  });

  it('splitLeaf handles legacy h alias as right', () => {
    const root = makeLeaf('p1');
    const { tree } = splitLeaf(root, 'p1', 'h', 'p2');
    expect(tree.direction).toBe('row');
    expect(tree.children[1].paneId).toBe('p2');
  });

  it('splitLeaf handles legacy v alias as down', () => {
    const root = makeLeaf('p1');
    const { tree } = splitLeaf(root, 'p1', 'v', 'p2');
    expect(tree.direction).toBe('column');
    expect(tree.children[1].paneId).toBe('p2');
  });

  it('allows more than 4 panes through repeated splitting', () => {
    let root = makeLeaf('p1');
    root = splitLeaf(root, 'p1', 'right', 'p2').tree;
    root = splitLeaf(root, 'p2', 'right', 'p3').tree;
    root = splitLeaf(root, 'p3', 'right', 'p4').tree;
    root = splitLeaf(root, 'p4', 'right', 'p5').tree;
    // Should be a single row split with 5 children
    expect(root.type).toBe('split');
    expect(root.direction).toBe('row');
    expect(root.children).toHaveLength(5);
  });

  // ── removeLeaf ──────────────────────────────────────────────────────────────
  it('removeLeaf on root leaf returns null', () => {
    const root = makeLeaf('p1');
    expect(removeLeaf(root, 'p1')).toBeNull();
  });

  it('removeLeaf collapses single-child split', () => {
    const root = makeSplit('row', [makeLeaf('p1'), makeLeaf('p2')]);
    const result = removeLeaf(root, 'p2');
    // Should collapse to just the remaining leaf
    expect(result).toEqual({ type: 'pane', paneId: 'p1' });
  });

  it('removeLeaf on middle child in 3-pane row', () => {
    const root = makeSplit('row', [makeLeaf('p1'), makeLeaf('p2'), makeLeaf('p3')]);
    const result = removeLeaf(root, 'p2');
    expect(result.type).toBe('split');
    expect(result.children).toHaveLength(2);
    expect(result.children[0].paneId).toBe('p1');
    expect(result.children[1].paneId).toBe('p3');
  });

  it('removeLeaf on nested tree collapses correctly', () => {
    // 2x2: column[row(p1,p2), row(p3,p4)]
    const root = makeSplit('column', [
      makeSplit('row', [makeLeaf('p1'), makeLeaf('p2')]),
      makeSplit('row', [makeLeaf('p3'), makeLeaf('p4')]),
    ]);
    // Remove p2 — row should collapse to leaf(p1)
    const result = removeLeaf(root, 'p2');
    expect(result.type).toBe('split');
    expect(result.direction).toBe('column');
    expect(result.children[0]).toEqual({ type: 'pane', paneId: 'p1' });
    expect(result.children[1].type).toBe('split');
  });

  it('removeLeaf removes p1 and p4 from 2x2 leaving column(p2, p3)', () => {
    const root = makeSplit('column', [
      makeSplit('row', [makeLeaf('p1'), makeLeaf('p2')]),
      makeSplit('row', [makeLeaf('p3'), makeLeaf('p4')]),
    ]);
    let result = removeLeaf(root, 'p1');
    result = removeLeaf(result, 'p4');
    // Both rows should have collapsed to leaves, column should remain
    expect(result.type).toBe('split');
    expect(result.direction).toBe('column');
    expect(result.children).toHaveLength(2);
    expect(result.children[0].paneId).toBe('p2');
    expect(result.children[1].paneId).toBe('p3');
  });

  // ── ensureTree ──────────────────────────────────────────────────────────────
  it('ensureTree returns null for empty panes', () => {
    expect(ensureTree([], null)).toBeNull();
  });

  it('ensureTree creates leaf for single pane', () => {
    const tree = ensureTree([{ id: 'a' }], null);
    expect(tree).toEqual({ type: 'pane', paneId: 'a' });
  });

  it('ensureTree creates row split for multiple panes', () => {
    const tree = ensureTree([{ id: 'a' }, { id: 'b' }], null);
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('row');
  });

  it('ensureTree rebuilds if tree references stale paneId', () => {
    const badTree = makeLeaf('nonexistent');
    const tree = ensureTree([{ id: 'a' }, { id: 'b' }], badTree);
    expect(tree.type).toBe('split');
    expect(tree.children[0].paneId).toBe('a');
  });

  it('ensureTree keeps valid tree unchanged', () => {
    const validTree = makeSplit('row', [makeLeaf('a'), makeLeaf('b')]);
    const tree = ensureTree([{ id: 'a' }, { id: 'b' }], validTree);
    expect(tree).toBe(validTree);
  });

  // ── appendLeaves ────────────────────────────────────────────────────────────
  it('appendLeaves to null creates new split', () => {
    const tree = appendLeaves(null, ['a', 'b'], 'row');
    expect(tree.type).toBe('split');
    expect(tree.children).toHaveLength(2);
  });

  it('appendLeaves extends matching direction', () => {
    const root = makeSplit('row', [makeLeaf('a')]);
    const tree = appendLeaves(root, ['b', 'c'], 'row');
    expect(tree.children).toHaveLength(3);
  });

  it('appendLeaves wraps when direction differs', () => {
    const root = makeSplit('row', [makeLeaf('a')]);
    const tree = appendLeaves(root, ['b'], 'column');
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('column');
    expect(tree.children).toHaveLength(2);
  });

  // ── findLeaf ────────────────────────────────────────────────────────────────
  it('findLeaf finds leaf in simple tree', () => {
    const root = makeSplit('row', [makeLeaf('a'), makeLeaf('b')]);
    expect(findLeaf(root, 'a')).toEqual({ type: 'pane', paneId: 'a' });
    expect(findLeaf(root, 'x')).toBeNull();
  });

  it('findLeaf finds leaf in nested tree', () => {
    const root = makeSplit('column', [
      makeSplit('row', [makeLeaf('a'), makeLeaf('b')]),
      makeLeaf('c'),
    ]);
    expect(findLeaf(root, 'b').paneId).toBe('b');
    expect(findLeaf(root, 'c').paneId).toBe('c');
  });

  // ── swapLeaves ───────────────────────────────────────────────────────────────
  it('swapLeaves swaps two leaves in a flat row', () => {
    const root = makeSplit('row', [makeLeaf('p1'), makeLeaf('p2'), makeLeaf('p3')]);
    const result = swapLeaves(root, 'p1', 'p3');
    expect(result.children[0].paneId).toBe('p3');
    expect(result.children[1].paneId).toBe('p2');
    expect(result.children[2].paneId).toBe('p1');
  });

  it('swapLeaves swaps leaves in a nested 2x2 tree', () => {
    const root = makeSplit('column', [
      makeSplit('row', [makeLeaf('a'), makeLeaf('b')]),
      makeSplit('row', [makeLeaf('c'), makeLeaf('d')]),
    ]);
    const result = swapLeaves(root, 'a', 'd');
    // a and d swap positions in the tree
    expect(result.children[0].children[0].paneId).toBe('d');
    expect(result.children[1].children[1].paneId).toBe('a');
    // b and c unchanged
    expect(result.children[0].children[1].paneId).toBe('b');
    expect(result.children[1].children[0].paneId).toBe('c');
  });

  it('swapLeaves returns same tree if either ID not found', () => {
    const root = makeSplit('row', [makeLeaf('a'), makeLeaf('b')]);
    const result = swapLeaves(root, 'a', 'nonexistent');
    // a found but nonexistent not → no swap
    expect(result.children[0].paneId).toBe('a');
    expect(result.children[1].paneId).toBe('b');
  });

  it('swapLeaves returns root unchanged when IDs are equal', () => {
    const root = makeSplit('row', [makeLeaf('a'), makeLeaf('b')]);
    const result = swapLeaves(root, 'a', 'a');
    expect(result.children[0].paneId).toBe('a');
  });

  it('swapLeaves does not mutate original tree', () => {
    const root = makeSplit('row', [makeLeaf('x'), makeLeaf('y')]);
    const result = swapLeaves(root, 'x', 'y');
    // Original unchanged
    expect(root.children[0].paneId).toBe('x');
    expect(root.children[1].paneId).toBe('y');
    // Result swapped
    expect(result.children[0].paneId).toBe('y');
    expect(result.children[1].paneId).toBe('x');
  });
});
