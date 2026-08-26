import { useCallback, useEffect, useState } from 'react';
import apiFetch from '../utils/apiFetch';
import { authHeaders } from '../utils/auth';

/**
 * 지금 붙어 있는 리모트들 — **한 번의 요청**으로 전부.
 *
 * ⚠️ 호스트마다 상태를 물으면 그 자체로 SSH 가 행 수만큼 곱해진다(이 저장소가
 * `/api/git/status` 에서 이미 밟은 함정 — 실측에서 전체 HTTP 의 80% 였다). 아이콘이
 * 알아야 하는 것은 "붙어 있나" 하나뿐이고, 그건 서버가 SSH 없이 안다.
 *
 * 설치 여부·버전처럼 원격을 실제로 봐야 아는 것은 사용자가 패널을 열 때만 묻는다.
 */
const useConnectedRemotes = (enabled = true) => {
  const [connected, setConnected] = useState({});

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/api/remote/connected', { headers: authHeaders() });
      if (!res.ok) return;                 // 실패는 직전 값을 유지한다 — 깜빡이지 않게
      const data = await res.json();
      setConnected(data.connected || {});
    } catch {
      /* 배경 조회다. 실패해도 화면은 직전 상태로 계속 쓸 수 있다. */
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { connected, refresh };
};

export default useConnectedRemotes;
