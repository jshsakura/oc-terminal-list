import { memo } from 'react';
import { RefreshCw, Server, Monitor, CircleHelp } from 'lucide-react';
import { tokens } from '../../styles/tokens';

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
      {/* No title: this board owns its own tab, and the tab label already names it.
          Printing the name again above the first row was the first thing anyone
          noticed about the screen. */}
      <div style={S.head}>
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
            return (
              <button
                type="button"
                key={`${target.tabIndex}.${target.paneIndex}`}
                style={S.row}
                onClick={() => onOpen?.(target)}
                className="iterm-menu-item"
              >
                <Dot state={state} />
                <span style={S.addr}>{target.addr}</span>
                <span style={S.machine}>
                  {remote ? <Server size={10} strokeWidth={2} /> : <Monitor size={10} strokeWidth={2} />}
                  <span style={S.machineName}>{remote ? hostName(target.hostId) : label('thisMachine', 'local')}</span>
                </span>
                <span style={S.what}>
                  {/* The pane title is what an agent writes about its own work, so it
                      beats the process name when both exist. */}
                  {target.title || target.command || target.tabName || '—'}
                </span>
                <span style={{ ...S.state, color: state === 'permission' ? (color.warning || color.text) : color.faint }}>
                  {state === 'unknown'
                    ? label('fleetUnknown', 'unknown')
                    : state === 'gone'
                      ? label('fleetGone', 'gone')
                      : label(STATUS_STYLE[state]?.key, STATUS_STYLE[state]?.fallback || state)}
                </span>
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
  wrap: { display: 'flex', flexDirection: 'column', gap: space['2'] },
  head: { display: 'flex', alignItems: 'center', gap: space['2'] },
  title: {
    fontSize: fontSize['11'], fontWeight: fontWeight.medium, color: color.muted,
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  count: { fontSize: fontSize['11'], color: color.faint, fontFamily: font.mono },
  refresh: {
    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '22px', height: '22px', padding: 0,
    background: 'transparent', border: 'none', borderRadius: radius.sm,
    color: color.subtext, cursor: 'pointer',
  },
  // `dc-spin` is the app-wide keyframe (main.jsx). `iterm-spin` lives inside
  // InfoPanel's local <style> and is not defined when this renders.
  spinning: { animation: 'dc-spin 900ms linear infinite' },
  list: { display: 'flex', flexDirection: 'column', gap: '2px' },
  row: {
    display: 'flex', alignItems: 'center', gap: '8px',
    width: '100%', minHeight: '30px', padding: '4px 8px',
    background: 'transparent', border: 'none', borderRadius: radius.sm,
    color: color.text, textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  addr: { fontFamily: font.mono, fontSize: fontSize['11'], color: color.subtext, flexShrink: 0, minWidth: '26px' },
  machine: { display: 'inline-flex', alignItems: 'center', gap: '3px', color: color.faint, flexShrink: 0 },
  machineName: {
    fontSize: fontSize['11'], maxWidth: '84px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  what: {
    flex: 1, minWidth: 0, fontSize: fontSize['11'], color: color.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  state: { fontSize: '10px', flexShrink: 0, whiteSpace: 'nowrap' },
  empty: { fontSize: fontSize['11'], color: color.faint, padding: `${space['2']} 0` },
  error: { fontSize: '10px', color: color.faint },
};

export default memo(FleetBoard);
