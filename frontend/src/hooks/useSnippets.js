import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * 스니펫 목록 — **앱 전체가 하나를 공유한다.**
 *
 * PaneGrid 는 탭마다 하나씩 마운트되고 모든 탭이 항상 마운트 상태다. 인스턴스마다
 * fetch 를 하던 시절엔 부팅 1초 안에 GET /api/snippets 가 탭 수만큼(실측 14회) 나갔다 —
 * 전부 같은 전역 목록을 받으려고. 스토어를 모듈 레벨로 올려 요청 1회로 만든다.
 */

const STALE_MS = 60_000;

const state = { list: [], ts: 0 };
let inflight = null;
const subscribers = new Set();

const notify = () => {
  subscribers.forEach((fn) => {
    try { fn(state.list); } catch { /* 구독자 하나가 나머지를 막지 않게 */ }
  });
};

const setList = (next) => {
  state.list = next;
  state.ts = Date.now();
  notify();
};

const load = (force = false) => {
  if (inflight) return inflight;
  if (!force && state.ts && Date.now() - state.ts < STALE_MS) return Promise.resolve(state.list);
  inflight = (async () => {
    try {
      const res = await fetch('/api/snippets', { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setList(await res.json());
    } catch { /* 무시 — 이전 목록 유지. ts 를 안 찍으므로 다음 마운트가 다시 시도한다 */ }
    finally { inflight = null; }
    return state.list;
  })();
  return inflight;
};

/** 테스트용 — 모듈 캐시 초기화. */
export const _resetSnippetsStore = () => {
  state.list = [];
  state.ts = 0;
  inflight = null;
  subscribers.clear();
};

const useSnippets = (enabled = false) => {
  const [snippets, setSnippets] = useState(state.list);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    subscribers.add(setSnippets);
    setSnippets(state.list);
    const needsFetch = !state.ts || Date.now() - state.ts >= STALE_MS;
    if (needsFetch) {
      setLoading(true);
      load().finally(() => setLoading(false));
    }
    return () => { subscribers.delete(setSnippets); };
  }, [enabled]);

  const refresh = useCallback(() => load(true), []);

  const create = useCallback(async ({ name, command, tags = '', sort_index = 0 }) => {
    const res = await fetch('/api/snippets', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, command, tags, sort_index }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created = await res.json();
    setList([...state.list, created]);
    return created;
  }, []);

  const update = useCallback(async (id, fields) => {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setList(state.list.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }, []);

  const remove = useCallback(async (id) => {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setList(state.list.filter((s) => s.id !== id));
  }, []);

  return { snippets, loading, refresh, create, update, remove };
};

export default useSnippets;
