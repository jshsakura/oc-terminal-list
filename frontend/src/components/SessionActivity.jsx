import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatRelative = (ts) => {
  const ms = Date.now() - ts * 1000;
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

/**
 * 세션 카드 안에 인라인으로 펼쳐지는 작은 활동 로그.
 * - 백엔드의 cwd 타임라인 (최근 50개) 을 시간 역순으로 표시
 * - 절대 경로 대신 워크스페이스 상대 경로 우선
 * - 같은 cwd 가 연속이면 백엔드에서 이미 ts 만 갱신해두므로 중복 표시 없음
 */
const SessionActivity = ({ sessionId }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/activity`, { headers: authHeader() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setItems((data.items || []).slice().reverse());
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId]);

  if (loading && items.length === 0) {
    return <div style={styles.muted}>로딩 중…</div>;
  }
  if (error) {
    return <div style={styles.muted}>{error}</div>;
  }
  if (items.length === 0) {
    return <div style={styles.muted}>아직 활동 기록 없음</div>;
  }

  return (
    <div style={styles.list}>
      {items.map((it, idx) => (
        <div key={`${it.ts}-${idx}`} style={styles.row}>
          <Clock size={9} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          <span style={styles.time}>{formatRelative(it.ts)}</span>
          <span style={styles.path} title={it.cwd}>
            {it.workspace_relative === '' ? '~/' : (it.workspace_relative ?? it.cwd)}
          </span>
        </div>
      ))}
    </div>
  );
};

const styles = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: `${space['1.5']} ${space['2']}`,
    background: color.crust,
    borderTop: `1px solid ${color.border}`,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    maxHeight: '180px',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    fontSize: fontSize['11'],
    color: color.subtext,
    minHeight: '18px',
  },
  time: {
    fontFamily: font.mono,
    color: color.muted,
    flexShrink: 0,
    width: '54px',
  },
  path: {
    flex: 1,
    fontFamily: font.mono,
    color: color.subtext,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  muted: {
    padding: `${space['2']} ${space['3']}`,
    fontSize: fontSize['11'],
    color: color.muted,
    background: color.crust,
    borderTop: `1px solid ${color.border}`,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
};

export default SessionActivity;
