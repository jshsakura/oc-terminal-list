import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Network, Power, RefreshCw, Server } from 'lucide-react';
import useMachineStats from '../../hooks/useMachineStats';
import { MACHINE_STATS_POLL_MS } from '../../utils/machineStatsStore';
import { einkPollMs } from '../../utils/einkMode';
import { tokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { segmentedItemStyle } from '../../styles/segmented';
import { TileRow } from '../llm/LlmTiles';
import { formatBytes, formatRate, formatUptime } from '../terminalheader/info/infoFormat';
import { SkeletonBlock } from '../common/SkeletonRow';
import { en } from '../../i18n/locales/en';

const { color, font, fontSize, fontWeight, space } = tokens;
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const bytes = value => valid(value) ? formatBytes(value) : '—';
const rate = value => valid(value) ? formatRate(value) : '—';
const percent = value => valid(value) ? `${value.toFixed(1)}%` : '—';
const timeLabel = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const defaultTranslate = key => en[key] || key;

function Trend({ history, series, title, percentage = false, interval, t }) {
  const end = history.at(-1)?.at || Date.now();
  const start = end - 300000;
  const maximum = percentage ? 100 : Math.max(1, ...history.flatMap(sample => series.map(item => valid(sample[item.key]) ? sample[item.key] : 0)));
  const paths = series.map(item => {
    const segments = [];
    let previousAt = null;
    for (const sample of history) {
      if (!valid(sample[item.key])) { previousAt = null; continue; }
      const x = ((sample.at - start) / 300000) * 600;
      const y = 140 - Math.min(maximum, sample[item.key]) / maximum * 130;
      const command = previousAt === null || sample.at - previousAt > interval * 3 ? 'M' : 'L';
      segments.push(`${command}${x.toFixed(2)},${y.toFixed(2)}`);
      previousAt = sample.at;
    }
    return { ...item, d: segments.join(' ') };
  });
  return (
    <section style={S.card}>
      <h3 style={S.title}>{title}</h3>
      <div style={S.legend}>
        {series.map(item => <span key={item.key} style={S.legendItem}><span aria-hidden="true" style={{ ...S.dot, background: item.color }} />{item.label}</span>)}
      </div>
      <div style={S.axis}><span>{percentage ? '100%' : rate(maximum)}</span><span>{t('machineRecent')}</span></div>
      <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" aria-label={title} style={S.chart}>
        {[10, 75, 140].map(y => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke={color.border} vectorEffect="non-scaling-stroke" />)}
        {paths.map(item => <path key={item.key} d={item.d} fill="none" stroke={item.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
        {series.map(item => {
          const last = history.at(-1);
          return last && valid(last[item.key]) ? <circle key={item.key} cx="598" cy={140 - Math.min(maximum, last[item.key]) / maximum * 130} r="3" fill={item.color} /> : null;
        })}
      </svg>
      <div style={S.axis}><span>{timeLabel(start)}</span><span>{timeLabel(end)}</span></div>
      {history.length < 2 && <p style={S.note}>{t('machineChartWaiting')}</p>}
    </section>
  );
}

export default function MachineInfo({ isVisible = true, t = defaultTranslate }) {
  const [monitoring, setMonitoring] = useState(false);
  const { stats, history, updatedAt, error, refreshing, refresh } = useMachineStats(isVisible, monitoring);
  const [lastLive, setLastLive] = useState(null);
  const hasLiveSample = Boolean(stats && history.length && history.at(-1).at === updatedAt);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (monitoring && hasLiveSample) { setLastLive({ stats, history, updatedAt }); }
  }, [monitoring, hasLiveSample, stats, history, updatedAt]);
  const live = monitoring && hasLiveSample ? { stats, history, updatedAt } : lastLive;
  const sample = live?.stats;
  const interval = einkPollMs(MACHINE_STATS_POLL_MS);
  const status = !monitoring ? t('machineOff') : (!isVisible || hidden) ? t('machinePaused') : error ? t('machineRetrying') : refreshing && !live ? t('machineConnecting') : t('machineLive').replace('{seconds}', String(interval / 1000));
  const resourceSeries = [
    { key: 'cpu', label: 'CPU', color: color.info },
    { key: 'ram', label: t('infoMemory'), color: color.accent },
    { key: 'disk', label: t('infoDisk'), color: color.warning },
  ];
  const networkSeries = [
    { key: 'net_rx_rate', label: t('machineReceive'), color: color.success },
    { key: 'net_tx_rate', label: t('machineSend'), color: color.info },
  ];
  const specifications = [
    [t('machineHostname'), stats?.hostname || '—'],
    [t('machineCpuModel'), stats?.cpu_model || '—'],
    [t('machineCores'), valid(stats?.cpu_count) ? String(stats.cpu_count) : '—'],
    [t('machineMemoryCapacity'), bytes(stats?.mem_total)],
    [t('machineDiskCapacity'), bytes(stats?.disk_total)],
    [t('machineDiskPath'), stats?.disk_path || '—'],
  ];
  const tiles = sample ? [
    { key: 'CPU', icon: Cpu, value: percent(sample.cpu), note: `${t('machineCores')}: ${stats?.cpu_count ?? '—'}` },
    { key: t('infoMemory'), icon: MemoryStick, value: percent(sample.ram), note: `${bytes(sample.mem_used)} / ${bytes(sample.mem_total)}` },
    { key: t('infoDisk'), icon: HardDrive, value: percent(sample.disk), note: `${bytes(sample.disk_used)} / ${bytes(sample.disk_total)}` },
    { key: t('machineReceive'), icon: Network, value: rate(sample.net_rx_rate), note: `${t('machineSend')}: ${rate(sample.net_tx_rate)}` },
  ] : [];

  return (
    <div style={S.root}>
      <section style={S.card} aria-label={t('machineSpecs')}>
        <div style={S.heading}>
          <h3 style={S.title}><Server size={15} />{t('machineSpecs')}</h3>
          <button type="button" style={S.button} onClick={refresh} disabled={refreshing} aria-label={t('refresh')} title={t('refresh')}><RefreshCw size={14} /></button>
        </div>
        <p style={S.note}>{t('machineScope')}</p>
        {!stats && !error ? <SkeletonBlock rows={4} rowHeight="18px" widths={['70%', '90%', '60%', '70%']} /> : (
          <dl style={S.specGrid}>
            {specifications.map(([label, value]) => <div key={label} style={S.spec}><dt style={S.note}>{label}</dt><dd style={S.specValue}>{value}</dd></div>)}
          </dl>
        )}
      </section>
      <div style={S.toolbar}>
        <div style={S.controlLabel}>
          <strong style={S.title}>{t('machineMonitoring')}</strong>
          <span role="status" style={S.note}>{status}</span>
        </div>
        <button type="button" role="switch" aria-checked={monitoring} aria-label={t('machineMonitoring')} onClick={() => setMonitoring(value => !value)} style={{ ...S.button, ...segmentedItemStyle({ active: monitoring }), minHeight: 40 }}>
          <Power size={15} />{monitoring ? 'ON' : 'OFF'}
        </button>
      </div>
      {error && <div role="alert" style={{ ...S.card, color: color.danger }}>{stats ? t('machineStaleError') : t('machineLoadError')}</div>}
      {!live ? (
        <div style={S.empty}>{monitoring ? t('machineChartWaiting') : t('machineStartHint')}</div>
      ) : (
        <>
          <div style={S.heading}>
            <h3 style={S.title}>{t('machineUsage')}</h3>
            <span style={S.note}>{t('machineLastSample')}: {timeLabel(live.updatedAt)}</span>
          </div>
          <TileRow tiles={tiles} />
          <div style={S.charts}>
            <Trend history={live.history} series={resourceSeries} title={t('machineResourceTrend')} percentage interval={interval} t={t} />
            <Trend history={live.history} series={networkSeries} title={t('machineNetworkTrend')} interval={interval} t={t} />
          </div>
          <p style={S.note}>{t('machineHistoryHint')} {t('machineNetworkHint')}</p>
          <section style={S.card}>
            <h3 style={S.title}>{t('machineSystemDetails')}</h3>
            <dl style={S.specGrid}>
              {[
                [t('infoUptime'), formatUptime(sample.uptime, t)],
                [t('machineLoadAverage'), Array.isArray(sample.load_avg) ? sample.load_avg.map(value => valid(value) ? value.toFixed(2) : '—').join(' / ') : '—'],
                [t('machineMemoryAvailable'), bytes(sample.mem_available)],
                [t('machineDiskFree'), bytes(sample.disk_free)],
                [t('machineSwap'), sample.swap_total === 0 ? t('machineNotConfigured') : `${bytes(sample.swap_used)} / ${bytes(sample.swap_total)}`],
              ].map(([label, value]) => <div key={label} style={S.spec}><dt style={S.note}>{label}</dt><dd style={S.specValue}>{value}</dd></div>)}
            </dl>
          </section>
          <section style={S.card}>
            <h3 style={S.title}>{t('machineProcesses')}</h3>
            <p style={S.note}>{t('machineProcessHint')}</p>
            {sample.top_processes?.length ? (
              <table style={S.table}>
                <thead><tr>{[t('machineProcess'), 'CPU', t('infoMemory')].map(label => <th key={label} style={S.th}>{label}</th>)}</tr></thead>
                <tbody>{sample.top_processes.slice(0, 10).map(process => (
                  <tr key={process.pid}>
                    <td style={S.td}><span style={S.processName}>{process.name || '—'}</span><span style={S.note}>PID {process.pid}</span></td>
                    <td style={S.td}>{percent(process.cpu_percent)}</td>
                    <td style={S.td}>{bytes(process.rss_bytes)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p style={S.note}>{t('machineNoProcesses')}</p>}
          </section>
        </>
      )}
    </div>
  );
}

const S = {
  root: { display: 'flex', flexDirection: 'column', gap: space['3'], minWidth: 0 },
  card: { ...dashboardCardStyle(), minWidth: 0 },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space['2'], flexWrap: 'wrap' },
  title: { display: 'flex', alignItems: 'center', gap: space['2'], margin: 0, fontSize: fontSize['12'], fontWeight: fontWeight.semibold, color: color.text },
  note: { margin: 0, fontSize: fontSize['11'], lineHeight: 1.6, color: color.subtext },
  specGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: space['3'], margin: `${space['3']} 0 0` },
  spec: { minWidth: 0 },
  specValue: { margin: 0, color: color.text, fontSize: fontSize['12'], lineHeight: 1.6, overflowWrap: 'anywhere' },
  toolbar: { ...dashboardCardStyle(), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space['3'] },
  controlLabel: { display: 'flex', flexDirection: 'column', gap: space['1'], minWidth: 0 },
  button: { ...segmentedItemStyle(), minWidth: 40, minHeight: 40, flexShrink: 0 },
  empty: { ...dashboardCardStyle(), padding: space['5'], color: color.subtext, textAlign: 'center', fontSize: fontSize['12'], lineHeight: 1.7 },
  charts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: space['3'] },
  legend: { display: 'flex', flexWrap: 'wrap', gap: space['3'], marginTop: space['2'], fontSize: fontSize['11'], color: color.subtext },
  legendItem: { display: 'flex', alignItems: 'center', gap: space['1'] },
  dot: { width: 8, height: 8, borderRadius: '50%' },
  axis: { display: 'flex', justifyContent: 'space-between', gap: space['2'], marginTop: space['2'], fontSize: fontSize['10'], color: color.subtext },
  chart: { display: 'block', width: '100%', height: 150, overflow: 'hidden', marginTop: space['1'] },
  table: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', marginTop: space['3'], fontFamily: font.mono, fontSize: fontSize['11'], color: color.text },
  th: { padding: `${space['2']} ${space['1']}`, textAlign: 'left', color: color.subtext, fontWeight: fontWeight.medium, borderBottom: `1px solid ${color.border}` },
  td: { padding: `${space['2']} ${space['1']}`, borderBottom: `1px solid ${color.border}`, verticalAlign: 'top', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' },
  processName: { display: 'block', overflowWrap: 'anywhere', marginBottom: space['1'] },
};
