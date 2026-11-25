export const formatLlmCount = (value) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const formatLlmDate = (value, seconds = false) => {
  if (value == null) { return '—'; }
  const parsed = new Date(seconds ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
};

export const llmStatusKey = (status) => ({
  no_agent: 'infoLlmNoAgent', no_terminal: 'infoLlmNoTerminal', unsupported: 'infoLlmUnsupported',
  unavailable: 'infoLlmUnavailable', session_unavailable: 'infoLlmSessionUnavailable',
  select_session: 'infoLlmChooseSession', disabled: 'llmUsageOff', session_unmatched: 'paneUsageUnmatched',
})[status];

export function weeklyLimitUsed(usage) {
  const weekly = usage?.limits?.find(limit => limit.window_minutes === 10080);
  const used = Number.isFinite(weekly?.used_percent) ? weekly.used_percent
    : Number.isFinite(weekly?.remaining_percent) ? 100 - weekly.remaining_percent : null;
  return used === null ? null : Math.min(100, Math.max(0, Math.round(used)));
}

export const llmLimitLabel = (limit, t) => limit.window_minutes === 300 ? t('infoLlmFiveHour')
  : limit.window_minutes === 10080 ? t('infoLlmWeekly')
    : t('infoLlmMinutes').replace('{n}', formatLlmCount(limit.window_minutes));
