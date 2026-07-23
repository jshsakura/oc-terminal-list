import { useEffect, useRef } from 'react';

/**
 * 딥링크 처리 — 텔레그램 알림의 "열기" 버튼 등 외부 링크로 들어온 경우.
 *
 * `?open=<sessionId>` 로 들어오면 그 세션을 가진 탭·pane 을 찾아 활성화한다.
 *
 * 타이밍: 로그인·서버 복원이 끝나야 탭이 채워지므로, 대상 세션 ID 를 ref 에 담아두고
 * tabs 가 바뀔 때마다 재시도한다. 찾으면(또는 복원이 끝났는데도 못 찾으면) URL 에서
 * `open` 파라미터를 지운다 — 새로고침 때 또 점프하거나, 닫힌 세션을 계속 좇지 않도록.
 *
 * @param {object[]} tabs 현재 탭 목록
 * @param {(id: string) => void} setActiveTabId 활성 탭 지정
 * @param {(updater: Function) => void} setTabs 탭 갱신(활성 pane 지정용)
 * @param {boolean} ready 복원이 끝났는지 — 그 전에는 "못 찾음"을 포기 신호로 쓰지 않는다
 */
export default function useDeepLinkOpen({ tabs, setActiveTabId, setTabs, ready }) {
  const targetRef = useRef(undefined);

  // 최초 1회만 URL 을 읽는다(이후 파라미터를 지워도 대상은 ref 에 남는다).
  if (targetRef.current === undefined) {
    targetRef.current = readOpenParam();
  }

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const match = findPaneBySession(tabs, target);
    if (match) {
      const { tab, paneId } = match;
      setActiveTabId(tab.id);
      if (paneId && paneId !== tab.activePaneId) {
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, activePaneId: paneId } : t)));
      }
      targetRef.current = null;
      clearOpenParam();
    } else if (ready) {
      // 복원이 끝났는데도 세션을 못 찾음 — 이미 닫힌 터미널. 파라미터만 지우고 포기.
      targetRef.current = null;
      clearOpenParam();
    }
  }, [tabs, ready, setActiveTabId, setTabs]);
}

function readOpenParam() {
  try {
    return new URLSearchParams(window.location.search).get('open') || null;
  } catch {
    return null;
  }
}

function clearOpenParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    /* noop */
  }
}

/** 세션 ID 로 탭과 그 안의 pane 을 찾는다. 로컬은 pane.sessionId, 원격은 pane.id 로 등록된다. */
function findPaneBySession(tabs, sessionId) {
  for (const tab of tabs || []) {
    const panes = tab.panes || [];
    const pane = panes.find((p) => p.sessionId === sessionId || p.id === sessionId);
    if (pane) return { tab, paneId: pane.id };
    // panes 가 없는 옛 단일탭 형태 대비.
    if (tab.sessionId === sessionId || tab.id === sessionId) return { tab, paneId: null };
  }
  return null;
}
