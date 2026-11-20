/**
 * What Terminator can do on screen: the things a button already does.
 *
 * The backend's routes/terminator.py UI_ACTIONS lists the same ids (a test keeps them
 * equal). Running one is a window event that App maps to its own handler, so Terminator
 * never reaches into the app beyond these names.
 *
 * The panel stays open after an action, so the person can keep asking: a window an action
 * opens (palette, settings, hosts) stacks above it. `underSheet` marks the actions whose
 * result happens beneath the phone's sheet (a new pane, the home screen, quick input docked
 * to the pane); on a phone those close the panel, or nothing would seem to happen.
 */
import {
  SquarePlus, Columns2, Rows2, Keyboard, Command, Settings, Smartphone, Server, House,
} from 'lucide-react';

export const UI_ACTIONS = [
  { id: 'new-tab', icon: SquarePlus, labelKey: 'uiActionNewTab', fallback: '새 터미널', underSheet: true },
  { id: 'split-right', icon: Columns2, labelKey: 'uiActionSplitRight', fallback: '오른쪽으로 나누기', underSheet: true },
  { id: 'split-down', icon: Rows2, labelKey: 'uiActionSplitDown', fallback: '아래로 나누기', underSheet: true },
  { id: 'quick-input', icon: Keyboard, labelKey: 'uiActionQuickInput', fallback: '빠른 입력', underSheet: true },
  { id: 'command-palette', icon: Command, labelKey: 'uiActionCommandPalette', fallback: '명령 팔레트' },
  { id: 'settings', icon: Settings, labelKey: 'uiActionSettings', fallback: '설정' },
  { id: 'settings-mobile', icon: Smartphone, labelKey: 'uiActionSettingsMobile', fallback: '모바일 키 설정' },
  { id: 'hosts', icon: Server, labelKey: 'uiActionHosts', fallback: '호스트' },
  { id: 'home', icon: House, labelKey: 'uiActionHome', fallback: '홈', underSheet: true },
];

const BY_ID = new Map(UI_ACTIONS.map((action) => [action.id, action]));

export const uiAction = (id) => BY_ID.get(id) || null;

export const uiActionLabel = (id, t) => {
  const action = BY_ID.get(id);
  return action ? (t?.(action.labelKey) || action.fallback) : '';
};

export const closesPanelOnMobile = (id) => !!BY_ID.get(id)?.underSheet;

export const UI_ACTION_EVENT = 'iterm:ui-action';

export const runUiAction = (id) => {
  if (!BY_ID.has(id)) return false;
  window.dispatchEvent(new CustomEvent(UI_ACTION_EVENT, { detail: { action: id } }));
  return true;
};
