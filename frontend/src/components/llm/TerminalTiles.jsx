import { useMemo } from 'react';
import { Clock, Layers, Server, CalendarDays } from 'lucide-react';
import { tokens as designTokens } from '../../styles/tokens';
import { TileRow } from './LlmTiles.jsx';
import { HBars } from './HBars.jsx';
import DayLine from './DayLine.jsx';
import { dashboardCardStyle } from '../../styles/dashboardCard';

const { color } = designTokens;

/**
 * Terminal time — drawn with the **same tiles and bars** as the LLM numbers.
 *
 * This block used to have its own card shape (hero duration + progress bar + donut), so it
 * never read as one screen with the LLM tiles right below. A dashboard has to be one piece,
 * and that means every number shares a shape.
 *
 * The range comes from above (`days`) — different ranges per card cannot be compared.
 */

/**
 * Summary response → HBars rows.
 *
 * **The field is `by_target`** (`backend/db/usage.py`). Written once as `targets`, the
 * per-host bars became an empty card — the screen says "no data" and nothing errors.
 * Hence this mapping lives as a pure function that tests can hold.
 *
 * Deleted hosts are dropped: an id with no name left as a bar is debris, not a statistic.
 */
export const buildHostRows = (data, hosts = [], settings = {}, t) => {
  const meta = new Map(hosts.map((h) => [h.id, h]));
  return (data?.by_target || [])
    .filter((row) => row.target_type === 'local' || meta.has(row.target_id))
    .map((row) => {
      const isLocal = row.target_type === 'local' || row.target_id === 'local';
      const m = meta.get(row.target_id);
      return {
        name: isLocal
          ? ((settings.localName || '').trim() || t?.('thisMachine') || 'This machine')
          : (m?.name || row.target_id),
        // HBars 는 cost 기준으로 정렬·막대를 그린다 — 여기서는 "초" 가 그 자리를 맡는다.
        cost: Number(row.total_seconds) || 0,
        accent: isLocal
          ? color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length]
          : color.dotPalette[(m?.color_index ?? 0) % color.dotPalette.length],
      };
    })
    .sort((a, b) => b.cost - a.cost);
};

/** The home fetches the data — drawing the head (range switch) as one skeleton with the
    cards requires the home to know the loading state (`hooks/useTerminalUsage`). */
const TerminalTiles = ({ hosts = [], settings = {}, data = null, t }) => {

  const hostRows = useMemo(
    () => buildHostRows(data, hosts, settings, t),
    [data, hosts, settings, t],
  );

  if (!data) return null;

  const windowDays = Math.max(1, Number(data.window_days) || 1);
  const perDay = Math.round((Number(data.total_seconds) || 0) / windowDays);

  const tiles = [
    {
      /* First comes the **daily average**. A total grows with the range, so on its own it
         says nothing about big or small; a daily average reads on the same scale whatever
         range you pick. */
      icon: Clock,
      key: t?.('perDayAvg') || 'Per day',
      value: formatDuration(perDay, t),
      note: `${formatDuration(data.total_seconds, t)} ${t?.('inTotal') || 'total'}`,
    },
    {
      icon: Layers,
      key: t?.('sessions') || 'Sessions',
      value: Math.round(data.session_count || 0).toLocaleString(),
      note: `${formatDuration(data.avg_session_seconds, t)} ${t?.('avgSession') || 'avg'}`,
    },
    {
      icon: Server,
      key: t?.('activeHosts') || 'Active',
      value: `${data.active_targets || 0}/${hosts.length + 1}`,
      note: `${windowDays}${t?.('unitDay') || 'd'} ${t?.('window') || 'window'}`,
    },
  ];

  return (
    <>
      <TileRow tiles={tiles} />
      {/* Daily rhythm — numbers only say "how much". Whether it was a little every day or
          all in one sitting is a trend, and trends are a line's job (same grammar as the LLM
          spend chart below, different colour). */}
      {Array.isArray(data.by_day) && data.by_day.length > 1 && (
        <section style={dayCardStyle}>
          <h3 style={dayTitleStyle}>
            <CalendarDays size={12} strokeWidth={2} style={{ color: color.subtext }} />
            {t?.('dailyUsage') || 'Daily usage'}
          </h3>
          <DayLine
            byDay={data.by_day}
            format={(seconds) => formatDuration(seconds, t)}
            t={t}
          />
        </section>
      )}
      <HBars
        icon={Server}
        title={t?.('byHost') || 'Time by host'}
        rows={hostRows}
        colorOf={(name) => hostRows.find((h) => h.name === name)?.accent || color.accent}
        money={(seconds) => formatDuration(seconds, t)}
        t={t}
      />
    </>
  );
};

/** Seconds → "28d 9h". Units come from the locale — d/h is not how a Korean screen counts. */
function formatDuration(seconds, t) {
  const u = (key, fallback) => t?.(key) || fallback;
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}${u('unitSecond', 's')}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${u('unitMinute', 'm')}`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const remM = m % 60;
    return remM ? `${h}${u('unitHour', 'h')} ${remM}${u('unitMinute', 'm')}` : `${h}${u('unitHour', 'h')}`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}${u('unitDay', 'd')} ${remH}${u('unitHour', 'h')}` : `${d}${u('unitDay', 'd')}`;
}

const dayCardStyle = {
  display: 'flex', flexDirection: 'column', gap: '8px',
  ...dashboardCardStyle({ padding: '12px' }),
};
const dayTitleStyle = {
  margin: 0, fontSize: '12px', fontWeight: 600,
  color: color.text, letterSpacing: '0.02em',
  display: 'flex', alignItems: 'center', gap: '6px',
};

export default TerminalTiles;
