import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RailIconBtn from '../common/RailIconBtn';
import { useHoverTip } from '../tabBar/TabTooltip';
import { tokens } from '../../styles/tokens';
import { readableForeground } from '../../styles/themeUI';
import useLlmInfo from './info/useLlmInfo';
import { llmStatusKey, weeklyLimitUsed } from './info/llmInfoFormat';

const { color, font, fontSize, space, radius, shadow, z } = tokens;
const HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const compactCount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const count = (value) => typeof value === 'number' && Number.isFinite(value) ? compactCount.format(value) : '—';

function UsageTooltip({ live, data, error, id, placement, ui, t, onMouseEnter, onMouseLeave }) {
  const usage = data?.usage;
  const statusKey = llmStatusKey(data?.status);
  const context = Number.isFinite(usage?.context_tokens) && usage?.context_window > 0
    ? `${Math.max(0, Math.min(100, Math.round(usage.context_tokens / usage.context_window * 100)))}%` : '—';
  const weekly = usage?.limits?.find((limit) => limit.window_minutes === 10080);
  const used = live ? 100 - live.remaining : weeklyLimitUsed(usage);
  const remaining = live ? `${live.remaining}%` : Number.isFinite(weekly?.remaining_percent) ? `${weekly.remaining_percent}%` : used === null ? '—' : `${100 - used}%`;
  let message = t('loading');
  if (!live && error) {
    message = `${t('infoLlmFailed')} (${error})`;
  } else if (!live && statusKey) {
    message = t(statusKey);
  } else if (live || usage) {
    const ink = ui?.surface1 ? readableForeground(ui.surface1, '#ffffff') : color.text;
    message = [
      [color.accent, live?.model ?? `${usage?.model || '—'} ${usage?.effort || '—'}`],
      [color.warning, `${t('paneUsageContext')} ${live?.context ?? context}`],
      [color.info, `${t('infoLlmInput')} ${live?.input ?? count(usage?.input_tokens)}`],
      [color.success, `${t('infoLlmOutput')} ${live?.output ?? count(usage?.output_tokens)}`],
      [`color-mix(in srgb, ${color.accent}, ${color.danger})`, used === null ? `${t('infoLlmWeekly')} ${remaining} ${t('infoLlmLeft')}`
        : `${t('paneWeeklyUsed').replace('{n}', used)} (${remaining} ${t('infoLlmLeft')})`],
    ].map(([tone, text], index) => (
      <Fragment key={tone}>{index > 0 && ' · '}<span style={{ color: `color-mix(in srgb, ${tone} 60%, ${ink})` }}>{text}</span></Fragment>
    ));
  } else if (data) {
    message = t('infoLlmUnavailable');
  }
  const themeVars = Object.fromEntries(Object.entries(ui || {}).map(([key, value]) => [`--ui-${key}`, value]));
  return createPortal(<div id={id} role="tooltip" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
    style={{ ...styles.tooltip, ...themeVars, ...placement,
      maxWidth: Math.min(800, window.innerWidth - (placement.left ?? placement.right) - 8) }}>
    {message}
  </div>, document.body);
}

export default function UsageButton({ info, isPaneVisible, active, disabled, ui, t, onClick, weekly, onSnapshot, watchUsage }) {
  const [canHover, setCanHover] = useState(() => window.matchMedia?.(HOVER_QUERY).matches ?? false);
  const enabled = canHover && isPaneVisible && !active && !disabled;
  const { placement, show, hide } = useHoverTip(enabled);
  const [observed, setObserved] = useState(null);
  useEffect(() => {
    setObserved(null);
    if (!isPaneVisible || disabled || !watchUsage) { return undefined; }
    return watchUsage(value => setObserved(value && { source: watchUsage, value }));
  }, [isPaneVisible, disabled, watchUsage]);
  const live = isPaneVisible && !disabled && observed?.source === watchUsage ? observed?.value : null;
  const tooltipOpen = Boolean(enabled && placement);
  const needsFallback = tooltipOpen && !live;
  const [fallbackOpened, setFallbackOpened] = useState(false);
  useEffect(() => {
    if (!tooltipOpen) { setFallbackOpened(false); }
    else if (needsFallback) { setFallbackOpened(true); }
  }, [tooltipOpen, needsFallback]);
  const { data, error } = useLlmInfo(info, tooltipOpen && fallbackOpened, { currentOnly: true, poll: false, onSnapshot });
  const used = live ? 100 - live.remaining : weekly ? weekly.used : weeklyLimitUsed(data?.usage);
  const description = used === null ? t('paneWeeklyUnknown') : t('paneWeeklyUsed').replace('{n}', used);
  const id = useId();
  const leaveTimer = useRef(null);
  const focused = useRef(false);
  const keepOpen = useCallback(() => clearTimeout(leaveTimer.current), []);
  const close = useCallback(() => { keepOpen(); hide(); }, [keepOpen, hide]);
  const leave = () => {
    if (focused.current) { return; }
    if (!placement) { close(); return; }
    keepOpen();
    leaveTimer.current = setTimeout(hide, 120);
  };

  useEffect(() => {
    const query = window.matchMedia?.(HOVER_QUERY);
    if (!query) { return undefined; }
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!enabled || !placement) { return undefined; }
    const onKeyDown = (event) => { if (event.key === 'Escape') { close(); } };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      keepOpen();
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [enabled, placement, close, keepOpen]);
  useEffect(() => () => keepOpen(), [keepOpen]);

  return <>
    <RailIconBtn round ariaLabel={t?.('paneUsage') || 'Usage'} ariaDescription={description}
      ariaDescribedBy={enabled && placement ? id : undefined}
      onMouseEnter={(event) => { keepOpen(); if (!placement) { show(event); } }}
      onMouseLeave={leave}
      onFocus={(event) => { focused.current = true; keepOpen(); show(event); }}
      onBlur={() => { focused.current = false; close(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { close(); } }}
      onClick={(event) => { onClick(event); close(); }}
      active={active} disabled={disabled} ui={ui} compact>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" opacity={used === null ? 0.5 : 0.3}
          strokeDasharray={used === null ? '2 2' : undefined} />
        {used > 0 && <circle cx="12" cy="12" r="9.5" pathLength="100" stroke={ui?.accent || color.accent} strokeWidth="2.5"
          strokeDasharray={`${used} 100`} transform="rotate(-90 12 12)" />}
      </svg>
    </RailIconBtn>
    {enabled && placement && <UsageTooltip live={live} data={data} error={error} id={id} placement={placement} ui={ui} t={t}
      onMouseEnter={keepOpen} onMouseLeave={leave} />}
  </>;
}

const styles = {
  tooltip: {
    position: 'fixed', zIndex: z.popover, width: 'max-content', boxSizing: 'border-box',
    padding: `${space['1.5']} ${space['2.5']}`, background: color.surface1, color: color.text,
    border: `1px solid ${color.borderStrong}`, borderRadius: radius.sm, boxShadow: shadow.md,
    fontFamily: font.mono, fontSize: fontSize['12'], lineHeight: 1.5, overflowWrap: 'anywhere',
  },
};
