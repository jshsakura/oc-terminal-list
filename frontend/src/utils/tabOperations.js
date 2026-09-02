/**
 * 탭/pane 상태 전이 — 순수 리듀서 모음.
 *
 * App.jsx 에서 로직 변경 없이 옮겨왔다. 전부 `(tabs, args) => nextTabs` 형태이며
 * 부수효과가 없다(세션 종료·원격 tmux kill 처럼 부수효과가 있는 조작은 App 에 남겼다).
 *
 * 왜 뺐나: 앱에서 가장 복잡한 상태 기계인데 App.jsx 안에 있는 동안은 **테스트가
 * 하나도 없었다** — App 을 렌더하는 테스트가 존재하지 않기 때문이다. 순수 함수로
 * 나오면서 처음으로 직접 검증 가능해졌다 (tabOperations.test.js).
 *
 * 외부 의존(hosts, settings, activeTabId, computePaneTmuxSession)은 전부 인자로 받는다.
 */
import { generateUUID } from './helpers';
import {
  makeLeaf, treeFromLegacyLayout, splitLeaf, removeLeaf, ensureTree, swapLeaves,
} from './splitTree';
import {
  makePane, makeFreshHostTmuxSessionName, usedThemeIdsFromTabs, resolveProfileTheme,
} from './tabModel';
/** 탭 안에서 pane 을 쪼갠다. dir='2x2' 는 빈 picker pane 을 4개까지 채운다. */
export const splitPaneOp = (tabs, { dir = 'h', targetTabId, targetPaneId, activeTabId }) => {
  const prev = tabs;
  const tid = targetTabId || activeTabId;
  if (!tid) return prev;
  return prev.map((t) => {
    if (t.id !== tid) return t;
    const currentPanes = t.panes || [];
    const activeId = targetPaneId || t.activePaneId || currentPanes[0]?.id;

    /* '2x2' — up to 4 empty picker panes. */
    if (dir === '2x2') {
      if (currentPanes.length >= 4) return { ...t, layout: '2x2', splitTree: treeFromLegacyLayout(currentPanes, '2x2') };
      const panes = [...currentPanes];
      while (panes.length < 4) panes.push(makePane({}));
      return {
        ...t,
        panes,
        layout: '2x2',
        splitTree: treeFromLegacyLayout(panes, '2x2'),
        activePaneId: panes[panes.length - 1]?.id || t.activePaneId || panes[0].id,
      };
    }

    /* direction split — no pane limit, creates an empty picker pane */
    const effectiveDir = dir === 'h' ? 'right' : dir === 'v' ? 'down' : dir;
    const newPane = makePane({});
    const panes = [...currentPanes, newPane];
    const currentTree = ensureTree(currentPanes, t.splitTree) || makeLeaf(activeId);
    const { tree: newTree } = splitLeaf(currentTree, activeId, effectiveDir, newPane.id);

    // Legacy layout hint for compatibility
    let layout = t.layout || 'single';
    if (panes.length === 2) layout = (effectiveDir === 'down' || effectiveDir === 'up') ? 'v' : 'h';
    else if (panes.length >= 3) layout = '2x2';

    return {
      ...t,
      panes,
      layout,
      splitTree: newTree,
      activePaneId: newPane.id,
    };
  });
};

/** 탭을 다른 탭의 pane 위로 떨군다. center=점유면 세션 교환·비었으면 채움, 방향=분할 후 채움. */
export const dropTabToSplitPaneOp = (tabs, { sourceTabId, targetTabId, targetPaneId, dir, hosts, computePaneTmuxSession }) => {
  const prev = tabs;
  const currentHosts = hosts;
  const srcTab = prev.find((t) => t.id === sourceTabId);
  const destTab = prev.find((t) => t.id === targetTabId);
  if (!srcTab || !destTab) return prev;

  const srcActivePanes = (srcTab.panes || []).filter((p) => p.sessionId || p.hostId);
  if (srcActivePanes.length === 0) return prev.filter((t) => t.id !== sourceTabId);

  // Preserve the effective tmux session name so the moved pane reconnects to the correct session
  // regardless of its new paneIndex in the destination tab.
  const getEffectiveSession = (sp) => {
    if (!sp.hostId) return sp.tmuxSessionName;
    const paneIdx = (srcTab.panes || []).indexOf(sp);
    const host = currentHosts.find((h) => h.id === sp.hostId);
    return computePaneTmuxSession(host, srcTab, sp, paneIdx);
  };

  // center = target pane occupied → SWAP sessions; target pane empty → fill it
  if (dir === 'center') {
    const currentPanes = [...(destTab.panes || [])];
    const targetIdx = currentPanes.findIndex((p) => p.id === targetPaneId);
    const targetOccupant = targetIdx >= 0 ? currentPanes[targetIdx] : null;
    const isOccupied = !!(targetOccupant?.sessionId || targetOccupant?.hostId);

    if (isOccupied) {
      // Swap: source's first active pane ↔ the specific target pane
      const sp = srcActivePanes[0];
      const dispHostId = targetOccupant.hostId;
      const dispHost = dispHostId ? currentHosts.find((h) => h.id === dispHostId) : null;
      const dispSession = targetOccupant.tmuxSessionName ||
        (dispHostId ? computePaneTmuxSession(dispHost, destTab, targetOccupant, targetIdx) : null);

      const newDestPanes = currentPanes.map((p) =>
        p.id === targetPaneId
          ? { ...sp, id: p.id, tmuxSessionName: getEffectiveSession(sp) }
          : p,
      );
      const newSrcPanes = (srcTab.panes || []).map((p) =>
        p.id === sp.id
          ? { ...targetOccupant, id: p.id, tmuxSessionName: dispSession }
          : p,
      );

      const makeLayout = (panes, base) => {
        const n = panes.length;
        if (n === 1) return 'single';
        if (n === 2) return base === 'v' ? 'v' : 'h';
        return '2x2';
      };
      const dLayout = makeLayout(newDestPanes, destTab.layout || 'single');
      const sLayout = makeLayout(newSrcPanes, srcTab.layout || 'single');

      return prev.map((t) => {
        if (t.id === targetTabId) return { ...t, panes: newDestPanes, layout: dLayout, splitTree: treeFromLegacyLayout(newDestPanes, dLayout) };
        if (t.id === sourceTabId) return { ...t, panes: newSrcPanes, layout: sLayout, splitTree: treeFromLegacyLayout(newSrcPanes, sLayout) };
        return t;
      });
    }

    // Target pane is empty → fill it (and any other empty slots) with source panes
    const emptyIndices = [];
    currentPanes.forEach((p, i) => { if (!p.sessionId && !p.hostId) emptyIndices.push(i); });

    let srcIdx = 0;
    const filledPanes = currentPanes.map((p, i) => {
      if (emptyIndices.includes(i) && srcIdx < srcActivePanes.length) {
        const sp = srcActivePanes[srcIdx++];
        return { ...sp, id: p.id, tmuxSessionName: getEffectiveSession(sp) };
      }
      return p;
    });

    const movedCount = srcIdx;
    const movedSrcIds = new Set(srcActivePanes.slice(0, movedCount).map((p) => p.id));
    const srcRemaining = (srcTab.panes || []).filter((p) => !movedSrcIds.has(p.id) && (p.sessionId || p.hostId));

    const total = filledPanes.length;
    let layout = destTab.layout || 'single';
    if (total === 1) layout = 'single';
    else if (total === 2) layout = (layout === 'v' ? 'v' : 'h');
    else layout = '2x2';
    const splitTree = treeFromLegacyLayout(filledPanes, layout);

    return prev.map((t) => {
      if (t.id === targetTabId) return { ...t, panes: filledPanes, layout, splitTree };
      if (t.id === sourceTabId) {
        if (srcRemaining.length === 0) return null;
        const nTotal = srcRemaining.length;
        let nLayout = t.layout || 'single';
        if (nTotal === 1) nLayout = 'single';
        else if (nTotal === 2) nLayout = (nLayout === 'v' ? 'v' : 'h');
        else nLayout = '2x2';
        return { ...t, panes: srcRemaining, layout: nLayout, splitTree: treeFromLegacyLayout(srcRemaining, nLayout), activePaneId: srcRemaining[0].id };
      }
      return t;
    }).filter(Boolean);
  }

  // directional drop: split the target pane, then fill the new empty pane with source tab's active panes
  const effectiveDir = dir === 'top' ? 'up' : dir === 'bottom' ? 'down' : dir;
  const newPane = makePane({});
  const currentPanes = [...(destTab.panes || []), newPane];
  const currentTree = ensureTree(destTab.panes || [], destTab.splitTree) || makeLeaf(targetPaneId);
  const { tree: newTree } = splitLeaf(currentTree, targetPaneId, effectiveDir, newPane.id);

  let layout = destTab.layout || 'single';
  if (currentPanes.length === 2) layout = (effectiveDir === 'down' || effectiveDir === 'up') ? 'v' : 'h';
  else if (currentPanes.length >= 3) layout = '2x2';

  // Fill newly created empty pane (and any other empty panes) with source panes
  const emptyIndices = [];
  currentPanes.forEach((p, i) => { if (!p.sessionId && !p.hostId) emptyIndices.push(i); });
  // Prioritize the newly created pane index
  const newPaneIdx = currentPanes.findIndex((p) => p.id === newPane.id);
  const orderedEmpty = [newPaneIdx, ...emptyIndices.filter((i) => i !== newPaneIdx)];

  let srcIdx = 0;
  const filledPanes = currentPanes.map((p, i) => {
    if (orderedEmpty.includes(i) && srcIdx < srcActivePanes.length) {
      const sp = srcActivePanes[srcIdx++];
      return { ...sp, id: p.id, tmuxSessionName: getEffectiveSession(sp) };
    }
    return p;
  });

  const movedCount = srcIdx;
  const movedSrcIds = new Set(srcActivePanes.slice(0, movedCount).map((p) => p.id));
  const srcRemaining = (srcTab.panes || []).filter((p) => !movedSrcIds.has(p.id) && (p.sessionId || p.hostId));

  return prev.map((t) => {
    if (t.id === targetTabId) return { ...t, panes: filledPanes, layout, splitTree: newTree, activePaneId: newPane.id };
    if (t.id === sourceTabId) {
      if (srcRemaining.length === 0) return null;
      const nTotal = srcRemaining.length;
      let nLayout = t.layout || 'single';
      if (nTotal === 1) nLayout = 'single';
      else if (nTotal === 2) nLayout = (nLayout === 'v' ? 'v' : 'h');
      else nLayout = '2x2';
      return { ...t, panes: srcRemaining, layout: nLayout, splitTree: treeFromLegacyLayout(srcRemaining, nLayout), activePaneId: srcRemaining[0].id };
    }
    return t;
  }).filter(Boolean);
};

/** 빈 pane 을 채운다. target 이 {type:'tab'} 이면 그 탭 전체를 흡수(병합)한다. */
export const activatePaneOp = (tabs, { tabId, paneId, target = null, hosts, settings, computePaneTmuxSession }) => {
  const prev = tabs;
  // 병합인 경우 원본 탭의 pane 들을 빈 슬롯에 채워넣는 로직을 한 번에 처리.
  if (target?.type === 'tab' && target.sourceTabId) {
    const src = prev.find((tt) => tt.id === target.sourceTabId);
    if (!src) return prev;
    const srcActivePanes = (src.panes || []).filter((p) => p.sessionId || p.hostId);
    if (srcActivePanes.length === 0) {
      return prev.filter((t) => t.id !== target.sourceTabId);
    }

    // Preserve effective tmux session name so moved pane reconnects to the correct session
    const getEffectiveSession = (sp) => {
      if (!sp.hostId) return sp.tmuxSessionName;
      const paneIdx = (src.panes || []).indexOf(sp);
      const host = hosts.find((h) => h.id === sp.hostId);
      return computePaneTmuxSession(host, src, sp, paneIdx);
    };

    const destTab = prev.find((t) => t.id === tabId);
    const currentPanes = [...(destTab?.panes || [])];

    const emptyIndices = [];
    currentPanes.forEach((p, i) => {
      if (!p.sessionId && !p.hostId) emptyIndices.push(i);
    });

    let srcIdx = 0;
    const filledPanes = currentPanes.map((p, i) => {
      if (emptyIndices.includes(i) && srcIdx < srcActivePanes.length) {
        const sp = srcActivePanes[srcIdx++];
        return { ...sp, id: p.id, tmuxSessionName: getEffectiveSession(sp) };
      }
      return p;
    });

    const overflowSrcIds = new Set(srcActivePanes.slice(srcIdx).map((p) => p.id));
    const movedSrcIds = new Set(srcActivePanes.slice(0, srcIdx).map((p) => p.id));

    const srcRemaining = (src.panes || []).filter((p) => !movedSrcIds.has(p.id));
    const srcStillActive = srcRemaining.some((p) => p.sessionId || p.hostId);

    let result = prev.map((t) => {
      if (t.id === tabId) {
        const allP = filledPanes;
        const total = allP.length;
        let layout = t.layout || 'single';
        if (total === 1) layout = 'single';
        else if (total === 2) layout = (layout === 'v' ? 'v' : 'h');
        else layout = '2x2';
        // Rebuild splitTree from panes — simplest correct approach
        const splitTree = treeFromLegacyLayout(allP, layout);
        return { ...t, panes: allP, layout, splitTree };
      }
      if (t.id === target.sourceTabId) {
        const realRemaining = srcRemaining.filter((p) => p.sessionId || p.hostId);
        if (realRemaining.length === 0) return null;
        const nTotal = realRemaining.length;
        let nLayout = t.layout || 'single';
        if (nTotal === 1) nLayout = 'single';
        else if (nTotal === 2) nLayout = (nLayout === 'v' ? 'v' : 'h');
        else nLayout = '2x2';
        const nSplitTree = treeFromLegacyLayout(realRemaining, nLayout);
        return { ...t, panes: realRemaining, layout: nLayout, splitTree: nSplitTree, activePaneId: realRemaining[0].id };
      }
      return t;
    }).filter(Boolean);
    return result;
  }

  // 병합이 아닌 단순 활성화 케이스
  return prev.map((t) => {
    if (t.id !== tabId) return t;
    const panes = (t.panes || []).map((p) => {
      if (p.id !== paneId) return p;
      if (p.sessionId || p.hostId) return p;
      // target.cwd 가 있으면 pane.cwd 에 저장 → Terminal 이 그 경로로 SSH/셸 시작
      // '' (workspace root) 도 유효한 cwd 이므로 null/undefined 가 아닌 이상 보존.
      const cwdPatch = target?.cwd != null ? { cwd: target.cwd } : {};
      // 경로와 함께 고른 "무엇으로 열까"(utils/launchOptions). 안 고르면 빈 객체다.
      const launchPatch = target?.launch || {};
      if (target?.type === 'host' && target.hostId) {
        // 호스트 프로필 테마가 있으면 새 pane 생성 시점에 구체 테마로 해석.
        const h = hosts.find((hh) => hh.id === target.hostId);
        const resolvedTheme = resolveProfileTheme(h?.theme, usedThemeIdsFromTabs(prev));
        const themePatch = resolvedTheme ? { themeOverride: resolvedTheme } : {};
        const tmuxPatch = {
          tmuxSessionName: target.tmuxSessionName || makeFreshHostTmuxSessionName(h),
        };
        return { ...p, hostId: target.hostId, sessionId: undefined, ...tmuxPatch, ...cwdPatch, ...themePatch, ...launchPatch };
      }
      // VNC 원격 데스크톱 — 터미널 세션이 아닌 noVNC RFB 연결 pane. host/display 만 설정하고
      // sessionId/tmuxSessionName 은 비운다. 위 empty-pane guard(p.sessionId || p.hostId) 가
      // 이미 점유된 pane 을 통과시키지 않으므로 빈 pane 에만 채워진다.
      if (target?.type === 'vnc' && target.hostId) {
        return {
          ...p,
          mode: 'vnc',
          hostId: target.hostId,
          display: target.display,
          sessionId: undefined,
          tmuxSessionName: undefined,
        };
      }
      if (target?.type === 'local') {
        const resolvedTheme = resolveProfileTheme(settings.localTheme, usedThemeIdsFromTabs(prev));
        const themePatch = resolvedTheme ? { themeOverride: resolvedTheme } : {};
        return { ...p, sessionId: generateUUID(), hostId: undefined, tmuxSessionName: undefined, ...cwdPatch, ...themePatch, ...launchPatch };
      }
      if (t.type === 'host') {
        const h = hosts.find((hh) => hh.id === t.hostId);
        return { ...p, hostId: t.hostId, tmuxSessionName: makeFreshHostTmuxSessionName(h), ...cwdPatch };
      }
      return { ...p, sessionId: generateUUID(), tmuxSessionName: undefined, ...cwdPatch };
    });
    return { ...t, panes, activePaneId: paneId };
  });
};

/** 같은 탭 안에서 두 pane 의 자리를 맞바꾼다. */
export const reorderPaneOp = (tabs, { tabId, fromPaneId, toPaneId }) => {
  const prev = tabs;
  if (!fromPaneId || !toPaneId || fromPaneId === toPaneId) return prev;   // 변화 없음 — 같은 참조를 돌려줘 리렌더를 막는다
  return prev.map((tt) => {
    if (tt.id !== tabId) return tt;
    const panes = tt.panes || [];
    const fromIdx = panes.findIndex((p) => p.id === fromPaneId);
    const toIdx = panes.findIndex((p) => p.id === toPaneId);
    if (fromIdx < 0 || toIdx < 0) return tt;
    const next = [...panes];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // Swap leaf positions in the split tree so the visual layout reflects the reorder
    const nextSplitTree = tt.splitTree
      ? swapLeaves(tt.splitTree, fromPaneId, toPaneId)
      : null;
    return { ...tt, panes: next, ...(nextSplitTree ? { splitTree: nextSplitTree } : {}) };
  });
};

/** 같은 탭 안에서 pane 을 다른 pane 위로 떨궈 재배치한다. */
export const dropPaneToSplitOp = (tabs, { tabId, srcPaneId, destPaneId, dir }) => {
  const prev = tabs;
  if (!srcPaneId || !destPaneId || srcPaneId === destPaneId) return prev;   // 변화 없음 — 같은 참조를 돌려줘 리렌더를 막는다
  return prev.map((tt) => {
    if (tt.id !== tabId) return tt;
    const panes = tt.panes || [];
    if (!panes.find((p) => p.id === srcPaneId) || !panes.find((p) => p.id === destPaneId)) return tt;
    const effectiveDir = dir === 'top' ? 'up' : dir === 'bottom' ? 'down' : dir;
    const currentTree = ensureTree(panes, tt.splitTree);
    const treeWithoutSrc = removeLeaf(currentTree, srcPaneId);
    const { tree: finalTree } = splitLeaf(
      treeWithoutSrc || makeLeaf(destPaneId),
      destPaneId,
      effectiveDir,
      srcPaneId,
      true, // forceNested: drag-drop always nests the pair within the dest's space
    );
    return { ...tt, splitTree: finalTree, activePaneId: srcPaneId };
  });
};

/**
 * 분할 탭에서 pane 하나를 제거한다(멀티 pane 전용 — 단일 pane 은 탭 닫기로 위임된다).
 *
 * 탭 레벨 sessionId 의 주인 pane 을 닫으면 남은 로컬 pane 으로 승계시킨다. 안 그러면
 * 죽은 세션을 가리키는 탭을 서버 sanitize 가 통째로 지워 분할이 단일탭으로 풀린다.
 */
export const removePaneOp = (tabs, { tabId, paneId }) => tabs.map((t) => {
  if (t.id !== tabId) return t;
  const panes = t.panes || [];
  if (panes.length === 0) return t;
  const pane = panes.find((p) => p.id === paneId);
  const remaining = panes.filter((p) => p.id !== paneId);
  if (!pane || remaining.length === 0) return t;

  const currentTree = ensureTree(panes, t.splitTree);
  const finalTree = ensureTree(remaining, removeLeaf(currentTree, paneId));
  const layout = remaining.length === 1
    ? 'single'
    : (remaining.length === 2 ? (t.layout === 'v' ? 'v' : 'h') : '2x2');
  const newActiveId = t.activePaneId === paneId
    ? (remaining.find((p) => p.sessionId || p.hostId) || remaining[0])?.id
    : t.activePaneId;
  const nextSessionId = (!pane.hostId && pane.sessionId && t.sessionId === pane.sessionId)
    ? (remaining.find((p) => p.sessionId && !p.hostId)?.sessionId ?? t.sessionId)
    : t.sessionId;
  return { ...t, sessionId: nextSessionId, panes: remaining, layout, splitTree: finalTree, activePaneId: newActiveId };
});

/**
 * pane 을 닫으려 할 때 무엇을 해야 하는가 — 순수 판정.
 *
 * 'delegateToTab' 단일 pane 이라 탭 자체를 닫아야 한다(빈 picker 든 활성 세션이든 동일).
 * 'immediate'     멀티 중 빈 pane — 물어볼 것 없이 제거.
 * 'confirm'       세션이 살아있는 pane — 확인을 받아야 한다(닫기 = 세션 종료 모델).
 */
export const planPaneClose = (tab, paneId, hosts = []) => {
  const panes = tab?.panes || [];
  const pane = panes.find((p) => p.id === paneId);
  if (!tab || !pane) return { action: 'none' };
  if (panes.length <= 1) return { action: 'delegateToTab' };
  if (!pane.sessionId && !pane.hostId) return { action: 'immediate' };
  const host = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
  return {
    action: 'confirm',
    paneIndex: panes.findIndex((p) => p.id === paneId),
    // 로컬은 항상 tmux 위에서 돈다. 원격은 호스트 설정에 달렸다.
    willPersist: !pane.hostId || !!host?.use_remote_tmux,
  };
};

/**
 * 분할 pane 하나를 새 탭으로 떼어낸다. `{ tabs, newTabId }` 또는 뗄 게 없으면 null.
 *
 * 새 탭의 이름/아이콘/색은 **pane 의 실제 호스트**를 따른다. 원본 탭 것을 복사하면
 * pane 이 다른 호스트로 옮겨진 뒤 분리할 때 이전 탭 호스트명이 따라온다.
 */
export const extractPaneToTabOp = (tabs, { tabId, paneId, hosts = [], now = 0 }) => {
  const src = tabs.find((tt) => tt.id === tabId);
  const pane = src?.panes?.find((p) => p.id === paneId);
  if (!src || !pane || (!pane.sessionId && !pane.hostId)) return null;

  // 원본 pane 을 통째로 복사 — mode/display/cwd 등 모든 필드가 누락 없이 따라온다.
  // id 만 새로 발급 (새 탭의 새 pane 이므로).
  const newPane = { ...pane, id: generateUUID() };
  const newTabId = pane.hostId
    ? `host:${pane.hostId}:${now}:${newPane.id.slice(0, 6)}`
    : `local:${pane.sessionId}:${now}:${newPane.id.slice(0, 6)}`;

  const paneHost = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
  const remaining = (src.panes || []).filter((p) => p.id !== paneId);
  const layout = remaining.length === 1
    ? 'single'
    : (remaining.length === 2 ? (src.layout === 'v' ? 'v' : 'h') : '2x2');
  const finalSrcTree = ensureTree(remaining, removeLeaf(ensureTree(src.panes, src.splitTree), paneId));

  const trimmedSrc = {
    ...src, panes: remaining, layout, splitTree: finalSrcTree,
    activePaneId: remaining[0]?.id || null,
  };
  const newTab = {
    id: newTabId,
    type: pane.hostId ? 'host' : 'local',
    name: paneHost?.name || (pane.hostId ? src.name : (src.type === 'local' ? src.name : 'Local')),
    cwd: src.cwd ?? null,
    icon: paneHost?.icon ?? (pane.hostId ? null : (src.icon || null)),
    color_index: paneHost?.color_index ?? (pane.hostId ? 0 : (src.color_index ?? 0)),
    panes: [newPane],
    layout: 'single',
    splitTree: makeLeaf(newPane.id),
    activePaneId: newPane.id,
    ...(pane.hostId ? { hostId: pane.hostId } : null),
    ...(pane.hostId && src.hostId === pane.hostId && src.tmuxSuffix ? { tmuxSuffix: src.tmuxSuffix } : null),
    ...(!pane.hostId && pane.sessionId ? { sessionId: pane.sessionId } : null),
  };
  const next = tabs.map((t) => (t.id === tabId ? trimmedSrc : t));
  const idx = next.findIndex((t) => t.id === tabId);
  return { tabs: [...next.slice(0, idx + 1), newTab, ...next.slice(idx + 1)], newTabId };
};
