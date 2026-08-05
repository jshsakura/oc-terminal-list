import { useCallback, useEffect, useState } from 'react';
import { Field, Toggle } from './SettingsFields';
import { styles } from './settingsStyles';
import { authHeaders } from '../../utils/auth';

/**
 * LLM Watcher 연동 — 에이전트 토큰·비용을 홈 대시보드에 띄운다.
 *
 * **꺼져 있으면 아무 일도 일어나지 않는다.** 대시보드는 그 구획을 아예 안 그리고,
 * 백엔드는 호스트에 SSH 도 걸지 않는다. 이 토글이 그 유일한 스위치다.
 *
 * 켜면 백엔드가 이 서버와 등록된 호스트들에서 llm-watcher 를 찾는다. 못 찾은
 * 호스트는 대시보드의 호스트 목록에 사유와 함께 남는다 — "왜 비었나" 를 화면에서
 * 답할 수 있어야 한다.
 *
 * 조회는 **하루 한 번**이다. 여기서 켠 직후에도 대시보드의 새로고침을 누르면 즉시
 * 다시 읽는다.
 */
const WATCHER_REPO = 'https://github.com/jshsakura/llm-watcher';

const LlmWatcherSection = ({ t }) => {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [urlFromEnv, setUrlFromEnv] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyFromEnv, setKeyFromEnv] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const apply = useCallback((d) => {
    if (!d) return;
    setEnabled(!!d.enabled);
    setUrl(d.url || '');
    setUrlFromEnv(!!d.url_from_env);
    setHasKey(!!d.has_api_key);
    setKeyFromEnv(!!d.api_key_from_env);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm-usage/config', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) apply(d); })
      .catch(() => { /* 설정 화면이 못 뜰 이유는 아니다 */ });
    return () => { cancelled = true; };
  }, [apply]);

  const put = useCallback(async (body, successMessage) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/llm-usage/config', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice({ ok: false, text: data?.detail || (t?.('saveFailed') || 'Save failed') });
        return;
      }
      apply(data);
      setApiKey('');
      if (successMessage) setNotice({ ok: true, text: successMessage });
    } catch {
      setNotice({ ok: false, text: t?.('saveFailed') || 'Save failed' });
    } finally {
      setBusy(false);
    }
  }, [apply, t]);

  const toggle = (next) => {
    setEnabled(next); // 낙관적 — 실패하면 서버 응답으로 되돌아온다
    put({ enabled: next });
  };

  return (
    <>
      <Toggle
        label={t?.('llmWatcherEnable') || 'LLM usage dashboard'}
        hint={t?.('llmWatcherEnableHint')
          || 'Reads llm-watcher on this server and your hosts. Off means nothing is queried at all.'}
        checked={enabled}
        onChange={toggle}
      />

      {enabled && (
        <>
          <Field
            label={t?.('llmWatcherUrl') || 'Watcher address (optional)'}
            hint={urlFromEnv
              ? (t?.('setByEnv') || 'Set by environment variable — this field is ignored.')
              : (t?.('llmWatcherUrlHint')
                || 'Leave empty to auto-detect: llm-watcher:34318 (compose), then 127.0.0.1:34318.')}
          >
            <input
              type="text"
              value={url}
              disabled={urlFromEnv || busy}
              placeholder="http://127.0.0.1:34318"
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => { if (!urlFromEnv) put({ url }); }}
              style={styles.input}
            />
          </Field>

          <Field
            label={t?.('llmWatcherApiKey') || 'API key (optional)'}
            hint={keyFromEnv
              ? (t?.('setByEnv') || 'Set by environment variable — this field is ignored.')
              : hasKey
                ? (t?.('llmWatcherKeySet') || 'A key is saved. Type a new one to replace it, or clear it below.')
                : (t?.('llmWatcherKeyHint')
                  || 'Only needed if the watcher runs with LLMW_API_KEY set.')}
          >
            <input
              type="password"
              value={apiKey}
              disabled={keyFromEnv || busy}
              placeholder={hasKey ? '••••••••' : ''}
              autoComplete="new-password"
              onChange={(e) => setApiKey(e.target.value)}
              style={styles.input}
            />
          </Field>

          {!keyFromEnv && (
            <div style={actionRowStyle}>
              <button
                type="button"
                disabled={busy || !apiKey.trim()}
                onClick={() => put({ api_key: apiKey.trim() }, t?.('saved') || 'Saved')}
                style={styles.btn}
              >
                {t?.('save') || 'Save'}
              </button>
              {hasKey && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => put({ api_key: '' }, t?.('cleared') || 'Cleared')}
                  style={styles.btn}
                >
                  {t?.('clear') || 'Clear'}
                </button>
              )}
            </div>
          )}

          <div style={styles.hint}>
            {t?.('llmWatcherInstallHint') || 'Each host needs llm-watcher running on its loopback:'}{' '}
            <a href={WATCHER_REPO} target="_blank" rel="noreferrer" style={linkStyle}>
              {WATCHER_REPO.replace('https://', '')}
            </a>
          </div>
        </>
      )}

      {notice && (
        <div style={{ ...styles.hint, color: notice.ok ? undefined : 'var(--ui-danger, #e5484d)' }}>
          {notice.text}
        </div>
      )}
    </>
  );
};

const actionRowStyle = { display: 'flex', gap: '8px' };
const linkStyle = { color: 'var(--ui-accent, #6366f1)', textDecoration: 'none' };

export default LlmWatcherSection;
