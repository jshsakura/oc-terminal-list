import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPage, COMMAND_HISTORY_EVENT } from '../utils/commandHistory';

/**
 * 터미널별 명령 히스토리를 서버에서 가져와 페이징한다.
 *
 * 사용 흐름:
 *  - mount / terminalKey 변경 / 'iterm:commandHistory:updated' 이벤트 → 첫 페이지 새로 로드 (이전 페이지 폐기).
 *  - 사용자가 리스트 끝에 닿으면 loadMore() 호출 → 다음 페이지 append.
 *  - removeCommand / clearCommandsFor 같은 mutate 후에도 이벤트로 자동 재로드.
 *
 * 반환:
 *  - items: 최신 → 과거 순으로 누적된 모든 페이지 아이템.
 *  - hasMore: 다음 페이지가 더 있는지 (마지막 fetch 결과 기준).
 *  - loading: 첫 페이지 진행 중.
 *  - loadingMore: 추가 페이지 진행 중.
 *  - loadMore(): 다음 페이지 fetch.
 *  - reload(): 처음부터 다시.
 */
const useCommandHistory = (terminalKey) => {
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // unmount 후 setState 가드 + 진행 중 fetch 의 stale 응답 무시.
  const reqIdRef = useRef(0);
  const inFlightRef = useRef(false);

  const reload = useCallback(async () => {
    if (!terminalKey) { setItems([]); setHasMore(false); return; }
    const reqId = ++reqIdRef.current;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const { items: page, hasMore: more } = await fetchPage(terminalKey, { before: null });
      if (reqId !== reqIdRef.current) return; // 더 새 fetch 가 시작됨
      setItems(page);
      setHasMore(more);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  }, [terminalKey]);

  const loadMore = useCallback(async () => {
    if (!terminalKey || !hasMore || loadingMore || loading) return;
    const cursor = items.length > 0 ? items[items.length - 1].ts : null;
    if (cursor == null) return;
    const reqId = reqIdRef.current; // 첫 페이지 reqId 와 비교 — 그 사이 reload 가 일어났으면 결과 폐기.
    setLoadingMore(true);
    try {
      const { items: page, hasMore: more } = await fetchPage(terminalKey, { before: cursor });
      if (reqId !== reqIdRef.current) return;
      // 중복 방지 (이론상 cursor 페이징이라 안 겹치지만 방어).
      setItems((prev) => {
        const seen = new Set(prev.map((e) => `${e.ts}|${e.text}`));
        const fresh = page.filter((e) => !seen.has(`${e.ts}|${e.text}`));
        return [...prev, ...fresh];
      });
      setHasMore(more);
    } finally {
      if (reqId === reqIdRef.current) setLoadingMore(false);
    }
  }, [terminalKey, items, hasMore, loadingMore, loading]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!terminalKey) return undefined;
    const onUpdate = (e) => {
      // 다른 터미널의 변경은 무시 (성능). detail 없으면 일단 갱신.
      const key = e?.detail?.terminalKey;
      if (key && key !== terminalKey) return;
      reload();
    };
    window.addEventListener(COMMAND_HISTORY_EVENT, onUpdate);
    return () => window.removeEventListener(COMMAND_HISTORY_EVENT, onUpdate);
  }, [terminalKey, reload]);

  return { items, hasMore, loading, loadingMore, loadMore, reload };
};

export default useCommandHistory;
