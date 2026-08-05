import { useCallback, useEffect, useState } from 'react';
import { Toggle } from './SettingsFields';
import { styles } from './settingsStyles';
import { authHeaders } from '../../utils/auth';

/**
 * LLM 사용량 연동 — 에이전트 토큰·비용을 홈 대시보드에 띄운다.
 *
 * **스위치 하나가 전부다.** 주소도 API 키도 없다 — 수집기를 앱이 직접 들고 다니며
 * 이 서버에서는 그냥 실행하고, 원격 호스트에는 SSH 로 밀어 넣어 한 번 돌린다.
 * 호스트에 설치할 것도, 상주시킬 것도 없다.
 *
 * **꺼져 있으면 아무 일도 일어나지 않는다.** 대시보드는 그 구획을 아예 안 그리고,
 * 백엔드는 로그 파일도 안 읽고 SSH 도 걸지 않는다.
 *
 * 조회는 **하루 한 번**이다. 여기서 켠 직후에도 대시보드의 새로고침을 누르면 즉시
 * 다시 읽는다.
 */
const LlmWatcherSection = ({ t }) => {
  const [enabled, setEnabled] = useState(false);
  const [fromEnv, setFromEnv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const apply = useCallback((d) => {
    if (!d) return;
    setEnabled(!!d.enabled);
    setFromEnv(!!d.enabled_from_env);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm-usage/config', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) apply(d); })
      .catch(() => { /* 설정 화면이 못 뜰 이유는 아니다 */ });
    return () => { cancelled = true; };
  }, [apply]);

  const toggle = useCallback(async (next) => {
    setEnabled(next);          // 낙관적 — 스위치는 즉시 반응해야 한다
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/llm-usage/config', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice({ ok: false, text: data?.detail || (t?.('saveFailed') || 'Save failed') });
        setEnabled(!next);     // 서버가 거절했으면 되돌린다
        return;
      }
      apply(data);
    } catch (e) {
      setNotice({ ok: false, text: e?.message || (t?.('saveFailed') || 'Save failed') });
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  }, [apply, t]);

  return (
    <>
      <Toggle
        label={t?.('llmWatcherEnable') || 'LLM usage dashboard'}
        hint={t?.('llmWatcherEnableHint')
          || 'Reads agent logs here and on your hosts over SSH — nothing is installed on them. Off means nothing is read at all.'}
        checked={enabled}
        onChange={fromEnv || busy ? () => {} : toggle}
      />

      {fromEnv && (
        <div style={styles.hint}>
          {t?.('setByEnv') || 'Set by environment variable — this field is ignored.'}
        </div>
      )}

      {notice && (
        <div style={{ ...styles.hint, color: notice.ok ? undefined : 'var(--ui-danger, #e5484d)' }}>
          {notice.text}
        </div>
      )}
    </>
  );
};

export default LlmWatcherSection;
