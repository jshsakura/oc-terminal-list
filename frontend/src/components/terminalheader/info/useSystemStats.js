/**
 * 시스템 통계 폴링 훅.
 *
 * Info 탭은 트레이스가 아니라 스냅샷에 가깝다 — 탭이 열려 있는 동안만 돌고
 * 닫으면 즉시 멈춘다. 즉시 보고 싶으면 새로고침 버튼.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { authHeaders } from '../../../utils/auth';

const SYSTEM_STATS_POLL_MS = 30000;

const useSystemStats = (enabled) => {
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const fetchRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let aborted = false;
    const fetchOnce = async () => {
      setRefreshing(true);
      try {
        const res = await fetch('/api/system/stats', {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!aborted) setStats(data);
      } catch { /* 다음 tick 또는 사용자 새로고침에 다시 시도 */ }
      finally {
        if (!aborted) setRefreshing(false);
      }
    };
    fetchRef.current = fetchOnce;
    fetchOnce();
    intervalRef.current = setInterval(fetchOnce, SYSTEM_STATS_POLL_MS);
    return () => {
      aborted = true;
      fetchRef.current = null;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [enabled]);
  const refresh = useCallback(() => { fetchRef.current?.(); }, []);
  return { stats, refresh, refreshing };
};

export default useSystemStats;
