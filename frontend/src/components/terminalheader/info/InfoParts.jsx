/** Info 패널의 표시용 조각들 — 섹션/행/메모리 스택바/막대. 상태 없음. */
import { Copy, Check } from 'lucide-react';
import { tokens } from '../../../styles/tokens';
import { infoStyles } from './infoStyles';
import { formatBytes } from './infoFormat';

const { color } = tokens;

const InfoSection = ({ title, icon: Icon, subtitle = null, action = null, children }) => (
  <div className="iterm-info-section" style={infoStyles.section}>
    <div style={infoStyles.sectionHeader}>
      {Icon && <Icon size={11} strokeWidth={2} style={{ color: 'var(--ui-subtext)', flexShrink: 0 }} />}
      <span style={{ ...infoStyles.sectionTitle, color: 'var(--ui-subtext)' }}>{title}</span>
      {subtitle && <span style={{ ...infoStyles.sectionSubtitle, color: 'var(--ui-subtext)' }}>{subtitle}</span>}
      {action && <span style={{ marginLeft: subtitle ? '4px' : 'auto', display: 'inline-flex', alignItems: 'center' }}>{action}</span>}
    </div>
    <div style={infoStyles.sectionBody}>
      {children}
    </div>
  </div>
);

const InfoRow = ({ label, value, mono = true, accent = false, copyable = false, onCopy, copied = false, icon: Icon = null }) => (
  <div style={infoStyles.row}>
    <span style={{ ...infoStyles.rowLabel, color: 'var(--ui-subtext)' }}>{label}</span>
    <span style={{
      ...infoStyles.rowValue,
      ...(mono ? infoStyles.rowValueMono : null),
      color: accent ? 'var(--ui-accent)' : 'var(--ui-text)',
    }}>
      {Icon && <Icon size={10} strokeWidth={2} style={{ marginRight: '4px', opacity: 0.7 }} />}
      <span style={infoStyles.rowValueText} title={typeof value === 'string' ? value : undefined}>{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          style={infoStyles.copyBtn}
          title="Copy"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ui-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ui-subtext)'; }}
        >
          {copied ? <Check size={10} strokeWidth={2.4} /> : <Copy size={10} strokeWidth={2} />}
        </button>
      )}
    </span>
  </div>
);

const MemoryStackBar = ({ stats }) => {
  const memTotal = Number(stats.mem_total) || 0;
  const swapTotal = Number(stats.swap_total) || 0;
  const total = memTotal + swapTotal;
  const used = Math.max(0, Number(stats.mem_used) || 0);
  const cache = Math.max(0, (Number(stats.mem_cache) || 0) + (Number(stats.mem_buffers) || 0));
  const swapUsed = Math.max(0, Number(stats.swap_used) || 0);
  const free = Math.max(0, total - used - cache - swapUsed);
  const pct = (value) => total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const segments = [
    { key: 'used', label: 'Used', value: used, color: 'var(--ui-accent, #89b4fa)' },
    { key: 'cache', label: 'Cache', value: cache, color: 'var(--ui-warning, #f9e2af)' },
    { key: 'swap', label: 'Swap', value: swapUsed, color: 'var(--ui-danger, #f38ba8)' },
    { key: 'free', label: 'Free', value: free, color: 'var(--ui-surface2, #585b70)' },
  ].filter((item) => item.value > 0 || item.key === 'free');

  return (
    <div style={infoStyles.statRow}>
      <div style={infoStyles.statHeader}>
        <span style={infoStyles.statLabel}>Memory</span>
        <span style={infoStyles.statRight}>
          {memTotal ? `${formatBytes(used)} used · ${formatBytes(cache)} cache${swapTotal ? ` · ${formatBytes(swapUsed)} swap` : ''}` : `${(stats.ram ?? 0).toFixed(1)}%`}
        </span>
      </div>
      <div style={infoStyles.stackTrack}>
        {segments.map((item) => (
          <span
            key={item.key}
            title={`${item.label}: ${formatBytes(item.value)}`}
            style={{
              ...infoStyles.stackSegment,
              width: `${pct(item.value)}%`,
              background: item.color,
              opacity: item.key === 'free' ? 0.45 : 0.95,
            }}
          />
        ))}
      </div>
      <div style={infoStyles.stackLegend}>
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-accent, #89b4fa)' }} />Used</span>
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-warning, #f9e2af)' }} />Cache</span>
        {swapTotal > 0 && <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-danger, #f38ba8)' }} />Swap</span>}
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-surface2, #585b70)' }} />Free</span>
      </div>
    </div>
  );
};

const StatBar = ({ label, percent = 0, right = '' }) => {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const tone =
    safe >= 90 ? 'var(--ui-danger, #f38ba8)'
    : safe >= 75 ? 'var(--ui-warning, #f9e2af)'
    : 'var(--ui-accent, #89b4fa)';
  return (
    <div style={infoStyles.statRow}>
      <div style={infoStyles.statHeader}>
        <span style={infoStyles.statLabel}>{label}</span>
        <span style={infoStyles.statRight}>{right}</span>
      </div>
      <div style={infoStyles.barTrack}>
        <div style={{
          ...infoStyles.barFill,
          width: `${safe}%`,
          background: tone,
          boxShadow: `0 0 12px ${tone}55`,
          transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
    </div>
  );
};

export { InfoSection, InfoRow, MemoryStackBar, StatBar };
