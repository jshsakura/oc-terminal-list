import { useEffect, useMemo, useState } from 'react';

// 명령을 보낼 pane 선택 상태. 비어 있으면 "활성 pane" 으로 폴백한다 —
// 즉 아무것도 안 고른 상태가 곧 기본값(활성 pane 하나)이라 별도 기본 선택을 두지 않는다.
//
// 선택은 항상 새 Set 을 만들어 교체한다(제자리 mutate 금지).

// 열려있는 모든 탭의 pane 을 탭 단위로 묶는다 — 팝업에서 탭 그룹 헤더 아래로
// 그 탭의 pane 들이 나열되고, 탭을 넘나들며 체크해 그룹으로 동시에 보낼 수 있다.
// panes 배열이 tabId 기준으로 연속이라는 점에 의존한다(App 의 flatMap 이 보장).
const groupByTab = (panes) => panes.reduce((groups, p) => {
  const tabId = p.tabId ?? '_';
  const last = groups[groups.length - 1];
  if (last && last.tabId === tabId) {
    return [...groups.slice(0, -1), { ...last, items: [...last.items, p] }];
  }
  return [...groups, {
    tabId,
    tabName: p.tabName || '',
    isActiveTab: !!p.isActiveTab,
    items: [p],
  }];
}, []);

const useSendTargets = (panes, terminalKey) => {
  const [targetKeys, setTargetKeys] = useState(() => new Set());
  const [isPopupOpen, setPopupOpen] = useState(false);

  // 분할/탭전환으로 사라진 pane key 는 선택에서 제거.
  useEffect(() => {
    setTargetKeys((prev) => {
      if (!prev.size) return prev;
      const valid = new Set(panes.map((p) => p.key));
      const next = new Set([...prev].filter((k) => valid.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [panes]);

  // pane 이 1개로 줄면 고를 게 없다 — 팝업이 떠 있었다면 닫는다.
  useEffect(() => {
    if (panes.length < 2 && isPopupOpen) setPopupOpen(false);
  }, [panes.length, isPopupOpen]);

  const groups = useMemo(() => groupByTab(panes), [panes]);

  const toggleKey = (key) => setTargetKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // 탭 그룹 헤더 — 그 탭의 pane 이 전부 켜져 있으면 전부 끄고, 아니면 전부 켠다.
  const toggleGroup = (items) => setTargetKeys((prev) => {
    const keys = items.map((p) => p.key);
    const allOn = keys.every((k) => prev.has(k));
    const next = new Set(prev);
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
    return next;
  });

  const toggleAll = () => setTargetKeys((prev) => (
    prev.size === panes.length ? new Set() : new Set(panes.map((p) => p.key))
  ));

  // 실제 전송 대상. 선택이 없으면 활성 pane 하나로 폴백.
  const resolveTargets = () => (
    targetKeys.size ? [...targetKeys] : (terminalKey ? [terminalKey] : [])
  );

  return {
    targetKeys,
    groups,
    totalCount: panes.length,
    selectedCount: targetKeys.size,
    allSelected: panes.length > 0 && targetKeys.size === panes.length,
    isPopupOpen,
    openPopup: () => setPopupOpen(true),
    closePopup: () => setPopupOpen(false),
    togglePopup: () => setPopupOpen((v) => !v),
    toggleKey,
    toggleGroup,
    toggleAll,
    resolveTargets,
  };
};

export default useSendTargets;
