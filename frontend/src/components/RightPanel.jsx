import { useState, memo, useCallback, useEffect, useRef } from 'react';
import {
  Folder, GitBranch, Palette, X, RefreshCw, ChevronsUp, ChevronsDown, FileText, Trash2,
  Info, Server, Terminal as TerminalIcon, Anchor, Copy, Check, Wifi, KeyRound, HelpCircle,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import FileTree from './FileTree';
import ChangesList from './ChangesList';
import ThemePicker from './common/ThemePicker';
import useGitChanges from '../hooks/useGitChanges';
import RailIconBtn from './common/RailIconBtn';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const PANEL_WIDTH = 260;

const TABS = [
  { id: 'files', icon: Folder, label: 'Files' },
  { id: 'git',   icon: GitBranch, label: 'Git' },
  { id: 'info',  icon: Info,     label: 'Info' },
  { id: 'theme', icon: Palette,   label: 'Theme' },
];

const RightPanel = ({
  activeTabType,    // 'local' | 'host' | null
  activeHostId = null,
  gitContextPath = '',
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
  onRefreshTerminal = null,  // 호출 시 활성 터미널을 통째로 remount (WS 재접속)
  selectedFolderPath = '',
  settings,
  updateSettings,
  /* per-pane 테마 오버라이드 — 이 패널은 한 pane 의 컨텍스트이므로 theme 픽커는 그 pane 에만 적용.
     paneThemeId = 현재 pane 에 실제로 적용된 테마 id (override 없으면 settings.theme).
     onPaneThemeChange(id) — pane 의 themeOverride 를 바꿈. id===settings.theme 면 override 해제. */
  paneThemeId = null,
  onPaneThemeChange = null,
  /* Info 패널 컨텍스트 — pane/tab/host/cwd 메타데이터 묶음. PaneGrid 가 채워서 보냄. */
  paneInfo = null,
  language = 'en',
  t,
  viewportHeight,
  disabled = false,  // 빈 pane 일 때 활동바만 표시 / 클릭 무효
  terminalKey = null, // window.terminalSessions[key] lookup — 페이지 업/다운 송신용
  paneCwd = null,     // 호스트 모드 FileTree 시작 경로 (없으면 host.start_path)
  onScreenDump = null, // 텍스트 덤프 모달 열기 콜백 (App.jsx 가 처리)
  onCloseTerminal = null, // pane 닫기 — 단일 pane 이면 closePane 이 closeTab 으로 위임
}) => {
  // 페이지 단위 스크롤 — 모바일에서는 물리 PgUp/PgDn 키가 없어서 가장 자주
  // 막히는 동작. xterm.js 의 viewport 를 직접 스크롤 (tmux scrollback 와는
  // 별개의 클라이언트 버퍼) 해 즉시 반응.
  const sendScroll = useCallback((pages) => {
    const sess = terminalKey ? window.terminalSessions?.[terminalKey] : null;
    sess?.scrollPages?.(pages);
  }, [terminalKey]);

  const handleDump = useCallback(() => {
    const sess = terminalKey ? window.terminalSessions?.[terminalKey] : null;
    const text = sess?.getBufferText?.(true) || '';
    onScreenDump?.(text);
  }, [terminalKey, onScreenDump]);
  const [activePanel, setActivePanel] = useState(null); // null | 'files' | 'git' | 'theme'
  const panelRef = useRef(null);
  // 패널 열릴 때 자동 포커스 → ESC 한 방으로 닫기 가능. 사용자가 패널 안 입력 (검색 등) 으로
  // 옮겨가면 그 요소에 포커스 위임되고, 빈 영역 클릭하면 다시 컨테이너로 돌아감.
  useEffect(() => {
    if (activePanel && panelRef.current) panelRef.current.focus();
  }, [activePanel]);
  const onPanelKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setActivePanel(null);
    }
  };

  // Git 변경 카운트 — 활동 바 뱃지에 표시. 경로 없으면 fetch 안 함 (전체 워크스페이스 집계 X).
  const { items: gitItems } = useGitChanges({
    enabled: !!gitContextPath && activeTabType === 'local',
    path: gitContextPath,
    intervalMs: 4000,
  });
  const gitCount = gitContextPath ? (gitItems || []).length : 0;

  const togglePanel = (id) => {
    setActivePanel((prev) => (prev === id ? null : id));
  };

  return (
    <div style={styles.root}>
      {/* content panel — absolute overlay (활동바 우측 → 본문 위로 떠서 터미널 폭 안 밀어냄) */}
      {activePanel && !disabled && (
        <div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          style={{
            ...styles.panel,
            width: `${PANEL_WIDTH}px`,
            position: 'absolute',
            top: 0,
            right: '36px',  // 활동바 폭만큼 띄움
            bottom: 0,
            zIndex: 10,
            boxShadow: '-4px 0 16px rgba(0,0,0,0.35)',
            outline: 'none', // tabIndex=-1 의 focus ring 제거
          }}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>
              {TABS.find((t) => t.id === activePanel)?.label}
            </span>
            <button
              style={styles.closeBtn}
              onClick={() => setActivePanel(null)}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
          <div style={styles.panelBody}>
            {activePanel === 'files' && (
              <FileTree
                /* host 면 paneCwd 가 트리의 시작 절대경로. local 은 paneCwd(탭 cwd) 가 있으면
                   그 디렉토리를 트리 루트로 — 워크스페이스 전체가 아니라 프로젝트 단위로 좁힘. */
                key={`${activeHostId || 'local'}:${activeHostId ? (paneCwd || 'home') : (paneCwd || gitContextPath || selectedFolderPath || 'root')}`}
                hostId={activeHostId}
                onFileSelect={onFileSelect}
                onFolderSelect={onFolderSelect}
                onOpenTerminalAtFolder={onOpenTerminalAtFolder}
                gitContextPath={gitContextPath}
                language={language}
                initialPath={activeHostId ? (paneCwd || '') : (paneCwd || gitContextPath || selectedFolderPath)}
              />
            )}
            {activePanel === 'git' && (
              <ChangesList
                gitContextPath={gitContextPath}
                onSelectFile={onFileSelect}
                onOpenFile={onFileSelect}
                t={t}
              />
            )}
            {activePanel === 'theme' && (
              <ThemeSettings
                paneThemeId={paneThemeId || settings.theme}
                globalThemeId={settings.theme}
                onPaneThemeChange={onPaneThemeChange}
                t={t}
              />
            )}
            {activePanel === 'info' && (
              <InfoPanel
                info={paneInfo}
                paneThemeId={paneThemeId}
                globalThemeId={settings.theme}
                t={t}
              />
            )}
          </div>
        </div>
      )}

      {/* activity bar — floating overlay. 터미널이 rail 뒤로 깔려 가로 공간 회수.
          close 는 우상단 (파괴적이라 가장 멀리), 주 네비는 그 아래. */}
      <div style={styles.activityBar}>
        {/* 1군: close — 항상 동작 (disabled 영향 안 받음). 우상단. */}
        {onCloseTerminal && (
          <RailIconBtn
            icon={Trash2}
            onClick={onCloseTerminal}
            title={t?.('closeTerminal') || 'Close terminal'}
            tone="danger"
          />
        )}

        {onCloseTerminal && <div style={styles.divider} />}

        {/* 2군: 주 네비 — 빈 pane 일 땐 흐리게 + 클릭 무시. */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          opacity: disabled ? 0.4 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
        }}>
          {TABS.map(({ id, icon: Icon, label }) => {
            const isActive = activePanel === id;
            const badge = id === 'git' && gitCount > 0 ? gitCount : null;
            return (
              <RailIconBtn
                key={id}
                icon={Icon}
                onClick={() => !disabled && togglePanel(id)}
                title={badge ? `${label} (${badge})` : label}
                active={isActive}
                disabled={disabled}
                badge={badge}
              />
            );
          })}

          {!disabled && terminalKey && (
            <>
              <div style={styles.divider} />
              <RailIconBtn icon={ChevronsUp}   onClick={() => sendScroll(-1)} title={t?.('pageUp')   || 'Page up'} />
              <RailIconBtn icon={ChevronsDown} onClick={() => sendScroll(1)}  title={t?.('pageDown') || 'Page down'} />
              <RailIconBtn icon={FileText}     onClick={handleDump}           title={t?.('viewAsText') || 'View as text (free select)'} />
            </>
          )}

          {onRefreshTerminal && !disabled && (
            <>
              <div style={styles.divider} />
              <RailIconBtn icon={RefreshCw} onClick={onRefreshTerminal} title={t?.('refreshTerminal') || 'Reload terminal'} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ThemeSettings = memo(({ paneThemeId, globalThemeId, onPaneThemeChange, t }) => {
  const effectiveId = paneThemeId || globalThemeId;
  const isOverridden = !!paneThemeId && !!globalThemeId && paneThemeId !== globalThemeId;

  return (
    <div style={{ padding: space['3'], display: 'flex', flexDirection: 'column', gap: space['4'] }}>
      <Field
        label={t?.('theme') || 'Theme'}
        hint={
          isOverridden
            ? (t?.('themePerPaneOverride') || 'This terminal only — global theme is unchanged.')
            : (t?.('themePerPaneHint') || 'Applies to this terminal only. Global theme lives in Settings.')
        }
        action={
          isOverridden && onPaneThemeChange ? (
            <button
              type="button"
              onClick={() => onPaneThemeChange(globalThemeId)}
              style={{
                background: 'transparent',
                border: `1px solid ${color.border}`,
                color: color.subtext,
                fontSize: fontSize['11'],
                fontFamily: font.sans,
                padding: '2px 8px',
                borderRadius: radius.xs,
                cursor: 'pointer',
              }}
              title={t?.('resetToGlobalTheme') || 'Reset to global theme'}
            >
              {t?.('reset') || 'Reset'}
            </button>
          ) : null
        }
      >
        <ThemePicker
          value={effectiveId}
          onChange={onPaneThemeChange}
          t={t}
          markedId={globalThemeId}
        />
      </Field>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Info 패널 — 세션 메타데이터 + 시스템 자원(CPU/RAM/Disk/Load).
// 자원 정보는 패널이 *열려 있는 동안만* 2초 polling. 닫으면 즉시 멈춤.

const useSystemStats = (enabled) => {
  const [stats, setStats] = useState(null);
  const intervalRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let aborted = false;
    const fetchOnce = async () => {
      try {
        const token = (typeof localStorage !== 'undefined' && localStorage.getItem('auth_token')) || '';
        const res = await fetch('/api/system/stats', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!aborted) setStats(data);
      } catch {
        /* 일시적 실패 — 다음 tick 에서 다시 시도 */
      }
    };
    fetchOnce();
    intervalRef.current = setInterval(fetchOnce, 2000);
    return () => {
      aborted = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]);
  return stats;
};

const formatBytes = (n) => {
  if (n == null || isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatUptime = (s) => {
  if (s == null) return '—';
  const sec = Math.floor(s);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const InfoPanel = memo(({ info, paneThemeId, globalThemeId, t }) => {
  const stats = useSystemStats(true);
  const themeOverridden = !!paneThemeId && !!globalThemeId && paneThemeId !== globalThemeId;
  const activeThemeId = paneThemeId || globalThemeId;
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
    : (info?.paneCwdRel ? `~/${info.paneCwdRel}` : '—');

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
      <style>{`.iterm-info-section + .iterm-info-section { border-top: 1px solid ${color.border}; }`}</style>
      {/* 세션 */}
      <InfoSection title={t?.('infoSession') || 'Session'} icon={TerminalIcon}>
        <InfoRow label={t?.('infoTabName') || 'Tab'} value={info?.tabName || '—'} mono={false} />
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
        {info?.tmuxSessionName && (
          <InfoRow
            label={t?.('infoTmuxSession') || 'tmux session'}
            value={info.tmuxSessionName}
            copyable
            onCopy={() => handleCopy('tmux', info.tmuxSessionName)}
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
      >
        <StatBar
          label="CPU"
          percent={stats?.cpu ?? 0}
          right={stats?.cpu_count ? `${(stats?.cpu ?? 0).toFixed(1)}% · ${stats.cpu_count} cores` : `${(stats?.cpu ?? 0).toFixed(1)}%`}
        />
        <StatBar
          label="RAM"
          percent={stats?.ram ?? 0}
          right={stats?.mem_total
            ? `${formatBytes(stats.mem_used)} / ${formatBytes(stats.mem_total)}`
            : `${(stats?.ram ?? 0).toFixed(1)}%`}
        />
        <StatBar
          label="Disk"
          percent={stats?.disk ?? 0}
          right={stats?.disk_total
            ? `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)}`
            : `${(stats?.disk ?? 0).toFixed(1)}%`}
        />
        {Array.isArray(stats?.load_avg) && stats.load_avg.length === 3 && (
          <InfoRow
            label="Load"
            value={stats.load_avg.map((x) => x.toFixed(2)).join(' · ')}
          />
        )}
        {stats?.uptime != null && (
          <InfoRow
            label={t?.('infoUptime') || 'Uptime'}
            value={formatUptime(stats.uptime)}
            mono={false}
          />
        )}
      </InfoSection>

      {/* 키보드/마우스 컨벤션 — tmux mouse on 환경의 표준이지만 사용자가 매번 외우긴 어려워 노출. */}
      <InfoSection title={t?.('infoShortcuts') || 'Shortcuts'} icon={HelpCircle}>
        <ShortcutRow keys={[t?.('drag') || 'Drag']}            desc={t?.('shortcutSelect')    || 'Select text (auto-copy)'} />
        <ShortcutRow keys={[t?.('doubleClick') || 'Double-click']} desc={t?.('shortcutSelectWord') || 'Select word'} />
        <ShortcutRow keys={[t?.('tripleClick') || 'Triple-click']} desc={t?.('shortcutSelectLine') || 'Select line'} />
        <ShortcutRow keys={['Ctrl', 'V']}                       desc={t?.('shortcutPaste')     || 'Paste (bracketed)'} />
        <ShortcutRow keys={[t?.('rightClick') || 'Right-click']} desc={t?.('shortcutPaste')     || 'Paste (bracketed)'} />
        <ShortcutRow keys={['Ctrl', 'Shift', 'C']}              desc={t?.('shortcutCopy')      || 'Copy selection'} />
        <ShortcutRow keys={[t?.('wheel') || 'Wheel']}            desc={t?.('shortcutScroll')   || 'Scroll (auto copy-mode)'} />
        <ShortcutRow keys={['Ctrl', 'C']}                       desc={t?.('shortcutSigint')    || 'Interrupt (SIGINT)'} />
        <ShortcutRow keys={['Ctrl', 'Shift', 'F']}              desc={t?.('shortcutSearch')    || 'Find in terminal'} />
        <ShortcutRow keys={['F12']}                             desc={t?.('shortcutDevtools')  || 'Open DevTools'} />
      </InfoSection>
    </div>
  );
});

const ShortcutRow = memo(({ keys, desc }) => (
  <div style={shortcutStyles.row}>
    <div style={shortcutStyles.keys}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} style={shortcutStyles.kbd}>{k}</span>
      ))}
    </div>
    <div style={shortcutStyles.desc}>{desc}</div>
  </div>
));

const shortcutStyles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['2'],
    padding: `${space['1']} 0`,
    minHeight: 22,
  },
  keys: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  kbd: {
    fontFamily: font.mono,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    color: color.text,
    background: color.surface1,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: '1px 5px',
    lineHeight: 1.4,
  },
  desc: {
    fontSize: fontSize['11'],
    color: color.subtext,
    textAlign: 'right',
    lineHeight: 1.35,
  },
};

const InfoSection = ({ title, icon: Icon, subtitle = null, children }) => (
  <div className="iterm-info-section" style={infoStyles.section}>
    <div style={infoStyles.sectionHeader}>
      {Icon && <Icon size={11} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />}
      <span style={infoStyles.sectionTitle}>{title}</span>
      {subtitle && <span style={infoStyles.sectionSubtitle}>{subtitle}</span>}
    </div>
    <div style={infoStyles.sectionBody}>
      {children}
    </div>
  </div>
);

const InfoRow = ({ label, value, mono = true, accent = false, copyable = false, onCopy, copied = false, icon: Icon = null }) => (
  <div style={infoStyles.row}>
    <span style={infoStyles.rowLabel}>{label}</span>
    <span style={{
      ...infoStyles.rowValue,
      ...(mono ? infoStyles.rowValueMono : null),
      color: accent ? color.accent : color.text,
    }}>
      {Icon && <Icon size={10} strokeWidth={2} style={{ marginRight: '4px', opacity: 0.7 }} />}
      <span style={infoStyles.rowValueText} title={typeof value === 'string' ? value : undefined}>{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          style={infoStyles.copyBtn}
          title="Copy"
          onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = color.muted; }}
        >
          {copied ? <Check size={10} strokeWidth={2.4} /> : <Copy size={10} strokeWidth={2} />}
        </button>
      )}
    </span>
  </div>
);

const StatBar = ({ label, percent = 0, right = '' }) => {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const tone =
    safe >= 90 ? color.danger
    : safe >= 75 ? color.warning
    : color.accent;
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
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  sectionSubtitle: {
    marginLeft: 'auto',
    fontSize: '10.5px',
    color: color.muted,
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
    color: color.muted,
    fontSize: '11px',
    letterSpacing: '0.02em',
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: color.text,
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
    color: color.muted,
    padding: 0,
    borderRadius: '3px',
    transition: 'color 120ms',
  },
  note: {
    fontSize: '10.5px',
    color: color.accent,
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
    color: color.subtext,
    letterSpacing: '0.04em',
  },
  statRight: {
    fontFamily: font.mono,
    fontSize: '10.5px',
    color: color.muted,
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  barTrack: {
    width: '100%',
    height: '6px',
    background: color.crust,
    borderRadius: '3px',
    overflow: 'hidden',
    border: `1px solid ${color.border}`,
  },
  barFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1), background 200ms',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const Field = ({ label, hint = null, action = null, children }) => (
  <div>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space['2'],
      marginBottom: hint ? '4px' : space['2'],
    }}>
      <div style={{
        fontSize: fontSize['11'],
        fontWeight: fontWeight.semibold,
        color: color.subtext,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
      }}>
        {label}
      </div>
      {action}
    </div>
    {hint && (
      <div style={{
        fontSize: '11px',
        color: color.muted,
        marginBottom: space['2'],
        lineHeight: 1.4,
      }}>
        {hint}
      </div>
    )}
    {children}
  </div>
);

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    flexShrink: 0,
    position: 'relative',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    borderLeft: `1px solid ${color.border}`,
    background: color.base,
    overflow: 'hidden',
    fontFamily: font.sans,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  panelTitle: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: color.subtext,
    padding: '3px',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
  },
  panelBody: {
    flex: 1,
    overflow: 'auto',
  },
  activityBar: {
    width: '36px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: '2px',
    paddingBottom: '2px',
    gap: '0px',
    background: color.mantle,
    borderLeft: `1px solid ${color.border}`,
  },
  divider: {
    alignSelf: 'stretch',
    height: '1px',
    background: color.border,
    margin: '4px 0',
  },
};

export default RightPanel;
