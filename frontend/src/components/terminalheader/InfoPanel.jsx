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
import { authHeaders } from '../../utils/auth';

const { color, font, fontSize, fontWeight, space } = tokens;

// Info 탭은 트레이스가 아니라 스냅샷에 가깝다. 매 몇 초 갱신은 실시간 모니터링도 아닌데 부하만 키움.
// → 탭 열려 있는 동안만 30s 마다 폴링하고, 닫으면 즉시 멈춤. 사용자가 즉시 보고 싶으면 새로고침 버튼.
const SYSTEM_STATS_POLL_MS = 30000;

const useSystemStats = (enabled) => {
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const fetchRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let aborted = false;
    const fetchOnce = async () => {
      setRefreshing(true);
      try {
        const res = await fetch('/api/system/stats', {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!aborted) setStats(data);
      } catch { /* 다음 tick 또는 사용자 새로고침에 다시 시도 */ }
      finally {
        if (!aborted) setRefreshing(false);
      }
    };
    fetchRef.current = fetchOnce;
    fetchOnce();
    intervalRef.current = setInterval(fetchOnce, SYSTEM_STATS_POLL_MS);
    return () => {
      aborted = true;
      fetchRef.current = null;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [enabled]);
  const refresh = useCallback(() => { fetchRef.current?.(); }, []);
  return { stats, refresh, refreshing };
};

const formatBytes = (n) => {
  if (n == null || isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatRate = (n) => `${formatBytes(n)}/s`;

const formatUptime = (s, t) => {
  if (s == null) return '—';
  const sec = Math.floor(s);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const label = (key, fallback) => {
    const value = t?.(key);
    return value && value !== key ? value : fallback;
  };
  const day = label('uptimeDayUnit', 'd');
  const hour = label('uptimeHourUnit', 'h');
  const minute = label('uptimeMinuteUnit', 'm');
  if (d > 0) return `${d}${day} ${h}${hour}`;
  if (h > 0) return `${h}${hour} ${m}${minute}`;
  return `${m}${minute}`;
};

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
        <InfoRow label={t?.('infoTabName') || 'Tab'} value={info?.paneName || info?.tabName || '—'} mono={false} />
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

const InfoSection = ({ title, icon: Icon, subtitle = null, action = null, children }) => (
  <div className="iterm-info-section" style={infoStyles.section}>
    <div style={infoStyles.sectionHeader}>
      {Icon && <Icon size={11} strokeWidth={2} style={{ color: 'var(--ui-subtext)', flexShrink: 0 }} />}
      <span style={{ ...infoStyles.sectionTitle, color: 'var(--ui-subtext)' }}>{title}</span>
      {subtitle && <span style={{ ...infoStyles.sectionSubtitle, color: 'var(--ui-subtext)' }}>{subtitle}</span>}
      {action && <span style={{ marginLeft: subtitle ? '4px' : 'auto', display: 'inline-flex', alignItems: 'center' }}>{action}</span>}
    </div>
    <div style={infoStyles.sectionBody}>
      {children}
    </div>
  </div>
);

const InfoRow = ({ label, value, mono = true, accent = false, copyable = false, onCopy, copied = false, icon: Icon = null }) => (
  <div style={infoStyles.row}>
    <span style={{ ...infoStyles.rowLabel, color: 'var(--ui-subtext)' }}>{label}</span>
    <span style={{
      ...infoStyles.rowValue,
      ...(mono ? infoStyles.rowValueMono : null),
      color: accent ? 'var(--ui-accent)' : 'var(--ui-text)',
    }}>
      {Icon && <Icon size={10} strokeWidth={2} style={{ marginRight: '4px', opacity: 0.7 }} />}
      <span style={infoStyles.rowValueText} title={typeof value === 'string' ? value : undefined}>{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          style={infoStyles.copyBtn}
          title="Copy"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ui-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ui-subtext)'; }}
        >
          {copied ? <Check size={10} strokeWidth={2.4} /> : <Copy size={10} strokeWidth={2} />}
        </button>
      )}
    </span>
  </div>
);

const MemoryStackBar = ({ stats }) => {
  const memTotal = Number(stats.mem_total) || 0;
  const swapTotal = Number(stats.swap_total) || 0;
  const total = memTotal + swapTotal;
  const used = Math.max(0, Number(stats.mem_used) || 0);
  const cache = Math.max(0, (Number(stats.mem_cache) || 0) + (Number(stats.mem_buffers) || 0));
  const swapUsed = Math.max(0, Number(stats.swap_used) || 0);
  const free = Math.max(0, total - used - cache - swapUsed);
  const pct = (value) => total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const segments = [
    { key: 'used', label: 'Used', value: used, color: 'var(--ui-accent, #89b4fa)' },
    { key: 'cache', label: 'Cache', value: cache, color: 'var(--ui-warning, #f9e2af)' },
    { key: 'swap', label: 'Swap', value: swapUsed, color: 'var(--ui-danger, #f38ba8)' },
    { key: 'free', label: 'Free', value: free, color: 'var(--ui-surface2, #585b70)' },
  ].filter((item) => item.value > 0 || item.key === 'free');

  return (
    <div style={infoStyles.statRow}>
      <div style={infoStyles.statHeader}>
        <span style={infoStyles.statLabel}>Memory</span>
        <span style={infoStyles.statRight}>
          {memTotal ? `${formatBytes(used)} used · ${formatBytes(cache)} cache${swapTotal ? ` · ${formatBytes(swapUsed)} swap` : ''}` : `${(stats.ram ?? 0).toFixed(1)}%`}
        </span>
      </div>
      <div style={infoStyles.stackTrack}>
        {segments.map((item) => (
          <span
            key={item.key}
            title={`${item.label}: ${formatBytes(item.value)}`}
            style={{
              ...infoStyles.stackSegment,
              width: `${pct(item.value)}%`,
              background: item.color,
              opacity: item.key === 'free' ? 0.45 : 0.95,
            }}
          />
        ))}
      </div>
      <div style={infoStyles.stackLegend}>
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-accent, #89b4fa)' }} />Used</span>
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-warning, #f9e2af)' }} />Cache</span>
        {swapTotal > 0 && <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-danger, #f38ba8)' }} />Swap</span>}
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-surface2, #585b70)' }} />Free</span>
      </div>
    </div>
  );
};

const ProcessList = ({ processes, onRefresh }) => {
  const [pending, setPending] = useState(null); // pid currently sending kill
  const [error, setError] = useState(null);

  const sendKill = useCallback(async (pid, sig) => {
    const label = sig === 'kill' ? 'force kill (SIGKILL)' : 'terminate (SIGTERM)';
    if (!window.confirm(`PID ${pid} — ${label}?`)) return;
    setPending(pid);
    setError(null);
    try {
      const res = await fetch(`/api/system/processes/${pid}/kill`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ signal: sig }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      // 백엔드가 다음 stats 폴링 때 자연스럽게 빠짐. 즉시 한 번 더 당김.
      onRefresh?.();
    } catch (e) {
      setError(`pid ${pid}: ${e.message}`);
    } finally {
      setPending(null);
    }
  }, [onRefresh]);

  return (
    <div style={infoStyles.processBox}>
      <div style={infoStyles.processHeader}>
        <span>Top processes</span>
        <span style={{ textAlign: 'right' }}>CPU · RSS</span>
      </div>
      {error && (
        <div style={infoStyles.processError}>{error}</div>
      )}
      {processes.slice(0, 8).map((proc) => {
        const canKill = proc.is_mine !== false; // 명시적으로 false 가 아니면 시도 허용
        const isPending = pending === proc.pid;
        return (
          <div key={proc.pid} style={infoStyles.processRow}>
            <div style={infoStyles.processMain}>
              <div style={infoStyles.processNameRow}>
                <span style={{ ...infoStyles.processName, color: proc.llm_like ? 'var(--ui-accent)' : 'var(--ui-text)' }}>
                  {proc.name || `pid ${proc.pid}`}
                </span>
                <span style={infoStyles.processMeta}>
                  pid {proc.pid}
                  {proc.user ? ` · ${proc.user}` : ''}
                </span>
              </div>
              <span style={infoStyles.processCmd} title={proc.cmd}>{proc.cmd || `pid ${proc.pid}`}</span>
            </div>
            {proc.llm_like && <span style={infoStyles.processBadge}>LLM</span>}
            <div style={infoStyles.processStats}>
              <span style={infoStyles.processCpu}>{(proc.cpu_percent ?? 0).toFixed(1)}%</span>
              <span style={infoStyles.processMem}>{formatBytes(proc.rss_bytes)}</span>
            </div>
            <div style={infoStyles.processActions}>
              <button
                type="button"
                onClick={() => sendKill(proc.pid, 'term')}
                disabled={!canKill || isPending}
                title={canKill ? 'Terminate (SIGTERM)' : 'Not your process'}
                style={{
                  ...infoStyles.processKillBtn,
                  opacity: !canKill || isPending ? 0.35 : 0.85,
                  cursor: !canKill || isPending ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => { if (canKill && !isPending) { e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-warning, #f9e2af) 24%, transparent)'; e.currentTarget.style.color = 'var(--ui-warning, #f9e2af)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-subtext)'; }}
              >
                <XCircle size={12} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => sendKill(proc.pid, 'kill')}
                disabled={!canKill || isPending}
                title={canKill ? 'Force kill (SIGKILL)' : 'Not your process'}
                style={{
                  ...infoStyles.processKillBtn,
                  opacity: !canKill || isPending ? 0.35 : 0.85,
                  cursor: !canKill || isPending ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => { if (canKill && !isPending) { e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-danger, #f38ba8) 24%, transparent)'; e.currentTarget.style.color = 'var(--ui-danger, #f38ba8)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-subtext)'; }}
              >
                <Zap size={12} strokeWidth={2} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const StatBar = ({ label, percent = 0, right = '' }) => {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const tone =
    safe >= 90 ? 'var(--ui-danger, #f38ba8)'
    : safe >= 75 ? 'var(--ui-warning, #f9e2af)'
    : 'var(--ui-accent, #89b4fa)';
  return (
    <div style={infoStyles.statRow}>
      <div style={infoStyles.statHeader}>
        <span style={infoStyles.statLabel}>{label}</span>
        <span style={infoStyles.statRight}>{right}</span>
      </div>
      <div style={infoStyles.barTrack}>
        <div style={{
          ...infoStyles.barFill,
          width: `${safe}%`,
          background: tone,
          boxShadow: `0 0 12px ${tone}55`,
          transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
    </div>
  );
};

const infoStyles = {
  root: {
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    fontFamily: font.sans,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  sectionTitle: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  sectionSubtitle: {
    marginLeft: 'auto',
    fontSize: '10.5px',
    fontFamily: font.mono,
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '120px',
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    minHeight: '20px',
    fontSize: fontSize['12'],
  },
  rowLabel: {
    flexShrink: 0,
    minWidth: '64px',
    fontSize: '11px',
    letterSpacing: '0.02em',
    color: 'var(--ui-subtext)',
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--ui-text)',
  },
  rowValueText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueMono: {
    fontFamily: font.mono,
    fontSize: '11.5px',
    letterSpacing: 0,
  },
  copyBtn: {
    flexShrink: 0,
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--ui-subtext)',
    padding: 0,
    borderRadius: '3px',
    transition: 'color 120ms',
  },
  note: {
    fontSize: '10.5px',
    color: 'var(--ui-accent)',
    opacity: 0.85,
    lineHeight: 1.4,
    paddingTop: '2px',
  },
  statRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingTop: '2px',
    paddingBottom: '2px',
  },
  statHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['2'],
  },
  statLabel: {
    fontSize: '11px',
    fontWeight: fontWeight.semibold,
    color: 'var(--ui-subtext)',
    letterSpacing: '0.04em',
  },
  statRight: {
    fontFamily: font.mono,
    fontSize: '10.5px',
    color: 'var(--ui-subtext)',
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  barTrack: {
    width: '100%',
    height: '6px',
    background: 'var(--ui-crust)',
    borderRadius: '3px',
    overflow: 'hidden',
    border: '1px solid var(--ui-border)',
  },
  barFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1), background 200ms',
  },
  stackTrack: {
    width: '100%',
    height: '8px',
    display: 'flex',
    gap: '1px',
    background: 'var(--ui-crust)',
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid var(--ui-border)',
  },
  stackSegment: {
    height: '100%',
    minWidth: '1px',
    transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
  stackLegend: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
    fontSize: '9.5px',
    color: 'var(--ui-subtext)',
    fontFamily: font.mono,
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
  },
  legendDot: {
    width: '6px',
    height: '6px',
    borderRadius: '2px',
    display: 'inline-block',
    flexShrink: 0,
  },
  processBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    paddingTop: '3px',
  },
  processHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: '8px',
    padding: '0 6px 2px',
    fontSize: '10px',
    color: 'var(--ui-subtext)',
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  processError: {
    fontSize: '10px',
    color: 'var(--ui-danger, #f38ba8)',
    padding: '3px 6px',
    background: 'color-mix(in srgb, var(--ui-danger, #f38ba8) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-danger, #f38ba8) 35%, transparent)',
    borderRadius: '4px',
    marginBottom: '2px',
  },
  processRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
    alignItems: 'center',
    gap: '6px',
    minHeight: '28px',
    padding: '4px 5px',
    borderRadius: '5px',
    background: 'color-mix(in srgb, var(--ui-surface0) 72%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-border) 46%, transparent)',
  },
  processMain: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  processNameRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    minWidth: 0,
  },
  processName: {
    fontSize: '11px',
    fontWeight: fontWeight.semibold,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  processMeta: {
    fontFamily: font.mono,
    fontSize: '9px',
    color: 'var(--ui-subtext)',
    flexShrink: 0,
    opacity: 0.7,
  },
  processCmd: {
    fontFamily: font.mono,
    fontSize: '9.5px',
    color: 'var(--ui-subtext)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  processBadge: {
    height: '15px',
    padding: '0 5px',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: fontWeight.bold,
    color: 'var(--ui-accent)',
    background: 'color-mix(in srgb, var(--ui-accent) 14%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-accent) 32%, transparent)',
  },
  processStats: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0',
    minWidth: '56px',
    fontFamily: font.mono,
  },
  processCpu: {
    fontSize: '10px',
    color: 'var(--ui-text)',
    fontWeight: fontWeight.semibold,
  },
  processMem: {
    fontSize: '9.5px',
    color: 'var(--ui-subtext)',
  },
  processActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
  },
  processKillBtn: {
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--ui-subtext)',
    padding: 0,
    transition: 'background 0.12s ease, color 0.12s ease',
  },
};

// ─────────────────────────────────────────────────────────────────────────────


export default InfoPanel;
