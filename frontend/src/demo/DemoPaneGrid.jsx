import DemoTerminal from './DemoTerminal';
import { DEMO_SCRIPTS } from './demoData';
import { tokens } from '../styles/tokens';

const { color } = tokens;

/**
 * Recursively renders a real splitTree (utils/splitTree.js shape) so the demo
 * shows genuine split-pane layouts — same tree format the production app
 * builds via splitLeaf(), not a hand-drawn mockup.
 */
const DemoPaneGrid = ({ node, panesById, activePaneId, onSelectPane }) => {
  if (!node) return null;

  if (node.type === 'pane') {
    const pane = panesById[node.paneId];
    if (!pane) return null;
    const isActive = node.paneId === activePaneId;
    return (
      <div
        onMouseDown={() => onSelectPane(node.paneId)}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          border: `1px solid ${isActive ? color.accent : 'var(--ui-border)'}`,
          borderRadius: '4px',
          overflow: 'hidden',
          boxSizing: 'border-box',
          transition: 'border-color 120ms',
        }}
      >
        <DemoTerminal script={DEMO_SCRIPTS[pane.scriptId]} isActive={isActive} />
      </div>
    );
  }

  // node.type === 'split'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: node.direction === 'column' ? 'column' : 'row',
        width: '100%',
        height: '100%',
        gap: '4px',
      }}
    >
      {node.children.map((child, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <DemoPaneGrid
            node={child}
            panesById={panesById}
            activePaneId={activePaneId}
            onSelectPane={onSelectPane}
          />
        </div>
      ))}
    </div>
  );
};

export default DemoPaneGrid;
