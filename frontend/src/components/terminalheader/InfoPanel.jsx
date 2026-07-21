/**
 * 시스템 정보 패널 — 세션/연결/호스트/위치/테마/시스템 통계(CPU·메모리·프로세스).
 * useSystemStats 폴링 + 메모리 스택바 + 프로세스 리스트 포함. 자족적 클러스터.
 * TerminalHeader.jsx 에서 로직 변경 없이 추출.
 */
import { useState, memo, useCallback, useEffect, useRef } from 'react';
import {
  Folder, Palette, RefreshCw, Info, Server, Terminal as TerminalIcon,
  Anchor, Copy, Check, Wifi, KeyRound, XCircle, Zap,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import themes from '../../styles/themes';
import { buildThemeUI } from '../../styles/themeUI';
import SkeletonRow from '../common/SkeletonRow';
import useSystemStats from './info/useSystemStats';
import { formatBytes, formatRate, formatUptime } from './info/infoFormat';
import { InfoSection, InfoRow, MemoryStackBar, StatBar } from './info/InfoParts';
import ProcessList from './info/ProcessList';
import { infoStyles } from './info/infoStyles';

const { color, font, fontSize, fontWeight, space } = tokens;

// Info 탭은 트레이스가 아니라 스냅샷에 가깝다. 매 몇 초 갱신은 실시간 모니터링도 아닌데 부하만 키움.
// → 탭 열려 있는 동안만 30s 마다 폴링하고, 닫으면 즉시 멈춤. 사용자가 즉시 보고 싶으면 새로고침 버튼.

const InfoPanel = memo(({ info, paneThemeId, globalThemeId, t }) => {
  const { stats, refresh: refreshStats, refreshing: statsRefreshing } = useSystemStats(true);
  const themeOverridden = !!paneThemeId && !!globalThemeId && paneThemeId !== globalThemeId;
  const activeThemeId = paneThemeId || globalThemeId;
  const infoTheme = themes[activeThemeId] || themes.catppuccin;
  const infoUi = buildThemeUI(infoTheme);
  const [copiedKey, setCopiedKey] = useState(null);
  const handleCopy = (key, value) => {
    if (!value) return;
    try {
      navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1100);
    } catch { /* ignore */ }
  };

  const host = info?.host || null;
  const isHost = info?.tabType === 'host';

  const hostAddr = host
    ? [host.ssh_user || host.username, host.hostname || host.host].filter(Boolean).join('@')
      + (host.port && host.port !== 22 ? `:${host.port}` : '')
    : null;

  const cwdDisplay = info?.cwd
    ? info.cwd
    : (info?.paneCwdRel != null ? `~/${info.paneCwdRel}` : '—');

  /* 라이브 연결 상태 — Terminal.jsx 가 노출한 getDims/getConnectionState 폴링.
     1초 간격이면 충분 (사이즈는 자주 안 바뀜). */
  const [live, setLive] = useState({ cols: 0, rows: 0, conn: 'unknown' });
  useEffect(() => {
    const sid = info?.sessionId;
    if (!sid) return undefined;
    const tick = () => {
      const sess = (typeof window !== 'undefined') ? window.terminalSessions?.[sid] : null;
      if (!sess) {
        setLive({ cols: 0, rows: 0, conn: 'closed' });
        return;
      }
      const dims = sess.getDims?.() || { cols: 0, rows: 0 };
      const conn = sess.getConnectionState?.() || 'unknown';
      setLive({ cols: dims.cols || 0, rows: dims.rows || 0, conn });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info?.sessionId]);

  const connToneMap = {
    open:       { dot: '#a6e3a1', label: t?.('connOpen')       || 'Connected' },
    connecting: { dot: '#f9e2af', label: t?.('connConnecting') || 'Connecting…' },
    closing:    { dot: '#f9e2af', label: t?.('connClosing')    || 'Closing…' },
    closed:     { dot: '#f38ba8', label: t?.('connClosed')     || 'Disconnected' },
    unknown:    { dot: '#6c7086', label: '—' },
  };
  const connTone = connToneMap[live.conn] || connToneMap.unknown;

  const authLabelMap = {
    key:       t?.('authKey')       || 'SSH key',
    password:  t?.('authPassword')  || 'Password',
    tailscale: t?.('authTailscale') || 'Tailscale',
  };

  return (
    <div style={infoStyles.root}>
      {/* 인접 섹션 사이 풀폭 구분선 — first/last 자동 제외 (`+` 형제 셀렉터). */}
      <style>{`
        .iterm-info-section + .iterm-info-section { border-top: 1px solid var(--ui-border, ${infoUi?.border || color.border}); }
        @keyframes iterm-info-connected-breath {
          0%, 100% { opacity: 0.62; transform: scale(0.88); box-shadow: 0 0 0 2px ${connToneMap.open.dot}20, 0 0 4px ${connToneMap.open.dot}24; }
          50% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 3px ${connToneMap.open.dot}30, 0 0 9px ${connToneMap.open.dot}55; }
        }
        @keyframes iterm-spin { to { transform: rotate(360deg); } }
      `}</style>
      {/* 세션 */}
      <InfoSection title={t?.('infoSession') || 'Session'} icon={TerminalIcon}>
        <InfoRow label={t?.('infoTabName') || 'Tab'} value={info?.paneName || info?.tabName || '—'} mono={false} accent />
        <InfoRow
          label={t?.('infoMode') || 'Mode'}
          value={isHost ? (t?.('infoModeRemote') || 'SSH (remote)') : (t?.('infoModeLocal') || 'Local')}
          mono={false}
          accent={isHost}
        />
        {info?.paneCount > 1 && (
          <InfoRow
            label={t?.('infoPane') || 'Pane'}
            value={`${(info.paneIndex ?? 0) + 1} / ${info.paneCount}`}
            mono={false}
          />
        )}
        <InfoRow
          label={t?.('infoSessionId') || 'Session ID'}
          value={info?.sessionId || '—'}
          copyable={!!info?.sessionId}
          onCopy={() => handleCopy('sessionId', info?.sessionId)}
          copied={copiedKey === 'sessionId'}
        />
        {info?.effectiveTmuxSession && (
          <InfoRow
            label={t?.('infoTmuxSession') || 'tmux session'}
            value={info.effectiveTmuxSession}
            copyable
            onCopy={() => handleCopy('tmux', info.effectiveTmuxSession)}
            copied={copiedKey === 'tmux'}
            icon={Anchor}
          />
        )}
        <InfoRow
          label={t?.('infoPersistent') || 'Persistent'}
          value={info?.isPersistent
            ? (t?.('yes') || 'Yes')
            : (t?.('no') || 'No')}
          mono={false}
          accent={!!info?.isPersistent}
        />
      </InfoSection>

      {/* 연결 — 라이브. xterm 의 cols×rows + WS readyState. */}
      <InfoSection title={t?.('infoConnection') || 'Connection'} icon={Wifi}>
        <InfoRow
          label={t?.('infoStatus') || 'Status'}
          value={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: connTone.dot, flexShrink: 0,
                boxShadow: live.conn === 'open' ? `0 0 0 2px ${connTone.dot}33` : 'none',
                animation: live.conn === 'open' ? 'iterm-info-connected-breath 1.7s ease-in-out infinite' : 'none',
              }} />
              {connTone.label}
            </span>
          }
          mono={false}
        />
        <InfoRow
          label={t?.('infoSize') || 'Size'}
          value={live.cols && live.rows ? `${live.cols} × ${live.rows}` : '—'}
        />
        <div style={infoStyles.note}>
          {t?.('infoTakeoverHint') || 'Last attach wins — opening this session elsewhere will detach this view.'}
        </div>
      </InfoSection>

      {/* 호스트 (host 모드만) */}
      {isHost && host && (
        <InfoSection title={t?.('infoHost') || 'Host'} icon={Server}>
          <InfoRow label={t?.('infoHostName') || 'Name'} value={host.name || '—'} mono={false} />
          <InfoRow
            label={t?.('infoAddress') || 'Address'}
            value={hostAddr || '—'}
            copyable={!!hostAddr}
            onCopy={() => handleCopy('addr', hostAddr)}
            copied={copiedKey === 'addr'}
          />
          <InfoRow
            label={t?.('infoAuth') || 'Auth'}
            value={authLabelMap[host.auth_method] || host.auth_method || '—'}
            mono={false}
            icon={KeyRound}
          />
          <InfoRow
            label={t?.('infoUseRemoteTmux') || 'Remote tmux'}
            value={host.use_remote_tmux
              ? (t?.('on') || 'On')
              : (t?.('off') || 'Off')}
            mono={false}
            accent={!!host.use_remote_tmux}
          />
          {host.start_path && (
            <InfoRow
              label={t?.('infoStartPath') || 'Start path'}
              value={host.start_path}
              copyable
              onCopy={() => handleCopy('start_path', host.start_path)}
              copied={copiedKey === 'start_path'}
            />
          )}
        </InfoSection>
      )}

      {/* 위치 */}
      <InfoSection title={t?.('infoLocation') || 'Location'} icon={Folder}>
        <InfoRow
          label={t?.('infoCwd') || 'CWD'}
          value={cwdDisplay}
          copyable={cwdDisplay !== '—'}
          onCopy={() => handleCopy('cwd', cwdDisplay)}
          copied={copiedKey === 'cwd'}
        />
        {info?.cwdAbsolute && (
          <InfoRow
            label={t?.('infoAbsolutePath') || 'Absolute'}
            value={info.cwdAbsolute}
            copyable
            onCopy={() => handleCopy('cwdAbsolute', info.cwdAbsolute)}
            copied={copiedKey === 'cwdAbsolute'}
          />
        )}
      </InfoSection>

      {/* 테마 */}
      <InfoSection title={t?.('infoTheme') || 'Theme'} icon={Palette}>
        <InfoRow
          label={t?.('infoActiveTheme') || 'Active'}
          value={activeThemeId || '—'}
          mono={false}
          accent={themeOverridden}
        />
        {themeOverridden && (
          <div style={infoStyles.note}>
            {t?.('themePerPaneOverride') || 'Pane override active.'}
          </div>
        )}
      </InfoSection>

      {/* 시스템 자원 — 백엔드 호스트 (앱 서버) 기준 */}
      <InfoSection
        title={t?.('infoSystem') || 'System'}
        icon={Info}
        subtitle={stats?.hostname ? `${stats.hostname}` : null}
        action={(
          <button
            type="button"
            onClick={() => refreshStats?.()}
            disabled={statsRefreshing}
            title={t?.('refresh') || 'Refresh'}
            style={{
              width: '18px',
              height: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: 'var(--ui-subtext)',
              padding: 0,
              cursor: statsRefreshing ? 'wait' : 'pointer',
              opacity: statsRefreshing ? 0.4 : 0.8,
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
            onMouseEnter={(e) => { if (!statsRefreshing) { e.currentTarget.style.background = 'var(--ui-surface1)'; e.currentTarget.style.color = 'var(--ui-text)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-subtext)'; }}
          >
            <RefreshCw size={11} strokeWidth={2} style={{ animation: statsRefreshing ? 'iterm-spin 0.7s linear infinite' : 'none' }} />
          </button>
        )}
      >
        {!stats ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <SkeletonRow width="32px" height="10px" />
                  <SkeletonRow width="60px" height="10px" />
                </div>
                <SkeletonRow width="100%" height="6px" borderRadius="3px" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <StatBar
              label="CPU"
              percent={stats.cpu ?? 0}
              right={stats.cpu_count ? `${(stats.cpu ?? 0).toFixed(1)}% · ${stats.cpu_count} cores` : `${(stats.cpu ?? 0).toFixed(1)}%`}
            />
            <MemoryStackBar stats={stats} />
            <StatBar
              label="Disk"
              percent={stats.disk ?? 0}
              right={stats.disk_total
                ? `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)} · free ${formatBytes(stats.disk_free)}`
                : `${(stats.disk ?? 0).toFixed(1)}%`}
            />
            {(stats.net_rx_rate != null || stats.net_tx_rate != null) && (
              <InfoRow
                label="Network"
                value={`↓ ${formatRate(stats.net_rx_rate || 0)} · ↑ ${formatRate(stats.net_tx_rate || 0)}`}
              />
            )}
            {Array.isArray(stats.load_avg) && stats.load_avg.length === 3 && (
              <InfoRow
                label="Load"
                value={stats.load_avg.map((x) => x.toFixed(2)).join(' · ')}
              />
            )}
            {stats.uptime != null && (
              <InfoRow
                label={t?.('infoUptime') || 'Uptime'}
                value={formatUptime(stats.uptime, t)}
                mono={false}
              />
            )}
            {Array.isArray(stats.top_processes) && stats.top_processes.length > 0 && (
              <ProcessList processes={stats.top_processes} onRefresh={refreshStats} />
            )}
          </>
        )}
      </InfoSection>
    </div>
  );
});

export default InfoPanel;
