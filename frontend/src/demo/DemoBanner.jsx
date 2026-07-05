import { PlayCircle, Github } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontWeight } = tokens;

const REPO_URL = 'https://github.com/jshsakura/oc-terminal-list';

/**
 * Sticky banner explaining this is a scripted, read-only preview — not a live
 * server. Keeps the "admin/admin" ask honest without exposing a real shell.
 */
const DemoBanner = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      background: `color-mix(in srgb, ${color.accent} 12%, var(--ui-mantle))`,
      borderBottom: '1px solid var(--ui-border)',
      fontFamily: font.sans,
      fontSize: '12px',
      color: color.subtext,
      flexShrink: 0,
      flexWrap: 'wrap',
    }}
  >
    <PlayCircle size={14} strokeWidth={2} style={{ color: color.accent, flexShrink: 0 }} />
    <span style={{ fontWeight: fontWeight.semibold, color: color.text }}>Live Demo</span>
    <span>— scripted playback, sample hosts, no real shell or backend. Nothing you see here is a real server.</span>
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      style={{
        marginLeft: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        color: color.accent,
        textDecoration: 'none',
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
      }}
    >
      <Github size={13} strokeWidth={2} />
      Get it for your own server
    </a>
  </div>
);

export default DemoBanner;
