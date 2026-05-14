import { useCallback, useEffect, useRef, useState } from 'react';

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

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
 */
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

  // 진행 중인 요청을 식별하기 위한 토큰 — race 시 stale 응답 폐기
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
    const myPath = pathRef.current;
    const myHostId = hostIdRef.current;
    setLoading(true);
    try {
      let url;
      if (myHostId) {
        // Remote host git — SSH経由
        url = `/api/hosts/${myHostId}/git/status${myPath ? `?path=${encodeURIComponent(myPath)}` : ''}`;
      } else {
        // Local workspace git
        url = `/api/git/status${myPath ? `?path=${encodeURIComponent(myPath)}` : ''}`;
      }
      const res = await fetch(url, { headers: authHeader() });
      // path/host 가 그 사이에 바뀌면 이 응답은 stale — 폐기
      if (myRequestId !== requestIdRef.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (myRequestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setBranch(data.branch || null);
      setRepo(data.repo || null);
      setRepos(data.repos || []);
      setError(data.error || null);
    } catch (e) {
      if (myRequestId === requestIdRef.current) setError(e.message);
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

  // path 가 바뀌면 즉시 한 번 (인터벌 다음 tick 기다리지 않게)
  useEffect(() => {
    if (enabled) refresh();
  }, [path, hostId, enabled, refresh]);

  const fetchDiff = useCallback(async (filePath, staged = false) => {
    const url = `/api/git/diff?path=${encodeURIComponent(filePath)}&staged=${staged ? 'true' : 'false'}`;
    const res = await fetch(url, { headers: authHeader() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  return { items, branch, repo, repos, error, loading, refresh, fetchDiff };
};

export default useGitChanges;
