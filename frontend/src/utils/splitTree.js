/**
 * Split tree utilities for arbitrary pane splitting.
 *
 * Tree node shapes:
 *   leaf : { type: 'pane', paneId: string }
 *   split: { type: 'split', direction: 'row' | 'column', children: node[] }
 *
 * 'row'    = horizontal layout (children side by side)
 * 'column' = vertical layout   (children stacked)
 */

// ── constructors ──────────────────────────────────────────────────────────────

export const makeLeaf = (paneId) => ({ type: 'pane', paneId });

export const makeSplit = (direction, children) => ({
  type: 'split',
  direction,
  children,
});

// ── legacy layout → tree migration ────────────────────────────────────────────
// Converts old `layout: 'single'|'h'|'v'|'2x2'` + `panes[]` into a splitTree.

export const treeFromLegacyLayout = (panes, layout) => {
  if (!panes || panes.length === 0) return makeLeaf('unknown');
  if (panes.length === 1) return makeLeaf(panes[0].id);
  if (layout === 'h') {
    return makeSplit('row', panes.map((p) => makeLeaf(p.id)));
  }
  if (layout === 'v') {
    return makeSplit('column', panes.map((p) => makeLeaf(p.id)));
  }
  if (layout === '2x2' && panes.length >= 4) {
    return makeSplit('column', [
      makeSplit('row', [makeLeaf(panes[0].id), makeLeaf(panes[1].id)]),
      makeSplit('row', [makeLeaf(panes[2].id), makeLeaf(panes[3].id)]),
    ]);
  }
  // fallback: row split for however many panes exist
  return makeSplit('row', panes.map((p) => makeLeaf(p.id)));
};

// ── direction mapping ─────────────────────────────────────────────────────────
// User-facing direction → tree split direction + insert position

const DIR_MAP = {
  right: { dir: 'row', after: true },
  left:  { dir: 'row', after: false },
  down:  { dir: 'column', after: true },
  up:    { dir: 'column', after: false },
};

// Legacy aliases
const LEGACY_MAP = {
  h: 'right',
  v: 'down',
};

// ── find leaf in tree ─────────────────────────────────────────────────────────

export const findLeaf = (node, paneId) => {
  if (!node) return null;
  if (node.type === 'pane') return node.paneId === paneId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneId);
    if (found) return found;
  }
  return null;
};

// Returns { parent, index } for the node containing the leaf with paneId.
// parent is null for the root.
const findLeafParent = (node, paneId, parent = null) => {
  if (!node) return null;
  if (node.type === 'pane') {
    return node.paneId === paneId ? { parent, index: -1 } : null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'pane' && child.paneId === paneId) {
      return { parent: node, index: i };
    }
    if (child.type === 'split') {
      const result = findLeafParent(child, paneId, node);
      if (result && result.parent !== null) return result;
      // might be the child itself being the parent
      const inner = findLeafParent(child, paneId, child);
      if (inner && inner.parent !== null) return inner;
    }
  }
  return null;
};

// More robust: walk tree and find the parent split + child index for a leaf paneId
export const findLeafContext = (root, paneId) => {
  if (!root) return null;
  if (root.type === 'pane') {
    return root.paneId === paneId ? { parent: null, index: -1, isRoot: true } : null;
  }
  // DFS
  const stack = [{ node: root, parent: null }];
  while (stack.length) {
    const { node: n, parent } = stack.pop();
    if (n.type === 'split') {
      for (let i = 0; i < n.children.length; i++) {
        const child = n.children[i];
        if (child.type === 'pane' && child.paneId === paneId) {
          return { parent: n, index: i, isRoot: parent === null && n === root };
        }
        if (child.type === 'split') {
          stack.push({ node: child, parent: n });
        }
      }
    }
  }
  return null;
};

// ── split a leaf in a given direction ─────────────────────────────────────────
// Returns a new tree with the leaf at `paneId` split, and a new empty leaf added.
// `newPaneId` is the ID of the newly created pane.
// Returns { tree, newPaneId } (newPaneId for convenience, same as input).

export const splitLeaf = (root, paneId, direction, newPaneId) => {
  const resolved = DIR_MAP[LEGACY_MAP[direction] || direction] || DIR_MAP[direction];
  if (!resolved) return { tree: root, newPaneId };
  const { dir, after } = resolved;

  if (!root) {
    return { tree: makeLeaf(paneId), newPaneId };
  }

  // Root is a single leaf — just create a split
  if (root.type === 'pane') {
    const existing = makeLeaf(paneId);
    const created = makeLeaf(newPaneId);
    return {
      tree: makeSplit(dir, after ? [existing, created] : [created, existing]),
      newPaneId,
    };
  }

  // Deep clone + mutate
  const newRoot = JSON.parse(JSON.stringify(root));
  const ctx = findLeafContext(newRoot, paneId);

  if (!ctx) {
    // Leaf not found in tree — append to end
    const created = makeLeaf(newPaneId);
    if (newRoot.type === 'split' && newRoot.direction === dir) {
      after ? newRoot.children.push(created) : newRoot.children.unshift(created);
    } else {
      return {
        tree: makeSplit(dir, after ? [newRoot, created] : [created, newRoot]),
        newPaneId,
      };
    }
    return { tree: newRoot, newPaneId };
  }

  const { parent, index } = ctx;

  // If parent has the same direction, insert into it
  if (parent && parent.direction === dir) {
    const insertIdx = after ? index + 1 : index;
    parent.children.splice(insertIdx, 0, makeLeaf(newPaneId));
  } else {
    // Need to nest: replace the leaf at `index` with a new split
    const existingLeaf = parent.children[index];
    const created = makeLeaf(newPaneId);
    const newSplit = makeSplit(dir, after ? [existingLeaf, created] : [created, existingLeaf]);
    parent.children[index] = newSplit;
  }

  return { tree: newRoot, newPaneId };
};

// ── remove a leaf and collapse ────────────────────────────────────────────────

export const removeLeaf = (root, paneId) => {
  if (!root) return null;

  // Root is the leaf being removed
  if (root.type === 'pane') {
    return root.paneId === paneId ? null : root;
  }

  // Deep clone
  const newRoot = JSON.parse(JSON.stringify(root));

  const doRemove = (node) => {
    if (node.type !== 'split') return;
    // Remove direct leaf children
    node.children = node.children.filter(
      (c) => !(c.type === 'pane' && c.paneId === paneId)
    );
    // Recurse into split children
    for (const child of node.children) {
      if (child.type === 'split') doRemove(child);
    }
  };

  doRemove(newRoot);
  return collapseTree(newRoot);
};

// Collapse: split with 0 children → null, 1 child → promote that child
const collapseTree = (node) => {
  if (!node) return null;
  if (node.type === 'pane') return node;

  // Recursively collapse children first
  const children = node.children.map(collapseTree).filter(Boolean);

  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
};

// ── ensure valid tree ─────────────────────────────────────────────────────────
// Given panes and existing tree, make sure tree is consistent.
// If tree is missing/invalid, create from panes.

export const ensureTree = (panes, tree) => {
  if (!panes || panes.length === 0) return null;

  const paneIds = new Set(panes.map((p) => p.id));

  if (!tree) {
    if (panes.length === 1) return makeLeaf(panes[0].id);
    return makeSplit('row', panes.map((p) => makeLeaf(p.id)));
  }

  // Validate tree references only existing panes
  const validate = (node) => {
    if (!node) return false;
    if (node.type === 'pane') return paneIds.has(node.paneId);
    if (node.type === 'split' && node.children && node.children.length > 0) {
      return node.children.every(validate);
    }
    return false;
  };

  if (validate(tree)) return tree;

  // Rebuild
  if (panes.length === 1) return makeLeaf(panes[0].id);
  return makeSplit('row', panes.map((p) => makeLeaf(p.id)));
};

// ── append panes to tree ──────────────────────────────────────────────────────
// Used when absorbing another tab's panes.
// Appends new pane leaves to the right/bottom of the tree.

// ── swap two leaves by paneId ──────────────────────────────────────────────────
// Swaps the paneId of two leaf nodes in the tree. Used for drag-to-reorder in
// split-tree layouts where visual position is determined by tree structure.
// Returns a new tree (deep-cloned).

export const swapLeaves = (root, paneIdA, paneIdB) => {
  if (!root || paneIdA === paneIdB) return root;
  // Deep clone
  const newRoot = JSON.parse(JSON.stringify(root));
  // Walk and collect positions
  let foundA = null;
  let foundB = null;
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'pane') {
      if (node.paneId === paneIdA) foundA = node;
      if (node.paneId === paneIdB) foundB = node;
      return;
    }
    if (node.type === 'split') {
      for (const child of node.children) walk(child);
    }
  };
  walk(newRoot);
  if (foundA && foundB) {
    foundA.paneId = paneIdB;
    foundB.paneId = paneIdA;
  }
  return newRoot;
};

// ── append panes to tree ──────────────────────────────────────────────────────
// Used when absorbing another tab's panes.
// Appends new pane leaves to the right/bottom of the tree.

export const appendLeaves = (root, newPaneIds, direction = 'row') => {
  const newLeaves = newPaneIds.map((id) => makeLeaf(id));
  if (!root) {
    if (newLeaves.length === 0) return null;
    if (newLeaves.length === 1) return newLeaves[0];
    return makeSplit(direction, newLeaves);
  }
  // If root is same direction, extend children
  if (root.type === 'split' && root.direction === direction) {
    return { ...root, children: [...root.children, ...newLeaves] };
  }
  // Otherwise wrap
  return makeSplit(direction, [root, ...newLeaves]);
};
