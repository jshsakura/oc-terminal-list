import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tokens as designTokens } from '../../styles/tokens';
import { authHeaders } from '../../utils/auth';
import { TileRow } from './LlmTiles.jsx';
import { HBars } from './HBars.jsx';

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
const _cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

const useTerminalUsage = (days) => {
  const [data, setData] = useState(() => _cache.get(days)?.data || null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => {
    const cached = _cache.get(days);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) { setData(cached.data); return; }
    fetch(`/api/usage/summary?days=${days}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        _cache.set(days, { data: d, ts: Date.now() });
        if (alive.current) setData(d);
      })
      .catch(() => { /* 통계가 없다고 홈이 깨지면 안 된다 */ });
  }, [days]);

  useEffect(() => { load(); }, [load]);
  return data;
};

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

const TerminalTiles = ({ hosts = [], settings = {}, days = 7, t }) => {
  const data = useTerminalUsage(days || 90);

  const hostRows = useMemo(
    () => buildHostRows(data, hosts, settings, t),
    [data, hosts, settings, t],
  );

  if (!data) return null;

  const tiles = [
    {
      key: t?.('totalTime') || 'Total time',
      value: formatDuration(data.total_seconds, t),
      note: `${Math.round(data.session_count || 0).toLocaleString()} ${t?.('sessions') || 'sessions'}`,
    },
    {
      key: t?.('activeHosts') || 'Active',
      value: `${data.active_targets || 0}/${hosts.length + 1}`,
      note: `${formatDuration(data.avg_session_seconds, t)} ${t?.('avgSession') || 'avg'}`,
    },
  ];

  return (
    <>
      <TileRow tiles={tiles} />
      <HBars
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

export default TerminalTiles;
