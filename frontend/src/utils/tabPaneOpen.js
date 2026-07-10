import { ensureTree, makeLeaf, splitLeaf } from './splitTree';

export const layoutForPaneCount = (count, preferredDir = 'right', currentLayout = 'single') => {
  if (count <= 1) return 'single';
  if (count === 2) return (preferredDir === 'down' || preferredDir === 'up') ? 'v' : 'h';
  return currentLayout === 'single' ? '2x2' : '2x2';
};

export const appendPaneAsSplit = (tab, newPane, { afterPaneId = null, dir = 'right' } = {}) => {
  const currentPanes = tab?.panes || [];
  const activeId = afterPaneId || tab?.activePaneId || currentPanes[0]?.id;
  const panes = [...currentPanes, newPane];
  const currentTree = ensureTree(currentPanes, tab?.splitTree) || makeLeaf(activeId);
  const { tree } = splitLeaf(currentTree, activeId, dir, newPane.id);

  return {
    ...tab,
    panes,
    layout: layoutForPaneCount(panes.length, dir, tab?.layout || 'single'),
    splitTree: tree,
    activePaneId: newPane.id,
  };
};
