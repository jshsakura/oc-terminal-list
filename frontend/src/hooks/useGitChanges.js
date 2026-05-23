import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * Git 변경 사항 폴링 훅.
 *
 * hostId 가 제공되면 원격 호스트 API (/api/hosts/{hostId}/git/status) 를,
 * 없으면 로컬 API (/api/git/status) 를 호출.
 *
 * 깜빡임 방지 전략:
 * - path 는 ref 로 추적해서 path 가 바뀌어도 setInterval 을 재생성하지 않음
 * - setItems 는 fetch 가 끝났을 때만 호출 (in-flight 중에는 이전 items 유지)
 * - in-flight path 와 응답 시점 path 가 다르면 응답 폐기 (stale 방지)
 *
 * 최적화:
 * - 모듈레벨 클라이언트 캐시(2s TTL): 같은 path 를 여러 컴포넌트가 동시 마운트해도
 *   HTTP 요청 1회만 발생 (백엔드 캐시와 이중 방어)
 * - document.visibilitychange: 탭이 백그라운드로 가면 폴링 스킵, 포커스 복귀 시 즉시 갱신
 */

// 모듈레벨 결과 캐시 — 같은 path 를 여러 인스턴스가 동시 마운트할 때 burst 방지
const _resultCache = new Map(); // cacheKey -> { data, ts }
const RESULT_CACHE_TTL_MS = 2000;

const useGitChanges = ({ enabled = false, intervalMs = 4000, path = '', hostId = null } = {}) => {
  const [items, setItems] = useState([]);
  const [branch, setBranch] = useState(null);
  const [repo, setRepo] = useState(null);
  const [repos, setRepos] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);
  const hostIdRef = useRef(hostId);
  useEffect(() => { hostIdRef.current = hostId; }, [hostId]);

  // 페이지 가시성 — 숨김 중엔 fetch 스킵
  const isVisibleRef = useRef(!document.hidden);

  // 진행 중인 요청을 식별하기 위한 토큰 — race 시 stale 응답 폐기
  const requestIdRef = useRef(0);

  const initializedRef = useRef(false);

  const refresh = useCallback(async () => {
    // 백그라운드 탭이면 스킵 — 포커스 복귀 시 visibilitychange 핸들러가 즉시 호출
    if (!isVisibleRef.current) return;

    const myRequestId = ++requestIdRef.current;
    const myPath = pathRef.current;
    const myHostId = hostIdRef.current;

    // 최초 로딩 시에만 skeleton 표시 — 이후 백그라운드 갱신은 조용히
    if (!initializedRef.current) setLoading(true);

    // 모듈레벨 캐시 확인 — 동일 path 를 짧은 시간 내 중복 요청하는 burst 차단
    const cacheKey = myHostId ? `h:${myHostId}:${myPath}` : `l:${myPath}`;
    const cached = _resultCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < RESULT_CACHE_TTL_MS) {
      if (myRequestId !== requestIdRef.current) return;
      const data = cached.data;
      setItems(data.items || []);
      setBranch(data.branch || null);
      setRepo(data.repo || null);
      setRepos(data.repos || []);
      setError(data.error || null);
      initializedRef.current = true;
      setLoading(false);
      return;
    }

    try {
      let url;
      if (myHostId) {
        url = `/api/hosts/${myHostId}/git/status${myPath ? `?path=${encodeURIComponent(myPath)}` : ''}`;
      } else {
        url = `/api/git/status${myPath ? `?path=${encodeURIComponent(myPath)}` : ''}`;
      }
      const res = await fetch(url, { headers: authHeaders() });
      // path/host 가 그 사이에 바뀌면 이 응답은 stale — 폐기
      if (myRequestId !== requestIdRef.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (myRequestId !== requestIdRef.current) return;
      _resultCache.set(cacheKey, { data, ts: Date.now() });
      setItems(data.items || []);
      setBranch(data.branch || null);
      setRepo(data.repo || null);
      setRepos(data.repos || []);
      setError(data.error || null);
      initializedRef.current = true;
    } catch (e) {
      if (myRequestId === requestIdRef.current) { setError(e.message); initializedRef.current = true; }
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }, []);   // ← stable

  // 인터벌은 enabled / intervalMs 변할 때만 재생성. path 변화엔 영향 없음.
  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, refresh]);

  // path/host 바뀌면 초기화 후 즉시 한 번
  useEffect(() => {
    if (!enabled) return;
    initializedRef.current = false;
    setItems([]);
    refresh();
  }, [path, hostId, enabled, refresh]);

  // 탭 포커스 복귀 시 즉시 갱신, 백그라운드 진입 시 스킵 플래그 설정
  useEffect(() => {
    if (!enabled) return undefined;
    const handleVisibility = () => {
      isVisibleRef.current = !document.hidden;
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, refresh]);

  const fetchDiff = useCallback(async (filePath, staged = false) => {
    const hid = hostIdRef.current;
    const url = hid
      ? `/api/hosts/${hid}/git/diff?path=${encodeURIComponent(filePath)}&staged=${staged ? 'true' : 'false'}`
      : `/api/git/diff?path=${encodeURIComponent(filePath)}&staged=${staged ? 'true' : 'false'}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  return { items, branch, repo, repos, error, loading, refresh, fetchDiff };
};

export default useGitChanges;
