import { useCallback, useState } from 'react';
import apiFetch from '../utils/apiFetch';
import { authHeaders } from '../utils/auth';

/**
 * 호스트 카드에서 **바로** 연결한다(리모트 + itl).
 *
 * ⚠️ 한때 `remote-install` 만 불렀다 — 카드에서 깔면 **반쪽만** 깔렸다는 뜻이다.
 * 리모트만 있으면 그 호스트의 에이전트는 `itl` 이 없어 답장도 호출도 못 한다. 호스트
 * 편집기의 버튼과 **같은 곳**(`agent-setup`)으로 간다. 설치 경로가 둘이면 어느
 * 버튼을 눌렀는지에 따라 결과가 달라지는데, 화면에는 그 차이가 보이지 않는다.
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
      const res = await apiFetch(`/api/hosts/${hostId}/agent-setup`, {
        method: 'POST', headers: authHeaders(), timeoutMs: 120000,
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
