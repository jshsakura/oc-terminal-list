import { Gauge } from 'lucide-react';
import GlassModal from '../common/GlassModal';
import { tokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import useLlmInfo from './info/useLlmInfo';
import { formatLlmCount as count, formatLlmDate as date, llmStatusKey, llmLimitLabel } from './info/llmInfoFormat';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

function Metric({ label, value, note, percent }) {
  return <section aria-label={label} style={styles.card}>
    <div style={styles.caption}>{label}</div>
    <div style={styles.value}>{value}</div>
    {typeof percent === 'number' && <div role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} style={styles.track}>
      <div style={{ ...styles.fill, width: `${percent}%` }} />
    </div>}
    {note && <div style={styles.caption}>{note}</div>}
  </section>;
}

export default function UsageModal({ info, isOpen, onClose, ui, t, onSnapshot }) {
  const { data, error } = useLlmInfo(info, isOpen, { currentOnly: true, poll: false, onSnapshot });
  const usage = data?.usage;
  const context = usage?.context_tokens != null && usage?.context_window > 0
    ? Math.min(100, Math.round(usage.context_tokens / usage.context_window * 100)) : null;
  const statusKey = llmStatusKey(data?.status);
  const name = info?.paneName || info?.tabName || info?.sessionId || '—';
  const themeVars = Object.fromEntries(Object.entries(ui || {}).map(([key, value]) => [`--ui-${key}`, value]));

  return <div style={themeVars}>
    <GlassModal isOpen={isOpen} onClose={onClose} title={t('paneUsageDetails')} titleIcon={Gauge}
      closeTitle={t('close')} width="100%" maxWidth="640px" maxHeight="92%"
      titleStyle={styles.title} panelStyle={{ background: color.base }} bodyStyle={styles.body}>
      <div style={styles.identity}>
        <div style={styles.caption}>{t('infoLlmTitle')} · {name}</div>
        {usage && <>
          <div style={styles.model}>{usage.model || '—'}</div>
          <div>{data.agent} · {t('infoLlmEffort')} {usage.effort || '—'}</div>
          <p style={styles.updatedAt}>{t('infoLlmUpdated')}: {date(usage.updated_at)}</p>
        </>}
      </div>
      {error && <div role="alert">{t('infoLlmFailed')} ({error})</div>}
      {!data && !error && <div role="status">{t('loading')}</div>}
      {statusKey && <div role="status">{t(statusKey)}</div>}
      {usage && <>
        <div style={styles.metrics}>
          <Metric label={t('paneUsageContext')} value={context == null ? '—' : `${context}%`} percent={context}
            note={`${count(usage.context_tokens)} / ${count(usage.context_window)} ${t('paneUsageTokens')}`} />
          {(usage.limits || []).map((limit, index) => <Metric key={`${limit.window_minutes}-${index}`}
            label={`${llmLimitLabel(limit, t)} · ${t('infoLlmLeft')}`} value={`${count(limit.remaining_percent)}%`}
            percent={limit.remaining_percent} note={`${t('infoLlmReset')} ${date(limit.resets_at, true)}`} />)}
          {!usage.limits?.length && <Metric label={t('infoLlmLimits')} value="—" />}
        </div>
        <div style={styles.tokenMetrics}>
          <Metric label={t('infoLlmInput')} value={count(usage.input_tokens)} />
          <Metric label={t('infoLlmOutput')} value={count(usage.output_tokens)} />
        </div>
        <details>
          <summary style={styles.summary}>{t('paneUsageSessionDetails')}</summary>
          <dl style={styles.details}>
            <dt>{t('infoSessionId')}</dt><dd style={styles.id}>{info?.sessionId || '—'}</dd>
            <dt>{t('paneUsageLlmSession')}</dt><dd style={styles.id}>{usage.thread_id || '—'}</dd>
            <dt>{t('infoLlmLimitsUpdated')}</dt><dd style={styles.id}>{date(usage.limits_updated_at)}</dd>
          </dl>
        </details>
      </>}
    </GlassModal>
  </div>;
}

const styles = {
  title: { fontSize: fontSize['16'] },
  body: { padding: space['4'], gap: space['4'], minHeight: 0, color: color.text, fontSize: fontSize['14'], lineHeight: 1.5, overflowWrap: 'anywhere' },
  identity: { display: 'flex', flexDirection: 'column', gap: space['1'] },
  model: { fontSize: fontSize['18'], fontWeight: fontWeight.semibold, overflowWrap: 'anywhere' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space['3'] },
  tokenMetrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))', gap: space['3'] },
  card: { ...dashboardCardStyle(), minWidth: 0, display: 'flex', flexDirection: 'column', gap: space['2'] },
  caption: { color: color.subtext, fontSize: fontSize['13'], lineHeight: 1.5, margin: 0, overflowWrap: 'anywhere' },
  value: { fontSize: fontSize['24'], fontWeight: fontWeight.semibold, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25, overflowWrap: 'anywhere' },
  track: { height: space['1.5'], borderRadius: radius.full, background: color.surface2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full, background: color.accent },
  updatedAt: { margin: `${space['2']} 0 0`, fontSize: fontSize['16'], fontWeight: fontWeight.semibold },
  summary: { cursor: 'pointer', color: color.subtext, padding: `${space['2']} 0` },
  details: { margin: 0, display: 'grid', gap: space['1'], fontSize: fontSize['13'] },
  id: { margin: `0 0 ${space['2']}`, fontFamily: font.mono, overflowWrap: 'anywhere' },
};
