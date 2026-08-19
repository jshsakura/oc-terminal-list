import { memo } from 'react';
import { Server, Monitor, CloudOff } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';

const { color, font, fontSize, fontWeight, space } = tokens;

/**
 * One machine: how loaded it is and how long it has been up.
 *
 * The board used to be rows of bare text, which answered "what is running" but not the
 * question you ask right after — *is that box actually healthy?* Both figures ride the
 * same SSH round trip the pane statuses already cost, so the answer is free.
 *
 * ⚠️ A machine we could not reach draws **no figures at all**. Rendering 0% for a host
 * that never answered is the same lie as drawing an unknown pane as idle: it turns a
 * network problem into a confident measurement.
 */

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** ≥90% is worth noticing, ≥75% is worth a glance — below that it is just a number. */
export const memoryTone = (ratio) => {
  if (ratio >= 0.9) return color.danger;
  if (ratio >= 0.75) return color.warning || color.accent;
  return color.accent;
};

/** "3일" / "5시간" / "12분" — 하루를 넘기면 시간 단위는 노이즈다. */
export const formatUptime = (seconds, t) => {
  if (!seconds || seconds < 0) return null;
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}${t?.('unitDay') || 'd'}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}${t?.('unitHour') || 'h'}`;
  return `${Math.max(1, Math.floor(seconds / 60))}${t?.('unitMinute') || 'm'}`;
};

export const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${Math.round(gb)}G`;
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))}M`;
};

const Donut = ({ ratio, label }) => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const tone = memoryTone(clamped);
  return (
    <div style={S.donutWrap}>
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <circle
          cx="19" cy="19" r={RADIUS} fill="none" strokeWidth="4"
          stroke={`color-mix(in srgb, ${color.text} 10%, transparent)`}
        />
        <circle
          cx="19" cy="19" r={RADIUS} fill="none" strokeWidth="4" strokeLinecap="round"
          stroke={tone}
          strokeDasharray={`${CIRCUMFERENCE * clamped} ${CIRCUMFERENCE}`}
          // Start at twelve o'clock — a gauge that begins on the right reads as a pie.
          transform="rotate(-90 19 19)"
        />
      </svg>
      <span style={{ ...S.donutLabel, color: tone }}>{label}</span>
    </div>
  );
};

const MachineCard = ({ machine, name, isLocal = false, t = null }) => {
  const label = (key, fallback) => t?.(key) || fallback;
  const hasMemory = !!machine?.memTotal && machine?.memUsed != null;
  const ratio = hasMemory ? machine.memUsed / machine.memTotal : 0;
  const uptime = formatUptime(machine?.uptimeSeconds, t);
  const Icon = isLocal ? Monitor : Server;

  return (
    <div style={{ ...dashboardCardStyle({ padding: space['3'] }), ...S.card }}>
      <div style={S.head}>
        <span style={S.tile}><Icon size={13} strokeWidth={2} /></span>
        <span style={S.name}>{name}</span>
        {!machine?.reachable && (
          <span style={S.offline}>
            <CloudOff size={11} strokeWidth={2} />
            {label('fleetUnreachable', 'unreachable')}
          </span>
        )}
      </div>

      <div style={S.body}>
        {/* No figures for a machine that did not answer — see the file comment. */}
        {machine?.reachable && hasMemory && (
          <Donut ratio={ratio} label={`${Math.round(ratio * 100)}%`} />
        )}
        <div style={S.facts}>
          <span style={S.fact}>
            <span style={S.factValue}>{machine?.paneCount ?? 0}</span>
            <span style={S.factKey}>{label('fleetPanes', 'panes')}</span>
          </span>
          {machine?.reachable && uptime && (
            <span style={S.fact}>
              <span style={S.factValue}>{uptime}</span>
              <span style={S.factKey}>{label('fleetUptime', 'up')}</span>
            </span>
          )}
          {machine?.reachable && hasMemory && (
            <span style={S.fact}>
              <span style={S.factValue}>{formatBytes(machine.memUsed)}</span>
              <span style={S.factKey}>/ {formatBytes(machine.memTotal)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const S = {
  card: { display: 'flex', flexDirection: 'column', gap: space['2'], minWidth: 0 },
  head: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  tile: {
    width: '22px', height: '22px', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '5px', color: color.subtext,
    background: `color-mix(in srgb, ${color.text} 7%, transparent)`,
    border: `1px solid ${color.border}`, boxSizing: 'border-box',
  },
  name: {
    fontSize: fontSize['12'], fontWeight: fontWeight.semibold, color: color.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  offline: {
    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px',
    fontSize: '10px', color: color.faint, whiteSpace: 'nowrap',
  },
  body: { display: 'flex', alignItems: 'center', gap: space['3'] },
  donutWrap: { position: 'relative', width: '38px', height: '38px', flexShrink: 0 },
  donutLabel: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: font.mono, fontSize: '9.5px', fontWeight: fontWeight.semibold,
  },
  facts: { display: 'flex', gap: space['3'], flexWrap: 'wrap', minWidth: 0 },
  fact: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
  factValue: { fontFamily: font.mono, fontSize: fontSize['12'], color: color.text },
  factKey: { fontSize: '10px', color: color.faint, whiteSpace: 'nowrap' },
};

export default memo(MachineCard);
