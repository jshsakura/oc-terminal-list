import { useCallback, useEffect, useState } from 'react';
import { Toggle } from './SettingsFields';
import { styles } from './settingsStyles';
import { authHeaders } from '../../utils/auth';
import { LLM_USAGE_CHANGED_EVENT } from '../../utils/llmUsageBus';

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
  /* A switch with no answer is just a switch. After turning it on we actually
     read, and report what came back — how many hosts answered, and which did
     not and why. That is the difference between "on" and "working". */
  const [probe, setProbe] = useState(null);   // null | 'loading' | summary object

  const probeUsage = useCallback(async (force = false) => {
    setProbe('loading');
    try {
      const url = force ? '/api/llm-usage/refresh?days=30' : '/api/llm-usage/summary?days=30';
      const res = await fetch(url, { method: force ? 'POST' : 'GET', headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProbe(await res.json());
    } catch (e) {
      setProbe({ error: e?.message || 'failed' });
    }
  }, []);

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
      // The home dashboard mounts once and never polls — tell it to re-read now,
      // otherwise turning this on does nothing visible until a page reload.
      try { window.dispatchEvent(new CustomEvent(LLM_USAGE_CHANGED_EVENT)); } catch { /* no window */ }
      if (next) probeUsage(false);
      else setProbe(null);
    } catch (e) {
      setNotice({ ok: false, text: e?.message || (t?.('saveFailed') || 'Save failed') });
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  }, [apply, probeUsage, t]);

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

      {enabled && <ProbeResult probe={probe} onRecheck={() => probeUsage(true)} t={t} />}

      {notice && (
        <div style={{ ...styles.hint, color: notice.ok ? undefined : 'var(--ui-danger, #e5484d)' }}>
          {notice.text}
        </div>
      )}
    </>
  );
};

/** What the last read found — the visible sign that the switch did something. */
const ProbeResult = ({ probe, onRecheck, t }) => {
  if (probe === 'loading') {
    return <div style={styles.hint}>{t?.('llmCollecting') || 'Collecting…'}</div>;
  }
  if (!probe) return null;
  if (probe.error) {
    return <div style={{ ...styles.hint, color: 'var(--ui-danger, #e5484d)' }}>{probe.error}</div>;
  }

  const hosts = Array.isArray(probe.by_host) ? probe.by_host : [];
  const failed = hosts.filter((h) => !h.ok);
  const cost = Math.round(Number(probe.totals?.cost) || 0).toLocaleString();
  const sessions = Math.round(Number(probe.totals?.sessions) || 0);

  return (
    <>
      <div style={styles.hint}>
        {`${probe.ok_count ?? 0}/${probe.source_count ?? 0} ${t?.('llmHosts') || 'hosts'}`}
        {` · ${sessions} ${t?.('sessions') || 'sessions'} · $${cost} (${probe.days ?? 30}d)`}
        {' · '}
        <button type="button" onClick={onRecheck} style={linkBtnStyle}>
          {t?.('refresh') || 'Refresh'}
        </button>
      </div>
      {/* Failures are named. "5/7" without the two names is not actionable. */}
      {failed.map((h) => (
        <div key={h.source_id} style={{ ...styles.hint, color: 'var(--ui-warning, #e0af68)' }}>
          {h.name}: {h.error}
        </div>
      ))}
      {(probe.warnings || []).slice(0, 3).map((w) => (
        <div key={w} style={styles.hint}>{w}</div>
      ))}
    </>
  );
};

const linkBtnStyle = {
  background: 'none', border: 'none', padding: 0,
  color: 'var(--ui-accent, #7aa2f7)', cursor: 'pointer',
  font: 'inherit', textDecoration: 'underline',
};

export default LlmWatcherSection;
