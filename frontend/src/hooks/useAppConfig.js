import { useEffect, useState } from 'react';

/**
 * 서버 측 feature flag — 부팅 직후 1회 fetch.
 *
 *  - local_disabled: true 면 "이 머신" (로컬 터미널) 비활성. 컨테이너 배포 모드용.
 *
 * 실패 시 안전한 기본값(전부 비활성 안 됨) 으로 폴백 — 호스트 설치본에서는 어차피 true 가 아님.
 */
const useAppConfig = () => {
  const [config, setConfig] = useState({ local_disabled: false, loaded: false });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setConfig({ ...data, loaded: true });
      } catch {
        if (!cancelled) setConfig({ local_disabled: false, loaded: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return config;
};

export default useAppConfig;
