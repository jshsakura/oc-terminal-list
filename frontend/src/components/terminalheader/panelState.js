/**
 * 사이드 패널의 치수·탭 목록·localStorage 영속.
 *
 * 스타일(terminalHeaderStyles.js)과 본체(TerminalHeader.jsx)가 같은 치수를 봐야 해서
 * 별도 모듈로 둔다 — 한쪽에만 있으면 레일 높이가 어긋난다.
 */
import { Folder, GitBranch, Info, Palette } from 'lucide-react';

const DEFAULT_PANEL_WIDTH = 260;
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 500;
const TOP_RAIL_HEIGHT = 30;
const PANEL_STATE_PREFIX = 'iterm:terminal-header-panel:v1:';

const TABS = [
  { id: 'files', icon: Folder, label: 'Files' },
  { id: 'git',   icon: GitBranch, label: 'Git' },
  { id: 'info',  icon: Info,     label: 'Info' },
  { id: 'theme', icon: Palette,   label: 'Theme' },
];
const PANEL_IDS = new Set(TABS.map((tab) => tab.id));

const readPanelState = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { activePanel: null, panelWidth: DEFAULT_PANEL_WIDTH };
    const parsed = JSON.parse(raw);
    const activePanel = PANEL_IDS.has(parsed?.activePanel) ? parsed.activePanel : null;
    const width = Number(parsed?.panelWidth);
    const panelWidth = Number.isFinite(width)
      ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width))
      : DEFAULT_PANEL_WIDTH;
    return { activePanel, panelWidth };
  } catch {
    return { activePanel: null, panelWidth: DEFAULT_PANEL_WIDTH };
  }
};

export {
  DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, TOP_RAIL_HEIGHT,
  PANEL_STATE_PREFIX, TABS, PANEL_IDS, readPanelState,
};
