import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * 터미널 사용 통계(`/api/usage/summary`).
 *
 * 타일 컴포넌트 안에 있던 것을 끌어올렸다 — **누가 로딩 중인지 홈이 알아야** 머리(기간
 * 스위치)까지 한 몸으로 스켈레톤을 그릴 수 있다. 아래에서만 알고 있으면 위는 늘 완성된 채
 * 서 있고 아래만 비어 화면이 반쯤 그려진 것처럼 보인다.
 *
 * 모듈 레벨 캐시(60초) — 홈과 빈 pane 홈이 동시에 마운트돼도 요청은 하나다. 캐시가 있으면
 * 첫 렌더부터 값이 있으므로 스켈레톤이 깜빡이지 않는다.
 *
 * @returns {{ data: object|null, loading: boolean }}
 */
const _cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

export default function useTerminalUsage(days) {
  const [data, setData] = useState(() => _cache.get(days)?.data || null);
  const [loading, setLoading] = useState(() => !_cache.get(days));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(() => {
    const cached = _cache.get(days);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/usage/summary?days=${days}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        _cache.set(days, { data: d, ts: Date.now() });
        if (alive.current) setData(d);
      })
      .catch(() => { /* 통계가 없다고 홈이 깨지면 안 된다 */ })
      .finally(() => { if (alive.current) setLoading(false); });
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return { data, loading };
}
