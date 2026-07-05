import { useEffect, useState } from 'react';
import TabBar from '../components/TabBar';
import DemoTerminal from './DemoTerminal';
import DemoBanner from './DemoBanner';
import { DEMO_HOSTS, DEMO_TABS, DEMO_SCRIPTS } from './demoData';
import themes, { defaultTheme } from '../styles/themes';
import { applyThemeVars } from '../styles/themeUI';
import { tokens } from '../styles/tokens';

const { color, font } = tokens;

/**
 * Self-contained live-demo shell. Reuses the real TabBar component (so tab
 * switching, drag-reorder, and the mixed-host icon stack look and behave
 * exactly like production) but never talks to a backend — tab state lives
 * in useState, terminal content is scripted playback (DemoTerminal).
 */
const DemoApp = () => {
  const [tabs, setTabs] = useState(DEMO_TABS);
  const [activeTabId, setActiveTabId] = useState(DEMO_TABS[0].id);

  useEffect(() => {
    applyThemeVars(themes[defaultTheme]);
  }, []);

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

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--ui-base)' }}>
      <DemoBanner />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={handleClose}
        onCloseImmediate={handleClose}
        onHome={() => {}}
        onOpenSettings={() => {}}
        onReorder={handleReorder}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: tab.id === activeTabId ? 'block' : 'none',
            }}
          >
            <DemoTerminal script={DEMO_SCRIPTS[tab.scriptId]} isActive={tab.id === activeTabId} />
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
        Terminal List — {DEMO_HOSTS.length} sample hosts connected · this playback loops automatically
      </div>
    </div>
  );
};

export default DemoApp;
