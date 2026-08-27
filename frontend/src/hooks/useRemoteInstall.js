import { useCallback, useState } from 'react';
import apiFetch from '../utils/apiFetch';
import { authHeaders } from '../utils/auth';

/**
 * 호스트 카드에서 **바로** 리모트를 설치한다.
 *
 * ⚠️ 설치는 SSH 로 파일을 얹고 서비스를 띄우는 일이라 수십 초까지 걸린다. 그동안 아무
 * 표시가 없으면 사용자는 다시 누르고, 그러면 같은 설치가 겹쳐 돈다 — 진행 중인 호스트를
 * 붙잡아 두 번째 누름을 막는다.
 *
 * 성공하면 붙는 데 몇 초 더 걸린다(리모트가 우리 쪽으로 다이얼아웃한다). 그래서 바로
 * 목록을 새로 읽지 않고 잠깐 기다렸다 읽는다 — 안 그러면 "설치했는데 그대로" 로 보인다.
 */
const SETTLE_MS = 4000;

const useRemoteInstall = (onDone) => {
  const [busyHostId, setBusyHostId] = useState(null);
  const [failedHostId, setFailedHostId] = useState(null);

  const install = useCallback(async (hostId) => {
    if (!hostId || busyHostId) return;
    setBusyHostId(hostId);
    setFailedHostId(null);
    try {
      const res = await apiFetch(`/api/hosts/${hostId}/remote-install`, {
        method: 'POST', headers: authHeaders(), timeoutMs: 90000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await new Promise((done) => { setTimeout(done, SETTLE_MS); });
      onDone?.();
    } catch {
      // 실패는 카드에 남긴다 — 조용히 되돌아가면 눌렀는지도 모른다.
      setFailedHostId(hostId);
    } finally {
      setBusyHostId(null);
    }
  }, [busyHostId, onDone]);

  return { install, busyHostId, failedHostId };
};

export default useRemoteInstall;
