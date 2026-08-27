import { useCallback, useEffect, useState } from 'react';
import {
  Link2, Link2Off, Loader2, Trash2, Download, ArrowLeftRight, Radio, Bell, Copy, Check,
} from 'lucide-react';
import Button from '../common/Button';
import { tokens } from '../../styles/tokens';
import apiFetch from '../../utils/apiFetch';
import copyToClipboard from '../../utils/clipboard';

const { color, fontSize, fontWeight, space, radius } = tokens;

/**
 * 호스트를 "터미널 간 명령 주고받기" 에 참여시키는 구획 — **itl 과 리모트가 한 자리다.**
 *
 * 오래 두 구획이었다. 만들어진 순서가 그랬을 뿐, 사용자가 따로 고를 일이 있어서가
 * 아니다. 어느 한쪽만으로는 되는 일이 없다 — 리모트만 깔면 그 호스트의 에이전트가
 * 답장을 못 하고, itl 만 깔면 이쪽에서 그 호스트를 보지도 부르지도 못한다.
 *
 * ⚠️ **안 깔았을 때는 크게 말한다.** 예전 문구는 11px 회색 한 줄이었고, 게다가
 * "안 깔아도 앱이 SSH 로 대신 살펴보므로 기능은 그대로" 라고 적혀 있었다 — SSH 폴백을
 * 없앤 뒤로 그건 **사실이 아니다.** 안 깔면 그 호스트의 pane 은 상태가 `?` 이고
 * 명령을 받지 못한다. 이 앱의 주력 기능이 그 호스트에서만 통째로 없는 것이므로,
 * 그 사실은 눈에 보이는 크기로 적혀야 한다.
 *
 * ⚠️ 다 되고 나면 **조용해진다.** 준비된 호스트에까지 큰 안내가 남아 있으면 그건
 * 광고지 정보가 아니다.
 */
const HostAgentSection = ({ hostId, authHeaders, t }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [busy, setBusy] = useState(null);          // 'setup' | 'uninstall' | null
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!hostId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiFetch(`/api/hosts/${hostId}/agent-status`, {
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
      const path = kind === 'setup' ? 'agent-setup' : 'remote-uninstall';
      const res = await apiFetch(`/api/hosts/${hostId}/${path}`, {
        method: 'POST', headers: authHeaders(), timeoutMs: 120000,
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
  const remote = data?.remote || {};
  const itl = data?.itl || {};
  const ready = data?.ready === true;
  const installed = remote.installed === true;
  const unreachable = remote.reachable === false;
  const isWindows = itl.platform === 'windows';

  const copySetup = useCallback(async () => {
    // 결과를 boolean 으로 받는다 — 실패했는데 체크를 띄우면 사용자는 붙여넣기를
    // 시도한 뒤에야 안다(utils/clipboard 의 규칙).
    if (await copyToClipboard(itl.setup_command || '')) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [itl.setup_command]);

  if (state.loading) {
    return (
      <span style={styles.muted}>
        <Loader2 size={12} className="dc-spin" /> {t?.('loading') || 'Loading…'}
      </span>
    );
  }

  return (
    <div style={styles.wrap}>
      {/* 안 깔렸으면 — 무엇을 잃고 있는지 크게. */}
      {!ready && !isWindows && !unreachable && (
        <div style={styles.pitch}>
          <div style={styles.pitchTitle}>
            {t?.('agentPitchTitle') || '이 호스트를 명령 주고받기에 연결하세요'}
          </div>
          <div style={styles.pitchBody}>
            {t?.('agentPitchBody')
              || '이 호스트의 터미널이 다른 기계의 터미널과 직접 주고받게 됩니다. 지금은 연결되어 있지 않아, 이 호스트의 터미널은 목록에서 상태가 “?” 로 보이고 명령을 받지 못합니다.'}
          </div>
          <ul style={styles.benefits}>
            <Benefit icon={ArrowLeftRight}
              text={t?.('agentBenefitSend') || '다른 터미널에서 이 호스트로 명령을 보내고, 이 호스트의 에이전트가 그대로 답장합니다'} />
            <Benefit icon={Radio}
              text={t?.('agentBenefitStatus') || '이 호스트의 터미널이 지금 무엇을 하는지 보입니다 (작업 중 · 확인 대기 · 유휴)'} />
            <Benefit icon={Bell}
              text={t?.('agentBenefitNotify') || '작업이 끝나면 텔레그램·웹푸시로 알립니다'} />
          </ul>
          <div style={styles.pitchFoot}>
            {t?.('agentPitchFoot')
              || '설치되는 것: 이 호스트의 홈 아래 파일 몇 개(itl 명령 + 리모트)와 사용자 서비스 하나. 새 포트를 열지 않고, 이 호스트 전용 자격증명을 씁니다. 언제든 제거할 수 있습니다.'}
          </div>
        </div>
      )}

      {/* 준비됐으면 — 한 줄. */}
      {ready && (
        <span style={styles.statusLabel}>
          <Link2 size={12} color={color.success} />
          <span style={{ color: color.text }}>
            {t?.('agentReady') || '연결됨 — 이 호스트의 터미널로 명령을 주고받습니다'}
          </span>
        </span>
      )}

      {/* 반쪽인 상태는 **어느 쪽이 빈지** 말한다. "설치됨" 만 적으면 왜 안 되는지 모른다. */}
      {!ready && installed && !unreachable && (
        <div style={styles.half}>
          <span style={styles.statusLabel}>
            <Link2Off size={12} color={color.muted} />
            <span style={{ color: color.subtext }}>
              {remote.connected
                ? (t?.('agentHalfItl') || '리모트는 붙었습니다 — itl 명령이 아직 준비되지 않았습니다')
                : (t?.('agentHalfRemote') || '설치됐지만 아직 붙지 않았습니다')}
            </span>
          </span>
        </div>
      )}

      {unreachable && (
        <div style={styles.warn}>
          {t?.('remoteUnreachable') || '호스트에 닿지 못해 설치 여부를 확인하지 못했습니다.'}
        </div>
      )}
      {isWindows && (
        <div style={styles.warn}>
          {t?.('windowsUnsupported') || 'Windows 호스트로 보입니다 — 세션 유지·파일 붙여넣기·itl 이 모두 POSIX 셸을 전제합니다. WSL 안의 SSH 서버를 등록하면 평소대로 동작합니다.'}
        </div>
      )}
      {state.error && <div style={styles.error}>{state.error}</div>}
      {data?.errors?.remote && <div style={styles.error}>리모트: {data.errors.remote}</div>}
      {data?.errors?.itl && <div style={styles.error}>itl: {data.errors.itl}</div>}

      {/* 설치는 됐는데 아무것도 안 도는 조합이 있다(systemd 없는 호스트) — 할 일을 준다. */}
      {remote.hint === 'manual' && (
        <div style={styles.warn}>
          {t?.('remoteNoSystemd') || '이 호스트에는 systemd 사용자 서비스가 없습니다 — 직접 띄워 주세요:'}
          <code style={styles.code}>{remote.start_command}</code>
        </div>
      )}
      {remote.hint === 'inactive' && (
        <div style={styles.warn}>
          {t?.('remoteServiceStopped') || '서비스가 멈춰 있습니다: systemctl --user start itl-remote'}
        </div>
      )}
      {remote.outdated && (
        <div style={styles.warn}>
          {t?.('remoteOutdated') || '설치된 리모트가 이 서버보다 낡았습니다 — 다시 설치하면 갱신됩니다.'}
        </div>
      )}

      <div style={styles.buttons}>
        {!isWindows && !unreachable && (
          <Button
            variant={ready ? 'ghost' : 'primary'}
            type="button"
            icon={Download}
            disabled={busy !== null}
            onClick={() => act('setup')}
          >
            {busy === 'setup'
              ? (t?.('remoteInstalling') || '설치 중…')
              : installed ? (t?.('remoteReinstall') || '다시 설치') : (t?.('agentInstall') || '연결하기')}
          </Button>
        )}
        {/* ⚠️ 셋업 명령 복사는 **자동 설치가 안 될 때의 탈출구**다. 깔린 뒤에도 남겨
            두면 "설치했는데 왜 아직 명령을 복사하라고 하나" 가 된다 — 깔린 호스트에
            필요한 것은 다시 설치와 제거뿐이다. `ready` 가 아니라 `installed` 로
            가르는 이유: 설치 직후엔 아직 안 붙어서 ready 가 false 다. */}
        {itl.setup_command && !installed && (
          <Button variant="ghost" type="button" icon={copied ? Check : Copy} onClick={copySetup}>
            {copied ? (t?.('itlCopied') || '복사됨') : (t?.('itlCopySetup') || '셋업 명령 복사')}
          </Button>
        )}
        {installed && (
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
        )}
      </div>

      {remote.facts && Object.keys(remote.facts).length > 0 && (
        <div style={styles.facts}>
          {Object.entries(remote.facts).map(([key, value]) => (
            <span key={key} style={styles.fact}>
              <span style={{ color: color.muted }}>{key}</span> {String(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const Benefit = ({ icon: Icon, text }) => (
  <li style={styles.benefit}>
    <Icon size={12} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--ui-accent)' }} />
    <span>{text}</span>
  </li>
);

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  pitch: {
    display: 'flex', flexDirection: 'column', gap: space['1.5'],
    padding: space['2'],
    borderRadius: radius.md,
    // 강조는 하되 경고는 아니다 — 안 깐 것은 고장이 아니라 아직 안 한 선택이다.
    border: '1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent)',
    background: 'color-mix(in srgb, var(--ui-accent) 7%, transparent)',
  },
  /* ⚠️ 한 번 과하게 갔다가 되돌렸다. "중요한 기능이니 크게" 를 **글자 크기**로 읽어
     16px 제목을 얹었더니 설정 모달 안에서 광고처럼 보였다. 중요하다는 것은 **무엇을
     잃고 있는지 제대로 적는다**는 뜻이지 활자를 키운다는 뜻이 아니다 — 내용은 그대로
     두고 크기만 본문(13px)으로 내린다. */
  pitchTitle: { fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text },
  pitchBody: { fontSize: fontSize['12'], color: color.subtext, lineHeight: 1.55 },
  benefits: {
    display: 'flex', flexDirection: 'column', gap: space['1'],
    margin: 0, padding: 0, listStyle: 'none',
    fontSize: fontSize['12'], color: color.subtext, lineHeight: 1.45,
  },
  benefit: { display: 'flex', gap: space['1.5'], alignItems: 'flex-start' },
  pitchFoot: { fontSize: fontSize['11'], color: color.muted, lineHeight: 1.5 },
  statusLabel: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: fontSize['12'] },
  half: { display: 'flex', flexDirection: 'column', gap: space['1'] },
  muted: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontSize: fontSize['11'], color: color.muted,
  },
  buttons: { display: 'flex', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
  facts: { display: 'flex', flexWrap: 'wrap', gap: space['2'], fontSize: fontSize['11'], color: color.subtext },
  fact: { display: 'inline-flex', gap: '4px' },
  warn: { fontSize: fontSize['12'], color: 'var(--ui-warning, #f9e2af)', lineHeight: 1.5 },
  error: { fontSize: fontSize['12'], color: color.danger, lineHeight: 1.5 },
  code: {
    display: 'block', marginTop: '4px', padding: '4px 6px',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 60%, transparent)`,
    borderRadius: '4px', color: color.text,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    wordBreak: 'break-all',
    userSelect: 'all',
  },
};

export default HostAgentSection;
