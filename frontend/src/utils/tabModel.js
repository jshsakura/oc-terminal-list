/**
 * 탭/pane 모델 팩토리 + tmux 세션명/테마 프로파일 헬퍼 + 뷰포트 판별.
 * 모델: tab = { id, type, name, ..., panes:[Pane], layout, splitTree, activePaneId }
 * Pane = { id, mode:'terminal'|'editor', sessionId?, hostId?, ... }
 * App.jsx 에서 로직 변경 없이 추출한 순수 함수.
 */
import { generateUUID } from './helpers';
import { makeLeaf, treeFromLegacyLayout } from './splitTree';
import { resolveRandomTheme } from '../components/common/ThemePicker';

export const isPhoneViewport = () => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isPhoneUA = /iPhone|iPod/i.test(ua) || (/Android/i.test(ua) && !/Tablet|iPad/i.test(ua));
  const isTouchLike = window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0;
  return window.innerWidth < 768 && (isPhoneUA || isTouchLike);
};

export const makePane = (extra = {}) => ({
  id: generateUUID(),
  mode: 'terminal',
  ...extra,
});

export const makLocalTab = (sessionId, name, cwd = null, { icon = null, colorIndex = null, themeOverride = null } = {}) => {
  const pane = makePane({ sessionId, ...(themeOverride ? { themeOverride } : null) });
  return {
    id: `local:${sessionId}`,
    type: 'local',
    sessionId,
    name: name || 'terminal',
    cwd: cwd ?? null,
    icon: icon || null,
    color_index: colorIndex ?? 0,
    panes: [pane],
    layout: 'single',
    splitTree: makeLeaf(pane.id),
    activePaneId: pane.id,
  };
};

// 호스트 탭마다 고유 tmux 세션 suffix — 같은 호스트라도 새 탭 = 새 작업공간.
// 탭이 서버 tab-state 로 복원될 땐 이 값이 보존되어 같은 세션을 다시 attach.
export const makeTmuxSuffix = () => {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  } catch { /* noop */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

export const sanitizeTmuxNamePart = (value, fallback = 'mobile') => {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 40);
  return cleaned || fallback;
};

export const makeFreshHostTmuxSessionName = (host) => {
  const base = sanitizeTmuxNamePart(host?.remote_tmux_session || 'mobile');
  return `${base}-${makeTmuxSuffix()}`.slice(0, 64);
};

export const isRandomThemeProfile = (themeId) => themeId === 'random-dark' || themeId === 'random-light';

export const usedThemeIdsFromTabs = (tabs = []) => (
  tabs
    .flatMap((tab) => tab.panes?.map((pane) => pane.themeOverride) || [])
    .filter((themeId) => themeId && !isRandomThemeProfile(themeId))
);

export const resolveProfileTheme = (themeId, usedThemeIds = []) => {
  if (!themeId) return null;
  if (isRandomThemeProfile(themeId)) return resolveRandomTheme(themeId, usedThemeIds);
  return themeId;
};

export const makeHostTab = (host, cwd = null, tmuxSessionName = null, { themeOverride = undefined, tabId = null } = {}) => {
  // tmuxSessionName 이 주어지면 이미 존재하는 영속 세션을 명시적으로 attach (Resume).
  // 새 호스트 터미널도 pane 0 에 fresh tmuxSessionName 을 직접 박는다. paneIndex 기반 이름은
  // 같은 탭/경로에서 예전 원격 tmux 세션이 살아있을 때 "새 터미널"이 기존 세션으로 붙는
  // 사고를 만들 수 있으므로, 신규 생성 경로는 항상 명시 세션명으로 분리한다.
  // profile theme 이 있으면 새 터미널 생성 시점에 구체 테마로 해석해 pane.themeOverride 에 저장.
  const selectedTheme = themeOverride !== undefined ? themeOverride : host.theme;
  const isResume = !!tmuxSessionName;
  const paneTmuxSessionName = tmuxSessionName || makeFreshHostTmuxSessionName(host);
  const pane = makePane({
    hostId: host.id,
    tmuxSessionName: paneTmuxSessionName,
    ...(selectedTheme ? { themeOverride: selectedTheme } : null),
  });
  return {
    id: tabId || `host:${host.id}:${Date.now()}`,
    type: 'host',
    hostId: host.id,
    tmuxSuffix: null,
    name: isResume ? `${host.name} · ${tmuxSessionName}` : host.name,
    icon: host.icon || null,
    color_index: host.color_index ?? 0,
    cwd: cwd ?? null,
    panes: [pane],
    layout: 'single',
    splitTree: makeLeaf(pane.id),
    activePaneId: pane.id,
  };
};

export const makeVncTab = (host, display, { themeOverride = undefined, tabId = null } = {}) => {
  const selectedTheme = themeOverride !== undefined ? themeOverride : host.theme;
  const pane = makePane({
    mode: 'vnc',
    hostId: host.id,
    display,
    ...(selectedTheme ? { themeOverride: selectedTheme } : null),
  });
  return {
    id: tabId || `vnc:${host.id}:${Date.now()}`,
    type: 'host',
    hostId: host.id,
    name: `${host.name} · :${display}`,
    icon: host.icon || null,
    color_index: host.color_index ?? 0,
    cwd: null,
    panes: [pane],
    layout: 'single',
    splitTree: makeLeaf(pane.id),
    activePaneId: pane.id,
  };
};

// pane 의 표시 정체성 키 — 호스트 pane 은 호스트별, 로컬 pane 은 'local' 하나로 묶는다.
// 빈 pane(세션도 호스트도 없음)은 정체성 없음(null).
export const paneIdentityKey = (pane) => {
  if (pane?.hostId) return `host:${pane.hostId}`;
  if (pane?.sessionId) return 'local';
  return null;
};

// 활성 pane 의 표시 정체성 — 탭 제목 타일(이름/아이콘/색)은 항상 활성 pane 을 따라간다.
// 호스트 pane 이면 그 호스트, 로컬 pane 이면 Settings 의 This machine 값. 판별 불가(빈 pane,
// 호스트 목록 미로딩/삭제)면 null — 호출부가 탭 스냅샷 값으로 폴백한다.
// secondaries(deriveTabSecondaryIdentities)와 같은 활성 pane 기준을 써야 주 타일과 스택이
// 절대 같은 정체성을 중복 표시하지 않는다.
export const deriveTabPrimaryIdentity = (tab, hosts = [], settings = {}) => {
  const panes = tab?.panes || [];
  const activePane = panes.find((p) => p.id === tab?.activePaneId) || panes[0] || null;
  if (activePane?.hostId) {
    const host = hosts.find((h) => h.id === activePane.hostId);
    if (!host) return null;
    return { kind: 'host', name: host.name || '', icon: host.icon || '', colorIndex: host.color_index ?? 0 };
  }
  if (activePane?.sessionId) {
    return {
      kind: 'local',
      name: (settings.localName || '').trim() || 'terminal',
      icon: settings.localIcon || '',
      colorIndex: settings.localColorIndex ?? 0,
    };
  }
  return null;
};

// 탭 안 pane 들이 서로 다른 호스트(또는 호스트+로컬)로 섞였을 때, 활성 pane 과 다른
// 정체성 전부의 표시 메타를 pane 순서대로 돌려준다(중복 제거). TabBar 제목탭이
// 아이콘을 겹쳐 그려 "이 탭엔 다른 호스트들도 있다"를 알리는 용도. 안 섞였으면 [].
export const deriveTabSecondaryIdentities = (tab, hosts = [], settings = {}) => {
  const panes = tab?.panes || [];
  if (panes.length < 2) return [];
  const activePane = panes.find((p) => p.id === tab.activePaneId) || panes[0];
  const activeKey = paneIdentityKey(activePane);
  if (!activeKey) return [];
  const seenKeys = new Set([activeKey]);
  const identities = [];
  for (const pane of panes) {
    const key = paneIdentityKey(pane);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (pane.hostId) {
      const host = hosts.find((h) => h.id === pane.hostId);
      identities.push({
        kind: 'host',
        name: host?.name || pane.name || '',
        icon: host?.icon || '',
        colorIndex: host?.color_index ?? 0,
      });
    } else {
      identities.push({
        kind: 'local',
        name: (settings.localName || '').trim() || pane.name || 'terminal',
        icon: settings.localIcon || '',
        colorIndex: settings.localColorIndex ?? 0,
      });
    }
  }
  return identities;
};

// 옛 탭 (panes 없음) 자동 마이그레이션 — localStorage 호환
export const migrateTab = (t) => {
  if (t.panes && t.panes.length > 0) {
    // Ensure splitTree exists
    if (!t.splitTree) {
      return { ...t, splitTree: treeFromLegacyLayout(t.panes, t.layout) };
    }
    return t;
  }
  const pane = makePane({ sessionId: t.sessionId, hostId: t.hostId });
  return { ...t, panes: [pane], layout: 'single', splitTree: makeLeaf(pane.id), activePaneId: pane.id };
};

/** 탭을 닫아도 세션이 살아남는가 — 모든 pane 이 영속(로컬 tmux / use_remote_tmux) 인지. */
export const tabCloseKeepsSession = (tab, hosts = []) => !(tab?.panes || []).some((p) => {
  if (!p.hostId) return false;
  const h = hosts.find((hh) => hh.id === p.hostId);
  return h && !h.use_remote_tmux;
});

/**
 * 탭 하나에 렌더용 파생 메타를 붙인다 — 순수 함수.
 *
 * 이름/아이콘/색은 항상 **활성 pane 의 정체성**을 따라간다(탭에 캡처된 생성 시점
 * 스냅샷으로 굳지 않게). 사용자가 직접 지은 이름(manualName)이 최우선.
 * agentStatus 는 별도 소스(tabAgentStatus)라 여기서 계산하지 않고 인자로 받는다.
 */
export const deriveTabMeta = (tab, { hosts = [], settings = {}, agentStatus = null } = {}) => {
  const host = tab.type === 'host' ? hosts.find((h) => h.id === tab.hostId) : null;
  const isPersistent = tab.type === 'local' || !!host?.use_remote_tmux;
  const closeKeepsSession = tabCloseKeepsSession(tab, hosts);
  const secondaryIdentities = deriveTabSecondaryIdentities(tab, hosts, settings);
  const primary = deriveTabPrimaryIdentity(tab, hosts, settings);
  const common = { ...tab, isPersistent, closeKeepsSession, secondaryIdentities, agentStatus };

  if (host) {
    return {
      ...common,
      primaryKind: primary?.kind || 'host',
      name: tab.manualName ? tab.name : (primary?.name || host.name || tab.name),
      icon: primary ? (primary.icon || null) : (host.icon ?? tab.icon ?? null),
      color_index: primary ? primary.colorIndex : (host.color_index ?? tab.color_index ?? 0),
    };
  }
  if (tab.type === 'local') {
    return {
      ...common,
      primaryKind: primary?.kind || 'local',
      name: tab.manualName ? tab.name : (primary?.name || tab.name || 'terminal'),
      icon: primary ? (primary.icon || null) : (settings.localIcon || tab.icon || null),
      color_index: primary ? primary.colorIndex : (settings.localColorIndex ?? tab.color_index ?? 0),
    };
  }
  return common;
};
