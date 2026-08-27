import { useState, memo, useMemo, useRef, useEffect } from 'react';
import {
  Server, Monitor, Plus, Settings as SettingsIcon, FolderOpen, Download,
  Link2, BarChart3, ScreenShare, RefreshCw, Activity,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import useConnectedRemotes from '../hooks/useConnectedRemotes';
import useRemoteInstall from '../hooks/useRemoteInstall';
import HostIcon from '../utils/hostIcons';
import HomeSessions from './HomeSessions';
import FleetBoard from './home/FleetBoard';
import FirstRunGuide from './home/FirstRunGuide';
import useFleet from '../hooks/useFleet';
import useHostReorder from '../hooks/useHostReorder';
import LlmDashboard from './llm/LlmDashboard';
import TerminalTiles from './llm/TerminalTiles';
import DashboardSkeleton, { RangeSkeleton } from './llm/DashboardSkeleton';
import useTerminalUsage from '../hooks/useTerminalUsage';
import SkeletonRow from './common/SkeletonRow';
import { LLM_USAGE_CHANGED_EVENT, LLM_USAGE_BUSY_EVENT } from '../utils/llmUsageBus';
import { themes, defaultTheme } from '../styles/themes';
import { canvasTexture, canvasWash } from '../styles/textures';
import { segmentedTrackStyle, segmentedItemStyle, applySegmentedHover } from '../styles/segmented';

const { color, font, fontSize, fontWeight, radius, space } = tokens;


// 정렬 순서는 서버 hosts.sort_index 가 SSoT. useHostReorder 훅이 옵티미스틱 관리.

// Termius 풍 가로 카드 — 폭이 넓어지면 한 줄에 여러개, 좁아지면 한 줄로 stack.
/* 백엔드가 허용하는 창(0=전체)과 같은 목록 — 여기서만 늘리면 조용히 30일로 떨어진다. */
const RANGES = [[7], [30], [90], [0]];
const CARD_MIN_WIDTH = 260;
const CARD_GAP = 8;
const CONTENT_PADDING = 40; // 좌우 padding 합 (root padding ${space['5']}=20px*2)
const MAX_COLUMNS = 3;

const HomeDashboard = ({
  hosts = [],
  // Host list not in yet — fill the card slots with skeletons during the first fetch.
  hostsLoading = false,
  localCard,
  settings = {},
  onOpenHost,
  onOpenHostAtPath,
  onOpenVnc,
  showLocalVnc = false,
  onAddHost,
  onEditHost,
  onDeleteHost,
  onOpenSettings,
  onEditLocal,
  onPickLocalPath,
  // 영속 세션 카드용 (옵셔널 — 미공급 시 섹션 미표시)
  tabs = [],
  busyTabIds = null,
  onJumpTab,
  // LLM 사용량 카드에서 세션 → 살아있는 pane 으로 점프할 때. (tabId, paneId) => void
  onJumpPane = null,
  onResumeHostSession,
  onTerminateHostSession,
  onConfirm,
  onNotify,
  // embedded=true 면 부모 안에 끼워 쓰는 모드 — root 의 height: 100% 를 풀어
  // 콘텐츠 높이만 차지하게 한다 (분할 pane 의 빈 슬롯에서 미러 picker 와 같이 stack 가능).
  embedded = false,
  refreshHosts = null,
  refreshSignal = 0,
  // 홈이 실제 사용자에게 보이는지 — false 면 HomeSessions 의 SSH tmux 조회를 스킵.
  isVisible = true,
  // 사용 통계 카드 — 빈 패널/홈 양쪽 동일하게 보여주기 위해 옵션. 기본 켜둠.
  showUsageStats = true,
  // EmptyPane 모드에서 다른 탭 흡수 섹션을 위에 끼우고 싶을 때 — 노드 그대로 받아 렌더.
  extraTopSlot = null,
  t,
}) => {
  /* 어느 호스트에 리모트가 붙어 있나 — **한 번의 요청**이다(SSH 0회).
     호스트마다 물으면 그 자체로 SSH 가 카드 수만큼 곱해진다. */
  const { connected: connectedRemotes, refresh: refreshRemotes } = useConnectedRemotes(true);
  const remoteInstall = useRemoteInstall(refreshRemotes);
  const [hoverId, setHoverId] = useState(null);
  // 'connections' | 'dashboard' — 홈에 오는 이유의 대부분은 연결이라 기본은 그쪽.
  const [view, setView] = useState('connections');
  /* 기간은 **카드 위 한 줄**에 둔다 — 카드마다 따로 두면 "7일 카드 옆의 30일 카드" 가
     되어 같은 화면에서 서로 다른 창을 비교하게 된다. 백엔드 화이트리스트와 같은 값. */
  const [rangeDays, setRangeDays] = useState(7);
  /* 갱신 중 표시 — 실제로 도는 곳은 LlmDashboard 라 이벤트로 받는다. 눌렀는데
     아무것도 안 움직이면 눌린 줄 모른다. */
  /* The home fetches the stats — if only the cards below knew, the head (the range switch)
     would stand finished above an empty body and the page would look half-drawn. Loading
     has to be one piece. */
  const { data: usage, loading: usageLoading } = useTerminalUsage(rangeDays || 90);
  /* Only polls while the home is the thing on screen — every refresh is one SSH round
     trip per remote host, so a board nobody is looking at would keep every machine busy
     for nothing. The connections view is the only place it is drawn. */
  /* Its own tab, not a block on the connections screen. With a dozen panes open the
     board is longer than everything above it, and the thing people come home for is
     "where do I connect" — that must not scroll away. */
  const views = [
    ['connections', t?.('terminals') || 'Terminals', Link2],
    ['fleet', t?.('processesTab') || 'Running', Activity],
    ...(showUsageStats ? [['dashboard', t?.('dashboard') || 'Dashboard', BarChart3]] : []),
  ];
  const fleet = useFleet(isVisible && view === 'fleet');
  /* The board addresses panes the way `itl list` does (tab.pane, 1-based); jumping needs
     the real ids, and this component is the one holding the tab list. */
  const handleFleetOpen = (target) => {
    const tab = tabs[(target?.tabIndex || 0) - 1];
    if (!tab) return;
    if (target.paneId && onJumpPane) onJumpPane(tab.id, target.paneId);
    else onJumpTab?.(tab.id);
  };
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  useEffect(() => {
    const onBusy = (e) => {
      const busy = !!e?.detail?.busy;
      const failed = e?.detail?.failed;
      // 사용자가 직접 누른 갱신이 끝났을 때만 알린다. 백그라운드 수집까지 알리면
      // 아무 것도 안 했는데 토스트가 뜬다.
      if (refreshingRef.current && !busy && failed?.length) {
        onNotify?.({
          type: 'info',
          message: `${failed.join(', ')} — ${t?.('llmHostUnreadable') || 'could not be read'}`,
        });
      }
      refreshingRef.current = busy;
      setRefreshing(busy);
    };
    window.addEventListener(LLM_USAGE_BUSY_EVENT, onBusy);
    return () => window.removeEventListener(LLM_USAGE_BUSY_EVENT, onBusy);
  }, [onNotify, t]);
  // 서버 sort_index 가 SSoT. useHostReorder 가 옵티미스틱 reorder + persist + refresh 통합 처리.
  const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);

  const rootRef = useRef(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const calc = () => {
      const avail = el.clientWidth - CONTENT_PADDING;
      const fits = (n) => n * CARD_MIN_WIDTH + (n - 1) * CARD_GAP;
      let n = 1;
      for (let candidate = MAX_COLUMNS; candidate >= 1; candidate -= 1) {
        if (avail >= fits(candidate)) { n = candidate; break; }
      }
      setColumns(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* The home is a "screen": a wash lit from the top, scanlines over it, cards on top of
     those. **The lines belong to the screen, not to the cards.** Printed across a card they
     put a pattern on the numbers; the cards are glass instead, so the lines pass through
     blurred and that blur is what reads as "behind the glass". Themes that refuse texture
     ('flat', e-ink) get neither. */
  const backdrop = useMemo(() => {
    const theme = themes[settings.theme] || themes[defaultTheme];
    const wash = canvasWash(theme);
    const lines = canvasTexture(theme);
    return [lines, wash].filter(Boolean).join(', ') || null;
  }, [settings.theme]);

  return (
    <div
      ref={rootRef}
      style={{
        ...styles.root,
        ...(backdrop ? { backgroundImage: backdrop } : null),
        ...(embedded ? { height: 'auto', overflow: 'visible' } : null),
      }}
    >
      <div style={styles.inner}>
        {/* 연결 / 대시보드 — 홈이 하나의 긴 스크롤이면 정작 자주 쓰는 연결이 통계 아래로
            밀린다. 둘은 목적이 다르다: 하나는 "어디에 붙지", 하나는 "얼마나 썼지".
            기본은 연결 — 홈에 오는 이유의 대부분이다. */}
        {views.length > 1 && (
          <div style={styles.viewSwitch}>
            {views.map(([key, label, Icon]) => {
              const isOn = view === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  style={segmentedItemStyle({ active: isOn })}
                  onMouseEnter={(e) => {
                    if (!isOn) applySegmentedHover(e.currentTarget, true);
                  }}
                  onMouseLeave={(e) => {
                    if (!isOn) applySegmentedHover(e.currentTarget, false);
                  }}
                >
                  <Icon size={12} strokeWidth={2.2} />
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {view === 'fleet' ? (
          /* No section heading here — the tab above already carries the name, and saying
             it twice was the first thing anyone noticed about this screen. */
          <FleetBoard
            targets={fleet.targets}
            machines={fleet.machines}
            hosts={hosts}
            loading={fleet.loading}
            error={fleet.error}
            onRefresh={fleet.refresh}
            onOpen={handleFleetOpen}
            t={t}
          />
        ) : view === 'dashboard' ? (
          /* 대시보드 = 터미널 사용량(항상) + LLM(쓸 때만). 위의 범위 한 줄이 둘 다
             좁힌다 — 카드마다 기간을 두면 한 화면에서 7일과 30일을 비교하게 된다. */
          <>
            <div style={styles.dashHead}>
              {/* During the first fetch the range switch is a skeleton too. Sharp above an
                  empty screen it reads as "this part finished loading", not "you may choose".
                  (With a warm cache the first render already has data and this never shows.) */}
              {usageLoading && !usage ? <RangeSkeleton /> : (
              <div style={styles.rangeRow}>
                {RANGES.map(([value]) => {
                  const isOn = rangeDays === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRangeDays(value)}
                      style={segmentedItemStyle({ active: isOn, compact: true })}
                      onMouseEnter={(e) => {
                        if (!isOn) applySegmentedHover(e.currentTarget, true);
                      }}
                      onMouseLeave={(e) => {
                        if (!isOn) applySegmentedHover(e.currentTarget, false);
                      }}
                    >
                      {value === 0
                        ? (t?.('rangeAll') || 'All')
                        : (t?.('rangeNDays') || '{n}d').replace('{n}', String(value))}
                    </button>
                  );
                })}
              </div>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                title={t?.('refresh') || 'Refresh'}
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true);   // 낙관적 — 이벤트가 돌아오기 전에도 즉시 반응한다
                  refreshingRef.current = true;
                  try { window.dispatchEvent(new CustomEvent(LLM_USAGE_CHANGED_EVENT)); } catch { /* no window */ }
                }}
                style={{ ...styles.dashRefresh, opacity: refreshing ? 0.6 : 1 }}
              >
                <RefreshCw
                  size={13}
                  strokeWidth={2}
                  className={refreshing ? 'dc-spin' : undefined}
                />
              </button>
            </div>

            {/* 터미널 사용량도 LLM 숫자와 같은 타일·같은 막대 — 한 대시보드다. */}
            {usage
              ? <TerminalTiles hosts={hosts} settings={settings} data={usage} t={t} />
              : <DashboardSkeleton />}

            <LlmDashboard
              hosts={hosts}
              tabs={tabs}
              settings={settings}
              days={rangeDays}
              onJumpPane={onJumpPane}
              onConfirm={onConfirm}
              onNotify={onNotify}
              t={t}
            />
          </>
        ) : (
        <>
        {/* 1) 호스트 카드 — 탭 열기가 핵심 흐름이므로 가장 위.
            소제목은 달지 않는다: 위의 전환 탭이 이미 "연결" 이라고 말했고, 같은 말을
            두 줄 연속으로 하면 크롬만 늘어난다. 전환 탭이 없는 컨텍스트
            (showUsageStats=false, 예전 임베드 모드)에서만 소제목을 단다. */}
        <Section icon={Link2} title={showUsageStats ? null : (t?.('connections') || 'Connections')}>
          <div style={{
            display: 'grid',
            gap: `${CARD_GAP}px`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}>
            {/* 명시적으로 localCard={null} 일 때만 카드 숨김 — undefined 는 기존 동작(기본값으로 렌더). */}
            {localCard !== null && (
              <HostRow
                id="local"
                draggable={false}
                icon={<HostIcon value={localCard?.icon || ''} fallback={Monitor} size={20} />}
                name={localCard?.name || (t?.('thisMachine') || 'This machine')}
                subtitle={
                  <>
                    <span style={styles.subLine}>localhost</span>
                    <span style={{ ...styles.subLine, color: (localCard?.startPath || '').trim() ? color.subtext : color.faint }}>
                      {(localCard?.startPath || '').trim() || (t?.('noStartPath') || 'No start path')}
                    </span>
                  </>
                }
                accentColor={localCard?.accent || color.accent}
                isHovered={hoverId === 'local'}
                onHover={setHoverId}
                onClick={() => onOpenHost({ id: 'local', isLocal: true })}
                onEdit={onEditLocal || null}
                editTitle={t?.('editLocalMachine') || 'Edit this machine'}
                onPickPath={onPickLocalPath || null}
                pickPathTitle={t?.('openAtPath') || 'Open at path…'}
                /* 로컬도 원격 데스크톱을 쓸 수 있다 — 백엔드가 도는 기계라 SSH 터널 없이
                   루프백에 바로 붙는다(가장 짧은 경로). 단 이 배포에 VNC 가 실제로
                   있을 때만 노출한다(showLocalVnc) — 컨테이너 배포처럼 없는 환경에서는
                   버튼 자체가 뜨지 않아야 한다. */
                onOpenVnc={(onOpenVnc && showLocalVnc) ? () => onOpenVnc({ id: 'local', isLocal: true, name: localCard?.name || 'local' }) : null}
                openVncTitle={t?.('remoteDesktop') || 'Remote desktop'}
              />
            )}

            {/* First fetch — hold the slots at the real size. Cards dropping into an empty
                screen look freshly created rather than late. */}
            {hostsLoading && orderedHosts.length === 0 && (
              [0, 1, 2].map((i) => <HostRowSkeleton key={`skel-${i}`} />)
            )}
            {orderedHosts.map((host) => {
              const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
              return (
                <HostRow
                  key={host.id}
                  id={host.id}
                  {...rowPropsFor(host)}
                  icon={<HostIcon value={host.icon || ''} fallback={Server} size={20} />}
                  name={host.name}
                  subtitle={
                    <>
                      <span style={styles.subLine}>{host.ssh_user}@{host.hostname}{host.port && host.port !== 22 ? `:${host.port}` : ''}</span>
                      <span style={{ ...styles.subLine, color: host.start_path ? color.subtext : color.faint }}>
                        {host.start_path || (t?.('noStartPath') || 'No start path')}
                      </span>
                    </>
                  }
                  accentColor={accent}
                  isHovered={hoverId === host.id}
                  onHover={setHoverId}
                  onClick={() => onOpenHost(host)}
                  onEdit={() => onEditHost?.(host)}
                  editTitle={t?.('hostSettings') || 'Host settings'}
                  onPickPath={onOpenHostAtPath ? () => onOpenHostAtPath(host) : null}
                  pickPathTitle={t?.('openAtPath') || 'Open at path…'}
                  onOpenVnc={onOpenVnc ? () => onOpenVnc(host) : null}
                  openVncTitle={t?.('remoteDesktop') || 'Remote desktop'}
                  remoteState={connectedRemotes[host.id] ? 'on' : 'off'}
                  remoteBusy={remoteInstall.busyHostId === host.id}
                  remoteFailed={remoteInstall.failedHostId === host.id}
                  remoteOnTitle={t?.('remoteConnectedShort') || '리모트 연결됨'}
                  remoteOffTitle={t?.('remoteWhyInstall')
                    || '리모트 미설치 — 눌러서 설치합니다. 깔면 이 호스트의 에이전트가 끝났을 때 텔레그램·푸시 알림이 오고, 다른 터미널에서 이 호스트로 명령을 보낼 수 있습니다.'}
                  onInstallRemote={() => remoteInstall.install(host.id)}
                  remoteOffLabel={t?.('remoteNotInstalledChip') || '리모트 미설치'}
                  remoteBusyLabel={t?.('remoteInstalling') || '설치 중…'}
                  remoteFailedLabel={t?.('remoteInstallFailed') || '설치 실패'}
                />
              );
            })}

            <EmptyRow onClick={onAddHost} t={t} />
          </div>
        </Section>

        {/* 2) 지금 무엇이 돌고 있나 — 기계를 가로질러 한 판에. 이 앱의 작업은 여러
               기계에 흩어져 있는데, pane 을 열기 전에는 그것을 볼 방법이 없었다. */}
        {/* Only while there is nothing yet — it vanishes the moment a host exists, so it
            never becomes clutter for someone who already knows the app. */}
        {hosts.length === 0 && !hostsLoading && (
          <Section>
            <FirstRunGuide t={t} />
          </Section>
        )}

        {/* 2) (EmptyPane 모드 전용) 다른 탭 흡수. 부모가 노드 통째로 넘김. */}
        {extraTopSlot}

        {/* 3) Open / Resumable 세션 — HomeSessions 가 자체 Open / Resumable 그룹 헤더를 렌더. */}
        {(tabs.length > 0 || hosts.some((h) => h.use_remote_tmux)) && (
          <HomeSessions
            tabs={tabs}
            hosts={hosts}
            busyTabIds={busyTabIds}
            onJumpTab={onJumpTab}
            onResumeHostSession={onResumeHostSession}
            onTerminateHostSession={onTerminateHostSession}
            onConfirm={onConfirm}
            onNotify={onNotify}
            refreshSignal={refreshSignal}
            isVisible={isVisible}
            t={t}
          />
        )}

        {/* 통계는 대시보드 화면으로 옮겼다 — 연결 화면은 붙는 일에만 집중한다.
            showUsageStats 가 꺼진 컨텍스트에서는 전환 탭 자체가 없어 여기가 전부다. */}
        {showUsageStats ? null : null}
        </>
        )}
      </div>
    </div>
  );
};

const Section = ({ icon: Icon, title, children }) => (
  <div style={styles.section}>
    {/* title 이 없으면 머리도 없다 — 빈 제목 줄이 남으면 그게 더 눈에 띈다. */}
    {title && (
      <div style={styles.sectionHead}>
        {Icon && <Icon size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />}
        <span style={styles.title}>{title}</span>
      </div>
    )}
    <div>{children}</div>
  </div>
);

/** Slot for a host card — same height and layout as the real one (icon, name, subtitle). */
const HostRowSkeleton = () => (
  <div style={{ ...styles.row, cursor: 'default' }} aria-busy="true">
    <SkeletonRow width="40px" height="40px" borderRadius={radius.md} style={{ flexShrink: 0 }} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
      <SkeletonRow width="52%" height="11px" />
      <SkeletonRow width="72%" height="9px" />
    </div>
  </div>
);

export const HostRow = memo(({
  remoteState = null,      // 'on' | 'off' | null(로컬·판단불가)
  remoteBusy = false,
  remoteFailed = false,
  onInstallRemote = null,
  id, icon, name, subtitle, accentColor,
  leadingBadge = null,
  isHovered, isDragging, isDragOver,
  remoteOnTitle = '', remoteOffTitle = '',
  remoteOffLabel = '', remoteBusyLabel = '', remoteFailedLabel = '',
  onHover, onClick, onEdit, editTitle,
  onPickPath, pickPathTitle,
  onOpenVnc, openVncTitle,
  // useHostReorder.rowPropsFor 가 spread 로 보내는 것들: data-host-row, onPointerDown, isDragging, isDragOver.
  ...rest
}) => (
  <div
    data-host-row={rest['data-host-row'] || undefined}
    onPointerDown={rest.onPointerDown}
    onMouseEnter={() => onHover?.(id)}
    onMouseLeave={() => onHover?.(null)}
    onClick={onClick}
    style={{
      ...styles.row,
      background: isDragging
        ? color.surface2
        : (isDragOver ? color.surface2 : (isHovered ? color.surface1 : color.surface0)),
      borderColor: isDragging
        ? color.accent
        : (isDragOver ? color.accent : color.border),
      borderStyle: isDragOver && !isDragging ? 'dashed' : 'solid',
      borderWidth: isDragOver ? '2px' : '1px',
      transform: isDragging
        ? 'translateY(-1px) scale(1.01)'
        : (isHovered ? 'translateY(-1px)' : 'translateY(0)'),
      boxShadow: isDragging
        ? `0 8px 24px ${color.accent}50, 0 0 0 1px ${color.accent}`
        : (isHovered ? `0 4px 14px ${accentColor}22, 0 0 0 1px ${accentColor}` : 'none'),
      cursor: isDragging ? 'grabbing' : 'pointer',
      touchAction: rest.onPointerDown ? 'pan-y' : 'auto',
      userSelect: 'none',
    }}
  >
    {leadingBadge}
    <div
      style={{
        ...styles.iconBox,
        color: accentColor,
        borderColor: isHovered ? `${accentColor}66` : color.border,
        background: isHovered ? `${accentColor}1a` : color.crust,
      }}
    >
      {icon}
    </div>

    <div style={styles.text}>
      <div style={styles.name}>{name}</div>
      <div style={styles.sub}>{subtitle}</div>
    </div>

    {/* 리모트 표시는 **우상단 모서리**에 띄운다. 액션 아이콘은 세로 가운데라 같은 줄에
        두면 붙어서 무엇이 상태고 무엇이 버튼인지 구별이 안 된다 — 코너를 나눠 쓴다
        (칩=우상단, 버튼=우하단). 칩이 없는 카드(로컬)는 예전 배치 그대로다. */}
    {/* 리모트 — **설치는 선택이다.** 안 깔았다고 경고색을 쓰지 않는다. 안 깔면
        세션 간 명령 전달과 상태 표시가 안 되는데, 그건 고장이 아니라 우리가 볼
        방법이 없는 것이다. 그래서 "없다" 가 아니라 **"할 수 있다"** 를 내민다
        (VMware 가 Tools 미설치를 알리는 방식). */}
    {remoteState === 'on' && (
      /* 숨쉬기는 **붙어 있을 때만**이다. 이 표식이 말하는 것은 "지금 살아 있는 링크"
         이고, 정지한 아이콘은 그냥 색깔 하나다. 미설치 칩에는 넣지 않는다 — 거기서
         맥동하면 재촉이 되는데, 안 깐 것은 결함이 아니라 아직 안 한 선택이다. */
      <span style={REMOTE_CORNER_ON} title={remoteOnTitle} className="iterm-breathe">
        <Link2 size={12} strokeWidth={2} />
      </span>
        )}
    {remoteState === 'off' && onInstallRemote && (
      /* 아이콘만으로는 무엇인지 알 수 없어 아무도 안 누른다 — 라벨을 단다.
         경고색이 아닌 이유: 안 깐 것은 결함이 아니라 선택이고, 여기서 말하는 것은
         **할 수 있는 일**이다. 무엇을 얻는지는 title 이 한 문장으로 말한다. */
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!remoteBusy) onInstallRemote(); }}
        title={remoteOffTitle}
        disabled={remoteBusy}
        /* 평소엔 조용한 정보, 얹으면 **누를 수 있다**고 말한다. 테두리를 주는 대신 색만
           액센트로 올린다 — 카드가 좁아 모양이 하나 더 생기면 답답하다. */
        onMouseEnter={(e) => { if (!remoteBusy) e.currentTarget.style.color = 'var(--ui-accent)'; }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = remoteFailed ? 'var(--ui-danger)' : 'var(--ui-muted)';
        }}
        style={{
          ...REMOTE_CORNER_CHIP,
          ...(remoteFailed ? { color: 'var(--ui-danger, #f38ba8)' } : null),
          ...(remoteBusy ? { opacity: 0.6, cursor: 'default' } : null),
        }}
      >
        <Download size={10} strokeWidth={2} />
        {remoteBusy
          ? (remoteBusyLabel || '설치 중…')
          : remoteFailed
            ? (remoteFailedLabel || '설치 실패')
            : (remoteOffLabel || '리모트 미설치')}
      </button>
        )}

    {/* ⚠️ 액션 줄은 **모든 카드에서 같은 자리**여야 한다. 칩이 있는 카드만 아래로
        내렸더니 카드마다 버튼 높이가 달라져 줄이 안 맞았다. 칩은 절대배치라 겹치지
        않는다 — 호스트 카드는 세 줄이라 우상단에 자리가 남는다. */}
    {(onPickPath || onEdit || onOpenVnc) && (
      <div style={styles.actions} onClick={(e) => e.stopPropagation()}>
        {onOpenVnc && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onOpenVnc(); }} title={openVncTitle}>
            <ScreenShare size={13} strokeWidth={1.8} />
          </RowBtn>
        )}
        {onPickPath && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onPickPath(); }} title={pickPathTitle}>
            <FolderOpen size={13} strokeWidth={1.8} />
          </RowBtn>
        )}
        {onEdit && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onEdit(); }} title={editTitle}>
            <SettingsIcon size={13} strokeWidth={1.8} />
          </RowBtn>
        )}
      </div>
    )}
  </div>
));

/* 리모트 표시는 카드 **우상단 모서리**에 고정한다.

   ⚠️ 액션 아이콘(기어·폴더)과 같은 줄에 두면 무엇이 **상태**고 무엇이 **버튼**인지
   구별이 안 된다. 이건 정보이고(연결됨) 하나는 할 일이라(설치), 자리를 나눠야 읽힌다.
   그래서 코너를 쓴다 — 칩은 우상단, 버튼은 우하단. */
const REMOTE_CORNER = {
  position: 'absolute',
  /* ⚠️ 카드 **모서리에 바짝** 붙인다. 6px 만 띄웠더니 액션 버튼 바로 위에 얹혀 둘이 한
     덩어리로 보였다 — 정보와 버튼을 나누려고 코너를 쓴 것인데 그러면 의미가 없다.
     테두리 안쪽 여백(카드 padding 10px)보다 위로 올라가야 "모서리에 붙은 표식" 이 된다. */
  top: '3px',
  right: '5px',
  zIndex: 1,
};

const REMOTE_CORNER_CHIP = {
  ...REMOTE_CORNER,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  padding: 0,
  /* ⚠️ **버튼처럼 보이면 안 된다.** 이건 카드가 알려주는 사실이고, 누를 수 있다는 것은
     부수적이다. 테두리·면을 주면 우상단에 버튼이 하나 더 생긴 것처럼 읽히고, 카드가
     좁아 그 자체로 답답해진다. 글자와 아이콘만 남긴다. */
  background: 'transparent',
  border: 'none',
  color: tokens.color.muted,
  fontSize: tokens.fontSize['10'] || '10px',
  fontFamily: 'inherit',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const REMOTE_CORNER_ON = {
  ...REMOTE_CORNER,
  /* ⚠️ 고정 초록(success)이 아니라 **테마 액센트**다. success 는 팔레트마다 톤이 달라
     카드 강조색과 부딪히고, 어떤 테마에서는 경고처럼 읽힌다. 액센트는 그 테마가 이미
     "이게 활성이다" 로 쓰는 색이라 어디서든 같은 뜻이 된다. */
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  flexShrink: 0,
  color: tokens.color.accent,
};

const RowBtn = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: '26px',
      height: '26px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: color.surface0,
      border: `1px solid ${color.border}`,
      borderRadius: radius.sm,
      cursor: 'pointer',
      color: color.subtext,
      transition: 'background 150ms, color 150ms, border-color 150ms',
      padding: 0,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.base;
      e.currentTarget.style.color = color.text;
      e.currentTarget.style.borderColor = color.accent;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = color.surface0;
      e.currentTarget.style.color = color.subtext;
      e.currentTarget.style.borderColor = color.border;
    }}
  >
    {children}
  </button>
);

const EmptyRow = ({ onClick, t }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        ...styles.row,
        background: hovered ? color.surface1 : color.surface0,
        // button 기본 정렬 reset — HostRow(<div>) 와 시각 동일하게 좌측 정렬.
        textAlign: 'left',
        font: 'inherit',
        appearance: 'none',
      }}
    >
      <div style={{ ...styles.iconBox, borderColor: hovered ? color.accentBorder : color.border }}>
        <Plus size={16} strokeWidth={1.8} style={{ color: color.accent }} />
      </div>
      {/* HostRow 의 name + subtitle(2줄) 과 라인 수를 맞춰 row 높이 정렬. */}
      <div style={styles.text}>
        <span style={{ ...styles.name, color: color.subtext }}>{t?.('addHost') || 'Add host'}</span>
        <span style={styles.sub}>
          <span style={{ ...styles.subLine, color: color.faint }}>{t?.('addHostHint') || 'New SSH connection'}</span>
        </span>
      </div>
    </button>
  );
};

const styles = {
  root: {
    width: '100%',
    height: '100%',
    background: color.base,
    position: 'relative',
    overflow: 'auto',
    /* Always reserve the scrollbar gutter. Moving between the connections view (short) and
       the dashboard (long), the scrollbar appears and disappears and the centre column jolts
       sideways by its width — the same happens when switching tabs. */
    scrollbarGutter: 'stable',
    fontFamily: font.sans,
    padding: `${space['4']} ${space['5']}`,
    boxSizing: 'border-box',
  },
  inner: {
    width: '100%',
    /* 폭은 제한한다. 카드가 화면 끝까지 늘어나면 한 줄이 길어져 눈이 좌우로 왕복하고,
       타일도 필요 이상으로 넓어져 숫자 옆이 텅 빈다. (한 번 풀어봤다가 되돌린 값이다.) */
    maxWidth: '960px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space['3'],
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionHead: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    // 리모트 칩이 우상단에 절대배치된다 — 그 기준점.
    position: 'relative',
    gap: '12px',
    padding: '10px 12px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    cursor: 'pointer',
    transition: 'background 150ms, border-color 150ms, transform 150ms, box-shadow 150ms, opacity 120ms',
    fontFamily: font.sans,
    minHeight: '60px',
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  emptyRow: {
    justifyContent: 'center',
    cursor: 'pointer',
  },
  iconBox: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    background: color.crust,
    transition: 'background 150ms, border-color 150ms',
  },
  text: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  name: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    fontSize: fontSize['11'],
    color: color.subtext,
    fontFamily: font.mono,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    minWidth: 0,
    lineHeight: 1.35,
  },
  subLine: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  dashHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  dashRefresh: {
    background: 'transparent',
    border: 'none',
    color: color.subtext,
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
  },
  /* 둘 다 세그먼트 스위치 — 모양은 styles/segmented.js 한 곳에서 나온다. */
  rangeRow: segmentedTrackStyle(),
  viewSwitch: segmentedTrackStyle(),
};

export default HomeDashboard;
