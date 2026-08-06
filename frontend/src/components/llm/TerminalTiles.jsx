import { useMemo } from 'react';
import { Clock, Layers, Server, CalendarDays } from 'lucide-react';
import { tokens as designTokens } from '../../styles/tokens';
import { TileRow } from './LlmTiles.jsx';
import { HBars } from './HBars.jsx';
import DayLine from './DayLine.jsx';
import { dashboardCardStyle } from '../../styles/dashboardCard';

const { color } = designTokens;

/**
 * 터미널 사용 시간 — LLM 숫자와 **같은 타일·같은 막대**로 그린다.
 *
 * 예전엔 이 통계가 자기만의 카드 모양(히어로 시간 + 진행바 + 도넛)을 갖고 있어서
 * 바로 아래 LLM 타일과 한 화면으로 읽히지 않았다. 대시보드는 한 덩어리여야 하고,
 * 그러려면 숫자가 모두 같은 모양을 써야 한다.
 *
 * 기간은 위에서 내려온다(`days`) — 카드마다 기간이 다르면 비교가 안 된다.
 */

/**
 * 집계 응답 → HBars 행.
 *
 * **필드 이름은 `by_target` 이다**(`backend/db/usage.py`). 한 번 `targets` 로 적었다가
 * 호스트별 막대가 통째로 빈 카드가 됐다 — 화면은 "데이터 없음" 이라 말하고 에러는
 * 아무 데도 안 난다. 그래서 이 매핑만 순수 함수로 빼서 테스트가 잡게 한다.
 *
 * 지워진 호스트는 뺀다 — 이름을 모르는 id 가 막대로 남으면 그건 통계가 아니라 잔해다.
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

/** 데이터는 위(홈)가 가져온다 — 머리(기간 스위치)까지 한 몸으로 스켈레톤을 그리려면
    로딩 여부를 홈이 알아야 한다(`hooks/useTerminalUsage`). */
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
      /* 맨 앞은 **하루 평균**이다. 합계는 기간을 바꾸면 따라 커지므로 그 자체로는 크고
         작음을 말해주지 않는다 — 하루 평균은 기간이 달라도 같은 척도로 읽힌다. */
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
      {/* 일별 리듬 — 숫자는 "얼마나" 만 말한다. 매일 조금씩인지 하루에 몰았는지는 흐름이
          말하고, 흐름은 라인의 일이다(아래 LLM 지출 그래프와 같은 문법·다른 색). */}
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

/** 초 → "28일 9시간". 단위는 로케일에서 온다 — d/h 는 한국어 화면의 숫자가 아니다. */
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
