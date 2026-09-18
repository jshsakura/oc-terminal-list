/**
 * 상위 프로세스 목록 + 종료 버튼.
 *
 * kill 은 백엔드 OS 사용자 소유 프로세스만 허용된다(서버에서 uid 확인).
 * 여기서는 SIGTERM 을 먼저 보내고, 사용자가 다시 누르면 SIGKILL 로 올린다.
 */
import { useState, useCallback } from 'react';
import { XCircle, Zap } from 'lucide-react';
import { tokens } from '../../../styles/tokens';
import { infoStyles } from './infoStyles';
import { formatBytes } from './infoFormat';
import { authHeaders } from '../../../utils/auth';

const { color } = tokens;

const ProcessActionButton = ({ label, disabled, onClick, tone, children }) => {
  const [hovered, setHovered] = useState(false);
  const interactive = !disabled;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => { if (interactive) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...infoStyles.processKillBtn,
        opacity: interactive ? 0.85 : 0.35,
        cursor: interactive ? 'pointer' : 'not-allowed',
        background: interactive && hovered ? `color-mix(in srgb, ${tone} 24%, transparent)` : 'transparent',
        color: interactive && hovered ? tone : color.subtext,
      }}
    >
      {children}
    </button>
  );
};

const ProcessList = ({ processes, onRefresh }) => {
  const [pending, setPending] = useState(null); // pid currently sending kill
  const [error, setError] = useState(null);

  const sendKill = useCallback(async (pid, sig) => {
    const label = sig === 'kill' ? 'force kill (SIGKILL)' : 'terminate (SIGTERM)';
    if (!window.confirm(`PID ${pid} — ${label}?`)) return;
    setPending(pid);
    setError(null);
    try {
      const res = await fetch(`/api/system/processes/${pid}/kill`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ signal: sig }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      // 백엔드가 다음 stats 폴링 때 자연스럽게 빠짐. 즉시 한 번 더 당김.
      onRefresh?.();
    } catch (e) {
      setError(`pid ${pid}: ${e.message}`);
    } finally {
      setPending(null);
    }
  }, [onRefresh]);

  return (
    <div style={infoStyles.processBox}>
      <div style={infoStyles.processHeader}>
        <span>Top processes</span>
        <span style={{ textAlign: 'right' }}>CPU · RSS</span>
      </div>
      {error && (
        <div style={infoStyles.processError}>{error}</div>
      )}
      {processes.slice(0, 8).map((proc) => {
        const canKill = proc.is_mine !== false; // 명시적으로 false 가 아니면 시도 허용
        const isPending = pending === proc.pid;
        return (
          <div key={proc.pid} style={infoStyles.processRow}>
            <div style={infoStyles.processMain}>
              <div style={infoStyles.processNameRow}>
                <span style={{ ...infoStyles.processName, color: proc.llm_like ? color.accent : color.text }}>
                  {proc.name || `pid ${proc.pid}`}
                </span>
                <span style={infoStyles.processMeta}>
                  pid {proc.pid}
                  {proc.user ? ` · ${proc.user}` : ''}
                </span>
              </div>
              <span style={infoStyles.processCmd} title={proc.cmd}>{proc.cmd || `pid ${proc.pid}`}</span>
            </div>
            {proc.llm_like && <span style={infoStyles.processBadge}>LLM</span>}
            <div style={infoStyles.processStats}>
              <span style={infoStyles.processCpu}>{(proc.cpu_percent ?? 0).toFixed(1)}%</span>
              <span style={infoStyles.processMem}>{formatBytes(proc.rss_bytes)}</span>
            </div>
            <div style={infoStyles.processActions}>
              <ProcessActionButton
                label={canKill ? 'Terminate (SIGTERM)' : 'Not your process'}
                onClick={() => sendKill(proc.pid, 'term')}
                disabled={!canKill || isPending}
                tone={color.warning}
              >
                <XCircle size={12} strokeWidth={2} />
              </ProcessActionButton>
              <ProcessActionButton
                label={canKill ? 'Force kill (SIGKILL)' : 'Not your process'}
                onClick={() => sendKill(proc.pid, 'kill')}
                disabled={!canKill || isPending}
                tone={color.danger}
              >
                <Zap size={12} strokeWidth={2} />
              </ProcessActionButton>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ProcessList;
