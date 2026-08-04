import { useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * 이 배포의 로컬 머신(=백엔드가 도는 기계)이 VNC 를 쓸 수 있는가.
 *
 * 컨테이너 배포에서 local 은 컨테이너 자신이고 이미지에 VNC 가 없다 — 그래서
 * 로컬 원격 데스크톱 버튼은 "실제로 있을 때만" 그린다. 원격 호스트는 SSH 를 타야
 * 알 수 있어 매번 프로브할 수 없지만(클릭 시 조회), 로컬은 SSH 없이 한 번이면 안다.
 *
 * 프로브 결과는 **모듈 레벨에 캐시**한다. 홈(App)과 빈 pane(EmptyPane)은 둘 다 같은
 * 호스트 카드를 그리는데, 각자 따로 조회하면 한쪽만 아는 상태가 생긴다 —
 * 실제로 EmptyPane 쪽에 이 값이 아예 없어서 "PC 홈에는 아이콘이 뜨는데 폰에서
 * 빈 pane 으로 들어가면 안 뜬다" 가 됐다. 조회는 한 번, 답은 한 곳.
 */

// 진행 중이거나 완료된 프로브. 성공만 캐시한다(실패는 다음 마운트에서 재시도).
let probePromise = null;

export const probeLocalVnc = () => {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const res = await fetch('/api/hosts/local/vnc/displays', { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return !!json?.installed || (json?.displays?.length ?? 0) > 0;
    } catch {
      // 조회 실패 = 노출 안 함. 캐시도 비워 다음 기회에 다시 물어본다
      // (로그인 직후 401, 일시적 네트워크 오류에서 영구히 false 로 굳지 않게).
      probePromise = null;
      return false;
    }
  })();
  return probePromise;
};

/** 테스트/로그아웃용 — 캐시를 비워 다음 호출이 다시 조회하게 한다. */
export const resetLocalVncProbe = () => { probePromise = null; };

export default function useLocalVncAvailable(enabled = true) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    probeLocalVnc().then((ok) => { if (!cancelled) setAvailable(ok); });
    return () => { cancelled = true; };
  }, [enabled]);
  return available;
}
