import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';
import { subscribeGitStatus, refreshGitStatus, peekGitStatus } from '../utils/gitStatusStore';

/**
 * Git 변경 사항 훅.
 *
 * hostId 가 제공되면 원격 호스트 API (/api/hosts/{hostId}/git/status) 를,
 * 없으면 로컬 API (/api/git/status) 를 호출.
 *
 * 폴링 자체는 **utils/gitStatusStore** 가 소유한다 — 같은 repo 를 보는 pane 이
 * 몇 개든 타이머 하나·요청 하나. 이 훅은 구독과 React 상태 변환만 한다.
 * (예전엔 인스턴스마다 setInterval 을 들어서, 안 보이는 탭의 pane 까지 각자
 *  자기 오프셋으로 폴링했다.)
 *
 * 깜빡임 방지 전략:
 * - 스토어에 캐시가 있으면 구독 즉시 그 값을 받아 빈 목록이 스치지 않는다
 * - 실패해도 직전 데이터는 유지하고 error 만 채운다
 * - 첫 로딩에만 skeleton(loading) — 이후 갱신은 조용히
 */

const useGitChanges = ({ enabled = false, intervalMs = 4000, path = '', hostId = null } = {}) => {
  const [items, setItems] = useState([]);
  const [branch, setBranch] = useState(null);
  const [repo, setRepo] = useState(null);
  const [repos, setRepos] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // refresh 는 안정된 정체성이어야 한다 — 호출부(TerminalHeader 의 패널 effect)가
  // 이걸 의존성으로 쓰므로, path 가 바뀔 때마다 새 함수를 주면 그 effect 가 덩달아 돈다.
  const targetRef = useRef({ hostId, path });
  targetRef.current = { hostId, path };

  useEffect(() => {
    if (!enabled) return undefined;
    const cached = peekGitStatus({ hostId, path });
    setLoading(!cached.ts);
    if (!cached.ts) { setItems([]); setBranch(null); setRepo(null); setRepos([]); setError(null); }

    return subscribeGitStatus({
      hostId,
      path,
      intervalMs,
      onData: ({ data, error: err }) => {
        if (data) {
          setItems(data.items || []);
          setBranch(data.branch || null);
          setRepo(data.repo || null);
          setRepos(data.repos || []);
        }
        setError(err || data?.error || null);
        setLoading(false);
      },
    });
  }, [enabled, hostId, path, intervalMs]);

  const refresh = useCallback(() => refreshGitStatus(targetRef.current), []);

  const fetchDiff = useCallback(async (filePath, staged = false) => {
    const hid = targetRef.current.hostId;
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
