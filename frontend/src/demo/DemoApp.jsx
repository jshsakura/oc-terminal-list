import { useEffect, useMemo, useState } from 'react';
import TabBar from '../components/TabBar';
import DemoPaneGrid from './DemoPaneGrid';
import DemoBanner from './DemoBanner';
import DemoSettingsModal from './DemoSettingsModal';
import { DEMO_HOSTS, DEMO_TABS, DEMO_PANE_POOL } from './demoData';
import { deriveTabPrimaryIdentity, deriveTabSecondaryIdentities } from '../utils/tabModel';

// 데모의 "This machine" 정체성 — DEMO_TABS 의 로컬 탭(workspace) 스냅샷과 동일하게 유지.
const DEMO_LOCAL_SETTINGS = { localName: 'workspace', localIcon: 'TerminalSquare', localColorIndex: 24 };
import { generateUUID } from '../utils/helpers';
import { splitLeaf, ensureTree, makeLeaf, treeFromLegacyLayout } from '../utils/splitTree';
import themes, { defaultTheme } from '../styles/themes';
import { applyThemeVars } from '../styles/themeUI';
import { tokens } from '../styles/tokens';

const { color, font } = tokens;

const nextPoolEntry = (paneCount) => DEMO_PANE_POOL[paneCount % DEMO_PANE_POOL.length];

/**
 * Self-contained live-demo shell. Reuses real production pieces — TabBar,
 * the splitTree utils (utils/splitTree.js), secondary-identity derivation
 * (utils/tabModel.js), and the real theme engine — so tab switching,
 * drag-reorder, split/duplicate, the mixed-host icon stack, and theming all
 * behave exactly like production. Only the transport is fake: terminal
 * content is scripted playback (DemoTerminal) instead of a WebSocket.
 */
const DemoApp = () => {
  const [tabs, setTabs] = useState(DEMO_TABS);
  const [activeTabId, setActiveTabId] = useState(DEMO_TABS[0].id);
  const [themeId, setThemeId] = useState(defaultTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    applyThemeVars(themes[themeId] || themes[defaultTheme]);
  }, [themeId]);

  const handleReorder = (fromId, toId) => {
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      const toIdx = prev.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // 탭 닫기는 데모에서 의미가 없다(백엔드 세션이 없음) — 목록에서만 제거하고,
  // 마지막 탭이면 다시 첫 탭으로 복원해 데모가 빈 화면으로 끝나지 않게 한다.
  const handleClose = (tabId) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) return DEMO_TABS;
      if (activeTabId === tabId) setActiveTabId(next[0].id);
      return next;
    });
  };

  const handleSelectPane = (tabId, paneId) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)));
  };

  // 실제 App.jsx 의 splitActivePane 과 동일한 splitTree 유틸 사용 — 진짜 분할 동작.
  const handleSplit = (dir) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTabId) return t;
      const currentPanes = t.panes || [];
      const activeId = t.activePaneId || currentPanes[0]?.id;

      if (dir === '2x2') {
        if (currentPanes.length >= 4) return t;
        const panes = [...currentPanes];
        while (panes.length < 4) panes.push({ id: generateUUID(), ...nextPoolEntry(panes.length) });
        return { ...t, panes, splitTree: treeFromLegacyLayout(panes, '2x2'), activePaneId: panes[panes.length - 1].id };
      }

      const newPane = { id: generateUUID(), ...nextPoolEntry(currentPanes.length) };
      const panes = [...currentPanes, newPane];
      const currentTree = ensureTree(currentPanes, t.splitTree) || makeLeaf(activeId);
      const { tree: newTree } = splitLeaf(currentTree, activeId, dir, newPane.id);
      return { ...t, panes, splitTree: newTree, activePaneId: newPane.id };
    }));
  };

  const handleDuplicate = (tabId) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;
      const source = prev[idx];
      const idMap = new Map(source.panes.map((p) => [p.id, generateUUID()]));
      const remapTree = (node) => (node.type === 'pane'
        ? { type: 'pane', paneId: idMap.get(node.paneId) }
        : { ...node, children: node.children.map(remapTree) });
      const clone = {
        ...source,
        id: `${source.id}-copy-${generateUUID().slice(0, 8)}`,
        panes: source.panes.map((p) => ({ ...p, id: idMap.get(p.id) })),
        splitTree: remapTree(source.splitTree),
        activePaneId: idMap.get(source.activePaneId),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  };

  // 활성 pane 과 다른 정체성(다른 호스트/로컬)을 전부 파생 — 실제 App.jsx tabsWithMeta 와
  // 동일한 함수라서, split/duplicate 로 호스트가 섞여도 아이콘 스택이 그대로 따라온다.
  // 주 타일(이름/아이콘/색)도 App 과 같이 활성 pane 정체성을 따라간다 — 로컬 pane 활성 시
  // 호스트로 폴백하면 스택에 같은 호스트가 중복 표시된다.
  const displayedTabs = useMemo(() => tabs.map((t) => {
    const primary = deriveTabPrimaryIdentity(t, DEMO_HOSTS, DEMO_LOCAL_SETTINGS);
    const secondaryIdentities = deriveTabSecondaryIdentities(t, DEMO_HOSTS, DEMO_LOCAL_SETTINGS);
    if (!primary) return { ...t, secondaryIdentities };
    return {
      ...t,
      secondaryIdentities,
      primaryKind: primary.kind,
      name: primary.name || t.name,
      icon: primary.icon || null,
      color_index: primary.colorIndex,
    };
  }), [tabs]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--ui-base)' }}>
      <DemoBanner />
      <TabBar
        tabs={displayedTabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={handleClose}
        onCloseImmediate={handleClose}
        onHome={() => {}}
        onOpenSettings={() => setSettingsOpen(true)}
        onReorder={handleReorder}
        canSplit
        onSplit={handleSplit}
        onDuplicate={handleDuplicate}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: '4px',
              display: tab.id === activeTabId ? 'block' : 'none',
            }}
          >
            <DemoPaneGrid
              node={tab.splitTree}
              panesById={Object.fromEntries((tab.panes || []).map((p) => [p.id, p]))}
              activePaneId={tab.activePaneId}
              onSelectPane={(paneId) => handleSelectPane(tab.id, paneId)}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          padding: '4px 12px',
          fontFamily: font.mono,
          fontSize: '10px',
          color: color.muted,
          borderTop: '1px solid var(--ui-border)',
          flexShrink: 0,
        }}
      >
        Terminal List — {DEMO_HOSTS.length} sample hosts connected · right-click a tab to split/duplicate · this playback loops automatically
      </div>
      <DemoSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activeThemeId={themeId}
        onSelectTheme={setThemeId}
      />
    </div>
  );
};

export default DemoApp;
