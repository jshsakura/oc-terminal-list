import { useCallback, useEffect, useState } from 'react';
import { Link2, Link2Off, Loader2, Trash2, Download } from 'lucide-react';
import Button from '../common/Button';
import { tokens } from '../../styles/tokens';
import apiFetch from '../../utils/apiFetch';

const { color, fontSize, space } = tokens;

/**
 * 호스트 편집기의 리모트 구획.
 *
 * ⚠️ **설치는 선택이다.** 안 깔아도 백엔드가 SSH 로 관찰자를 띄우는 경로가 그대로
 * 있으므로, "미설치" 를 경고색으로 그리지 않는다 — 강요할 생각이 없는데 화면이 강요처럼
 * 읽히면 안 된다. 무엇을 얻는지만 적고 고르게 둔다.
 *
 * ⚠️ 상태 조회는 **SSH 왕복**이다. 그래서 이 구획을 실제로 열었을 때만 묻는다(호스트
 * 목록의 아이콘은 SSH 없는 `/api/remote/connected` 를 쓴다).
 */
const RemoteAgentSection = ({ hostId, authHeaders, t }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [busy, setBusy] = useState(null);   // 'install' | 'uninstall' | null
  // 제거는 되돌릴 수 없다(자격증명까지 폐기된다). 이 패널은 이미 모달 안이라 모달을 또
  // 띄우는 대신 버튼 자신이 한 번 되묻는다.
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    if (!hostId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiFetch(`/api/hosts/${hostId}/remote-status`, {
        headers: authHeaders(), timeoutMs: 25000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ loading: false, data: await res.json(), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e.message || 'failed' });
    }
  }, [hostId, authHeaders]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (kind) => {
    setBusy(kind);
    try {
      const res = await apiFetch(`/api/hosts/${hostId}/remote-${kind}`, {
        method: 'POST', headers: authHeaders(), timeoutMs: 90000,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || 'failed' }));
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }, [hostId, authHeaders, load]);

  const data = state.data;
  const installed = data?.installed === true;
  const connected = data?.connected === true;

  return (
    <div style={styles.wrap}>
      <div style={styles.statusRow}>
        {state.loading ? (
          <span style={styles.muted}>
            <Loader2 size={12} className="dc-spin" /> {t?.('loading') || 'Loading…'}
          </span>
        ) : (
          <span style={styles.statusLabel}>
            {connected
              ? <Link2 size={12} color={color.success} />
              : <Link2Off size={12} color={color.muted} />}
            <span style={{ color: connected ? color.text : color.subtext }}>
              {connected
                ? (t?.('remoteConnected') || '연결됨 — 이 호스트가 상태를 직접 보내옵니다')
                : installed
                  ? (t?.('remoteInstalledIdle') || '설치됨 — 아직 붙지 않았습니다')
                  : (t?.('remoteNotInstalled') || '앱이 SSH 로 살펴보는 중 — 리모트 미설치')}
            </span>
          </span>
        )}
      </div>

      {/* 못 닿은 것과 "안 깔림" 은 다른 사건이다. 섞으면 설치 버튼을 누르게 되고 그것도 실패한다. */}
      {data?.reachable === false && (
        <div style={styles.warn}>
          {t?.('remoteUnreachable') || '호스트에 닿지 못해 설치 여부를 확인하지 못했습니다.'}
        </div>
      )}
      {state.error && <div style={styles.error}>{state.error}</div>}

      {/* ⚠️ 설치가 성공했는데 **아무것도 안 도는** 조합이 있다(systemd 없는 호스트).
          그때 "아직 안 붙었습니다" 만 말하면 이유도 할 일도 알 수 없다. */}
      {data?.hint === 'manual' && (
        <div style={styles.warn}>
          {t?.('remoteNoSystemd') || '이 호스트에는 systemd 사용자 서비스가 없습니다 — 직접 띄워 주세요:'}
          <code style={styles.code}>{data.start_command}</code>
        </div>
      )}
      {data?.hint === 'inactive' && (
        <div style={styles.warn}>
          {t?.('remoteServiceStopped') || '서비스가 멈춰 있습니다: systemctl --user start itl-remote'}
        </div>
      )}
      {data?.hint === 'waiting' && (
        <div style={styles.muted}>
          {t?.('remoteWaiting') || '서비스는 돌고 있습니다 — 곧 붙습니다.'}
        </div>
      )}

      {data?.outdated && (
        <div style={styles.warn}>
          {t?.('remoteOutdated') || '설치된 리모트가 이 서버보다 낡았습니다 — 다시 설치하면 갱신됩니다.'}
        </div>
      )}

      <div style={styles.buttons}>
        {!installed && data?.reachable !== false && (
          <Button variant="ghost" type="button" icon={Download}
            disabled={busy !== null} onClick={() => act('install')}>
            {busy === 'install' ? (t?.('remoteInstalling') || '설치 중…')
              : (t?.('remoteInstall') || '리모트 설치')}
          </Button>
        )}
        {installed && (
          <>
            <Button variant="ghost" type="button" icon={Download}
              disabled={busy !== null} onClick={() => act('install')}>
              {busy === 'install' ? (t?.('remoteInstalling') || '설치 중…')
                : (t?.('remoteReinstall') || '다시 설치')}
            </Button>
            <Button
              variant={confirmRemove ? 'danger' : 'ghost'}
              type="button" icon={Trash2} disabled={busy !== null}
              onClick={() => (confirmRemove ? act('uninstall') : setConfirmRemove(true))}
            >
              {busy === 'uninstall'
                ? (t?.('remoteRemoving') || '제거 중…')
                : confirmRemove
                  ? (t?.('remoteUninstallConfirm') || '정말 제거 — 자격증명도 폐기')
                  : (t?.('remoteUninstall') || '제거')}
            </Button>
          </>
        )}
      </div>

      {data?.facts && Object.keys(data.facts).length > 0 && (
        <div style={styles.facts}>
          {Object.entries(data.facts).map(([key, value]) => (
            <span key={key} style={styles.fact}>
              <span style={{ color: color.muted }}>{key}</span> {String(value)}
            </span>
          ))}
        </div>
      )}

      <div style={styles.hint}>
        {t?.('remoteHint')
          || '깔면 이 호스트가 NAT 뒤에서도 스스로 붙고, 재부팅을 넘겨 살아남고, 이 호스트 전용 자격증명을 갖습니다. 안 깔아도 앱이 SSH 로 대신 살펴보므로 기능은 그대로입니다.'}
      </div>
    </div>
  );
};

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: space['2'] },
  statusRow: { display: 'flex', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
  statusLabel: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: fontSize['11'],
  },
  muted: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontSize: fontSize['11'], color: color.muted,
  },
  buttons: { display: 'flex', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
  facts: { display: 'flex', flexWrap: 'wrap', gap: space['2'], fontSize: fontSize['11'], color: color.subtext },
  fact: { display: 'inline-flex', gap: '4px' },
  hint: { fontSize: fontSize['11'], color: color.muted, lineHeight: 1.5 },
  warn: { fontSize: fontSize['11'], color: 'var(--ui-warning, #f9e2af)', lineHeight: 1.5 },
  code: {
    display: 'block',
    marginTop: '4px',
    padding: '4px 6px',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 60%, transparent)`,
    borderRadius: '4px',
    color: color.text,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    wordBreak: 'break-all',
    userSelect: 'all',        // 한 번 눌러 전체 선택 — 폰에서 부분 선택은 사실상 불가능
  },
  error: { fontSize: fontSize['11'], color: color.danger, lineHeight: 1.5 },
};

export default RemoteAgentSection;
