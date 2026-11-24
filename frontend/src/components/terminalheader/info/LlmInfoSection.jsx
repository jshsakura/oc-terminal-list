import { Bot } from 'lucide-react';
import Button from '../../common/Button';
import { InfoSection, InfoRow } from './InfoParts';
import { infoStyles } from './infoStyles';
import useLlmInfo from './useLlmInfo';
import { formatLlmCount as count, formatLlmDate as date, llmStatusKey, llmLimitLabel } from './llmInfoFormat';

export default function LlmInfoSection({ info, isVisible, t }) {
  const { data, error, busy, refresh, select } = useLlmInfo(info, isVisible);
  const text = (key) => t?.(key) || key;
  if (data?.status === 'disabled') { return null; }
  const usage = data?.usage;
  const context = usage?.context_tokens != null && usage?.context_window > 0
    ? `${Math.min(100, Math.round(usage.context_tokens / usage.context_window * 100))}% (${count(usage.context_tokens)} / ${count(usage.context_window)})`
    : '—';
  const statusKey = llmStatusKey(data?.status);
  const choosing = data?.status === 'select_session' || data?.status === 'session_unavailable';

  return (
    <InfoSection title={text('infoLlmTitle')} icon={Bot}
      action={<Button size="small" variant="ghost" disabled={busy} onClick={refresh}>{text('refresh')}</Button>}>
      {data?.agent && <InfoRow label={text('infoLlmAgent')} value={data.agent} mono={false} wrap />}
      {error && <div role="alert" style={infoStyles.note}>{text('infoLlmFailed')} ({error})</div>}
      {!data && !error && <div role="status" style={infoStyles.note}>{text(busy ? 'loading' : 'infoLlmUnavailable')}</div>}
      {statusKey && <div role="status" style={infoStyles.note}>{text(statusKey)}</div>}
      {choosing && data.sessions?.map((session) => (
        <Button key={session.id} size="small" fullWidth onClick={() => select(session.id)}
          style={{ height: 'auto', whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start', overflowWrap: 'anywhere' }}>
          {session.model || 'Codex'} · {session.id.slice(-8)} · {date(session.updated_at, true)}
        </Button>
      ))}
      {usage && (
        <>
          {data.match === 'selected' && <div style={infoStyles.note}>{text('infoLlmSelected')}</div>}
          <InfoRow label={text('infoLlmModel')} value={usage.model || '—'} mono={false} wrap />
          <InfoRow label={text('infoLlmEffort')} value={usage.effort || '—'} wrap />
          <InfoRow label={text('infoLlmContext')} value={context} wrap />
          <InfoRow label={text('infoLlmInput')} value={count(usage.input_tokens)} wrap />
          <InfoRow label={text('infoLlmOutput')} value={count(usage.output_tokens)} wrap />
          <InfoRow label={text('infoLlmUpdated')} value={date(usage.updated_at)} mono={false} wrap />
          {(usage.limits || []).map((limit, index) => {
            const label = llmLimitLabel(limit, text);
            return (
              <div key={`${limit.window_minutes}-${index}`}>
                <InfoRow label={label} value={`${count(limit.remaining_percent)}% ${text('infoLlmLeft')}`} wrap />
                <InfoRow label={text('infoLlmReset')} value={date(limit.resets_at, true)} mono={false} wrap />
              </div>
            );
          })}
          {!(usage.limits?.length) && <InfoRow label={text('infoLlmLimits')} value="—" wrap />}
          {usage.limits?.length > 0 && <InfoRow label={text('infoLlmLimitsUpdated')} value={date(usage.limits_updated_at)} mono={false} wrap />}
          <div style={infoStyles.note}>{text('infoLlmSnapshot')}</div>
          {data.match === 'selected' && <Button size="small" onClick={() => select(null)}>{text('infoLlmChangeSession')}</Button>}
        </>
      )}
    </InfoSection>
  );
}
