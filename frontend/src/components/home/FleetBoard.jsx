import { memo } from 'react';
import { RefreshCw, CircleHelp } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import MachineCard from './MachineCard';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * Every terminal, on every machine, and what each one is doing right now.
 *
 * Why this screen exists: the app's differentiator is work spread across machines, but
 * until you opened a pane you could not see any of it — and a remote pane's status is
 * invisible to the backend's watcher by design (it can only read this machine's tmux).
 * So "what is running where" was a question you had to ask one pane at a time.
 *
 * The honest bit is the `?` state. A remote host we could not reach is **not** idle, and
 * drawing it as idle is the same mistake that once made an agent's wait return "done" in
 * zero seconds. Unknown gets its own mark.
 */

const STATUS_STYLE = {
  working: { key: 'fleetWorking', fallback: 'Working', tone: (c) => c.success || '#3fb950' },
  permission: { key: 'fleetPermission', fallback: 'Waiting for you', tone: (c) => c.warning || '#d29922' },
  idle: { key: 'fleetIdle', fallback: 'Idle', tone: (c) => c.faint },
};

const statusOf = (target) => {
  if (target.statusGone) return 'gone';
  if (target.statusUnknown) return 'unknown';
  return target.status || 'idle';
};

/* Working first, then anything waiting on a person, then the rest. A board sorted by
   address makes you read all of it to find the one line that wants attention. */
const RANK = { permission: 0, working: 1, unknown: 2, idle: 3, gone: 4 };

export const sortForBoard = (targets) => [...targets].sort((a, b) => {
  const byState = (RANK[statusOf(a)] ?? 9) - (RANK[statusOf(b)] ?? 9);
  if (byState !== 0) return byState;
  if (a.tabIndex !== b.tabIndex) return a.tabIndex - b.tabIndex;
  return a.paneIndex - b.paneIndex;
});


/** 상태별 색 — 화면 여러 곳이 같은 판정을 쓰도록 한 곳에 둔다. */
export const stateColor = (state) => {
  if (state === 'permission') return color.warning || color.text;
  if (state === 'working') return color.success || color.accent;
  return color.faint;
};

const stateLabel = (state, label) => {
  if (state === 'unknown') return label('fleetUnknown', 'unknown');
  if (state === 'gone') return label('fleetGone', 'gone');
  return label(STATUS_STYLE[state]?.key, STATUS_STYLE[state]?.fallback || state);
};

/** 상태 타일의 바탕 — 일하는 중일 때만 색을 띤다. 전부 칠하면 아무것도 안 도드라진다. */
const toneTile = (state) => {
  if (state === 'working' || state === 'permission') {
    const tone = stateColor(state);
    return { background: `color-mix(in srgb, ${tone} 14%, transparent)`, borderColor: `color-mix(in srgb, ${tone} 28%, transparent)` };
  }
  return {};
};

/**
 * "3일째" / "5시간" — 세션이 언제 시작됐는지. 며칠 돌고 있는 작업인지가 목록에서 가장
 * 먼저 눈에 들어와야 하는 정보 중 하나다.
 */
export const formatAge = (startedAt, t) => {
  if (!startedAt) return null;
  const seconds = Math.floor(Date.now() / 1000) - Number(startedAt);
  if (!Number.isFinite(seconds) || seconds < 60) return null;
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}${t?.('unitDay') || 'd'}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}${t?.('unitHour') || 'h'}`;
  return `${Math.floor(seconds / 60)}${t?.('unitMinute') || 'm'}`;
};

/** 경로는 꼬리만 — 목록에서 의미를 나르는 것은 마지막 두 칸이다. */
export const shortPath = (cwd) => {
  const parts = String(cwd || '').split('/').filter(Boolean);
  if (parts.length === 0) return '';
  return parts.slice(-2).join('/');
};

const Dot = ({ state }) => {
  if (state === 'unknown' || state === 'gone') {
    return <CircleHelp size={11} strokeWidth={2.2} style={{ color: color.faint, flexShrink: 0 }} />;
  }
  const tone = STATUS_STYLE[state]?.tone(color) || color.faint;
  return (
    <span
      style={{
        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
        background: tone,
        // Idle is deliberately quiet — a lit dot on every row is noise, not signal.
        opacity: state === 'idle' ? 0.35 : 1,
      }}
    />
  );
};

const FleetBoard = ({
  targets = [],
  machines = [],
  hosts = [],
  loading = false,
  error = null,
  onRefresh = null,
  onOpen = null,
  t = null,
}) => {
  const label = (key, fallback) => t?.(key) || fallback;
  const hostName = (hostId) => hosts.find((h) => h.id === hostId)?.name || hostId;
  const rows = sortForBoard(targets);

  return (
    <div style={S.wrap}>
      {/* Machines first. "What is running" is the list below; "can that box take it" is
          the question you ask right after, and both ride the same round trip. */}
      {machines.length > 0 && (
        <div style={S.machines}>
          {machines.map((machine) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              isLocal={machine.id === 'local'}
              name={machine.id === 'local' ? label('thisMachine', 'This machine') : hostName(machine.id)}
              t={t}
            />
          ))}
        </div>
      )}

      <div style={S.head}>
        {/* The bare number read as a stray digit above the list — it needs to say what it
            counts. The tab label names the screen; this names the list. */}
        <span style={S.countLabel}>{label('fleetPanes', 'panes')}</span>
        <span style={S.count}>{rows.length}</span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={S.refresh}
            title={label('refresh', 'Refresh')}
            aria-label={label('refresh', 'Refresh')}
          >
            <RefreshCw size={11} strokeWidth={2.2} style={loading ? S.spinning : undefined} />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={S.empty}>{label('fleetEmpty', 'No terminals open yet.')}</div>
      ) : (
        <div style={S.list}>
          {rows.map((target) => {
            const state = statusOf(target);
            const remote = target.kind === 'host';
            const age = formatAge(target.startedAt, t);
            return (
              <button
                type="button"
                key={`${target.tabIndex}.${target.paneIndex}`}
                style={S.row}
                onClick={() => onOpen?.(target)}
                onMouseEnter={(e) => { e.currentTarget.style.background = S.rowHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ ...S.stateTile, ...toneTile(state) }}><Dot state={state} /></span>

                <span style={S.addr}>{target.addr}</span>

                <span style={S.main}>
                  {/* The pane title is what an agent writes about its own work, so it
                      beats the process name when both exist. */}
                  <span style={S.title}>{target.title || target.command || target.tabName || '—'}</span>
                  <span style={S.sub}>
                    <span style={S.machineName}>
                      {remote ? hostName(target.hostId) : label('thisMachine', 'local')}
                    </span>
                    {target.cwd && <span style={S.path}>{shortPath(target.cwd)}</span>}
                    {target.command && target.title && <span style={S.cmd}>{target.command}</span>}
                  </span>
                </span>

                {age && <span style={S.age}>{age}</span>}
                <span style={{ ...S.state, color: stateColor(state) }}>{stateLabel(state, label)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* An error never blanks the board — the rows above are the last good picture. */}
      {error && <div style={S.error}>{label('fleetStale', 'Could not refresh just now — showing the last known state.')}</div>}
    </div>
  );
};

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  /* Machines wrap into a responsive row — one card per box, never a fixed column count,
     because a fleet is two machines for one person and eight for another. */
  machines: {
    display: 'grid',
    gap: space['2'],
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
  },
  head: { display: 'flex', alignItems: 'center', gap: space['2'] },
  countLabel: {
    fontSize: fontSize['11'], color: color.muted, letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  count: { fontSize: fontSize['11'], color: color.faint, fontFamily: font.mono },
  refresh: {
    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '22px', height: '22px', padding: 0,
    background: 'transparent', border: 'none', borderRadius: radius.sm,
    color: color.subtext, cursor: 'pointer',
  },
  // `dc-spin` is the app-wide keyframe (main.jsx).
  spinning: { animation: 'dc-spin 900ms linear infinite' },
  list: { display: 'flex', flexDirection: 'column', gap: '1px' },
  /* A row is a **line**, not a card: a dozen bordered boxes stacked is a wall, and this
     list is read by scanning down one column of titles. The tile on the left and the
     hover ground give it enough shape without carving each row out of the page. */
  row: {
    display: 'flex', alignItems: 'center', gap: '10px',
    width: '100%', minHeight: '44px', padding: '6px 10px',
    background: 'transparent', border: 'none', borderRadius: radius.md,
    color: color.text, textAlign: 'left', cursor: 'pointer', font: 'inherit',
    transition: 'background 120ms',
  },
  rowHover: `color-mix(in srgb, ${color.text} 5%, transparent)`,
  stateTile: {
    width: '24px', height: '24px', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '6px', boxSizing: 'border-box',
    background: `color-mix(in srgb, ${color.text} 6%, transparent)`,
    border: `1px solid ${color.border}`,
  },
  addr: {
    fontFamily: font.mono, fontSize: '10.5px', color: color.subtext, flexShrink: 0,
    minWidth: '30px', padding: '2px 5px', borderRadius: '4px', textAlign: 'center',
    background: `color-mix(in srgb, ${color.text} 5%, transparent)`,
  },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' },
  title: {
    fontSize: fontSize['12'], color: color.text, fontWeight: fontWeight.medium,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  sub: {
    display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0,
    fontSize: '10px', color: color.faint,
  },
  machineName: { flexShrink: 0, maxWidth: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  path: {
    fontFamily: font.mono, minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  cmd: { fontFamily: font.mono, flexShrink: 0, opacity: 0.75 },
  age: { fontFamily: font.mono, fontSize: '10px', color: color.faint, flexShrink: 0 },
  state: { fontSize: '10px', flexShrink: 0, whiteSpace: 'nowrap', minWidth: '38px', textAlign: 'right' },
  empty: { fontSize: fontSize['11'], color: color.faint, padding: `${space['2']} 0` },
  error: { fontSize: '10px', color: color.faint },
};

export default memo(FleetBoard);
