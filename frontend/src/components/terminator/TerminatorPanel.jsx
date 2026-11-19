/**
 * Terminator: the Terminal List companion, as an easy view over a real terminal.
 *
 * It overlays the right side (a bottom sheet on phones) instead of pushing the terminals
 * aside: pushing would resize every pane, and tmux would reflow every agent screen each
 * time the panel opens or closes. The conversation comes from Terminator's transcript;
 * the 터미널 view attaches the real terminal behind it right here, so nothing is hidden
 * and nothing has to open a tab.
 */
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Send, CornerDownRight, Wrench, Check, AlertTriangle } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import useTerminator from '../../hooks/useTerminator';
import { getAgentStatusSnapshot, subscribeAgentStatus } from '../../utils/agentStatusStore';

const Terminal = lazy(() => import('../Terminal'));

const { color, font, fontSize, fontWeight, space, radius } = tokens;
const PANEL_WIDTH_PX = 380;
// A terminal needs room for the agent's TUI; the chat does not.
const PANEL_TERMINAL_WIDTH_PX = 600;
const LOGIN_TOOLS = [['claude', 'Claude'], ['codex', 'Codex'], ['github', 'GitHub']];

const glass = {
  background: 'color-mix(in srgb, var(--ui-base, #1e1e2e) var(--modal-fill, 72%), transparent)',
  border: '1px solid color-mix(in srgb, var(--ui-border, #45475a) var(--modal-line, 60%), transparent)',
  backdropFilter: 'blur(var(--modal-blur, 28px)) saturate(140%)',
  WebkitBackdropFilter: 'blur(var(--modal-blur, 28px)) saturate(140%)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.34)',
};

const useWorkerStatuses = (tabs) => {
  const [snap, setSnap] = useState(getAgentStatusSnapshot);
  useEffect(() => subscribeAgentStatus(() => setSnap(getAgentStatusSnapshot())), []);
  return useMemo(() => (tabs || [])
    .filter((tab) => tab?.openedBy === 'terminator')
    .map((tab) => {
      const pane = (tab.panes || [])[0];
      return { id: tab.id, name: tab.name, status: pane?.sessionId ? snap[pane.sessionId]?.status : null };
    }), [tabs, snap]);
};

const statusLabel = (status, t) => ({
  working: t?.('terminatorWorking') || '작업 중',
  permission: t?.('terminatorNeedsYou') || '확인 필요',
  idle: t?.('terminatorIdle') || '대기',
}[status] || '');

const formatTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));

// Model · effort · context, the same facts Claude Code's status line shows.
const engineLine = (engine, contextUsed) => {
  if (!engine) return '';
  const parts = [engine.model?.toUpperCase(), engine.effort && `effort ${engine.effort}`];
  if (engine.contextLimit) parts.push(`${formatTokens(contextUsed || 0)} / ${formatTokens(engine.contextLimit)}`);
  return parts.filter(Boolean).join(' · ');
};

// A tool item is one routing step: what was done, then whether it worked and where it went.
const ToolChip = ({ item }) => {
  const failed = item.ok === false;
  const Icon = item.ok === true ? Check : failed ? AlertTriangle : Wrench;
  return (
    <div style={{ ...styles.toolChip, color: failed ? color.danger : color.muted }}>
      <Icon size={11} aria-hidden="true" style={item.ok === true ? { color: color.success } : undefined} />
      <span>{item.text}</span>
      {item.detail && <span style={styles.toolDetail}>{failed ? item.detail : `→ ${item.detail}`}</span>}
    </div>
  );
};

const Bubble = ({ item, t }) => {
  if (item.role === 'tool') return <ToolChip item={item} />;
  const mine = item.role === 'user';
  const report = item.role === 'report';
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        ...styles.bubble,
        ...(mine ? styles.bubbleMine : null),
        ...(report ? styles.bubbleReport : null),
        opacity: item.pending ? 0.7 : 1,
      }}>
        {report && (
          <div style={styles.reportHead}>
            <CornerDownRight size={11} aria-hidden="true" />
            {(t?.('terminatorReport') || '보고')} · {item.from}
          </div>
        )}
        {item.text}
      </div>
    </div>
  );
};

const TerminatorPanel = ({ open, onClose, tabs, onSelectTab, isMobile = false, settings, t }) => {
  const { status, phase, error, messages, isThinking, say, retry, contextUsed } = useTerminator(open);
  const workers = useWorkerStatuses(tabs);
  const [view, setView] = useState('chat');      // chat | terminal
  const [draft, setDraft] = useState('');
  const [hiddenForSpotlight, setHiddenForSpotlight] = useState(false);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const knownWorkerIds = useRef(null);

  // Remember which worker tabs existed when the panel opened; a new one means Terminator
  // just handed work off, so go there (the design's "작업 준비 완료" moment).
  useEffect(() => {
    if (!open) { knownWorkerIds.current = null; return; }
    const ids = new Set(workers.map((w) => w.id));
    if (knownWorkerIds.current === null) { knownWorkerIds.current = ids; return; }
    const fresh = workers.find((w) => !knownWorkerIds.current.has(w.id));
    knownWorkerIds.current = ids;
    if (fresh) { onSelectTab?.(fresh.id); onClose?.(); }
  }, [open, workers, onSelectTab, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const id = view === 'chat'
      ? requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
      : 0;
    return () => { document.removeEventListener('keydown', onKey); cancelAnimationFrame(id); };
  }, [open, onClose, view]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isThinking, view]);

  // Step aside while a spotlight points at something this panel covers.
  useEffect(() => {
    const shown = (e) => {
      const rect = e.detail?.rect;
      const mine = panelRef.current?.getBoundingClientRect();
      if (!rect || !mine) return;
      const overlaps = rect.left < mine.right && rect.right > mine.left && rect.top < mine.bottom && rect.bottom > mine.top;
      if (overlaps) setHiddenForSpotlight(true);
    };
    const done = () => setHiddenForSpotlight(false);
    window.addEventListener('iterm:spotlight-shown', shown);
    window.addEventListener('iterm:spotlight-done', done);
    return () => {
      window.removeEventListener('iterm:spotlight-shown', shown);
      window.removeEventListener('iterm:spotlight-done', done);
    };
  }, []);

  if (!open) return null;

  const send = async () => {
    const text = draft;
    if (!text.trim() || phase !== 'ready') return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = `${SEND_SIZE_PX}px`;
    const ok = await say(text);
    if (!ok) setDraft(text);
  };

  const canShowTerminal = !!(status?.running && status.sessionId);
  const showTerminal = view === 'terminal' && canShowTerminal;
  const placement = isMobile
    ? { left: 0, right: 0, bottom: 0, height: '74dvh', borderRadius: `${radius.xl} ${radius.xl} 0 0` }
    : {
      top: '44px', right: '8px', bottom: '8px', borderRadius: radius.xl,
      width: `min(${showTerminal ? PANEL_TERMINAL_WIDTH_PX : PANEL_WIDTH_PX}px, calc(100vw - 16px))`,
    };
  const meta = engineLine(status?.engine, contextUsed);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t?.('terminator') || '터미네이터'}
      data-terminator-panel=""
      style={{
        ...styles.panel, ...glass, ...placement,
        opacity: hiddenForSpotlight ? 0 : 1,
        pointerEvents: hiddenForSpotlight ? 'none' : 'auto',
      }}
    >
      <div style={styles.header}>
        <div style={styles.headRow}>
          <Sparkles size={15} aria-hidden="true" style={{ color: color.accent, flexShrink: 0 }} />
          <span style={styles.title}>{t?.('terminator') || '터미네이터'}</span>
          <span style={{ flex: 1 }} />
          {canShowTerminal && (
            <div role="tablist" style={styles.segment}>
              {[['chat', t?.('terminatorChat') || '대화'], ['terminal', t?.('terminatorTerminal') || '터미널']].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => setView(id)}
                  style={{ ...styles.segmentBtn, ...(view === id ? styles.segmentOn : null) }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={onClose} style={styles.iconBtn} aria-label={t?.('close') || '닫기'}>
            <X size={15} />
          </button>
        </div>
        {status && (
          <div style={styles.metaRow}>
            <span style={styles.engine} title={t?.('terminatorEngineHint') || '모델 · 생각 깊이 · 쓰고 있는 컨텍스트'}>{meta}</span>
            <span style={styles.logins}>
            {LOGIN_TOOLS.map(([key, label]) => (
              <span key={key} style={styles.login} title={status.logins?.[key] ? (t?.('terminatorLoggedIn') || '로그인되어 있습니다') : (t?.('terminatorLoggedOut') || '로그인이 필요합니다')}>
                <span style={{ ...styles.dot, width: '6px', height: '6px', background: status.logins?.[key] ? color.success : color.faint }} />
                {label}
              </span>
            ))}
            </span>
          </div>
        )}
      </div>

      {showTerminal ? (
        <div style={styles.terminalBox}>
          <Suspense fallback={null}>
            <Terminal
              sessionId={status.sessionId}
              paneId={`terminator:${status.sessionId}`}
              isMobile={isMobile}
              settings={settings}
              isActive
              isFocused
              onClosePane={() => setView('chat')}
            />
          </Suspense>
        </div>
      ) : (<>
      {workers.length > 0 && (
        <div style={styles.tasks}>
          <div style={styles.sectionLabel}>{t?.('terminatorTasks') || '맡긴 일'}</div>
          {workers.map((w) => (
            <button key={w.id} type="button" style={styles.taskRow} onClick={() => { onSelectTab?.(w.id); onClose?.(); }}>
              <span style={{ ...styles.dot, background: w.status === 'working' ? color.accent : w.status === 'permission' ? color.warning : color.muted }} />
              <span style={styles.taskName}>{w.name}</span>
              <span style={styles.taskStatus}>{statusLabel(w.status, t)}</span>
            </button>
          ))}
        </div>
      )}

      <div ref={listRef} style={styles.messages}>
        {phase === 'checking' && <div style={styles.note}>…</div>}
        {phase === 'starting' && <div style={styles.note}>{t?.('terminatorStarting') || '터미네이터를 깨우는 중입니다'}</div>}
        {status && !status.configured && (
          <div style={styles.note}>{t?.('terminatorNoKey') || '터미네이터 연결이 아직 설정되지 않았습니다. 관리자에게 연결을 요청합니다.'}</div>
        )}
        {phase === 'error' && (
          <div style={{ ...styles.note, color: color.danger }}>
            {(t?.('terminatorStartFailed') || '터미네이터를 켜지 못했습니다')}: {error}
            <button type="button" onClick={retry} style={{ ...styles.headBtn, marginTop: space[2] }}>{t?.('retry') || '다시 시도'}</button>
          </div>
        )}
        {phase === 'ready' && messages.length === 0 && (
          <div style={styles.note}>{t?.('terminatorEmpty') || '무엇을 도와드릴까요? 예: "로그인 버튼 색 바꿔 줘", "파일 올리는 법 알려 줘"'}</div>
        )}
        {messages.map((item) => <Bubble key={item.id} item={item} t={t} />)}
        {phase === 'ready' && isThinking && <div style={styles.thinking} aria-label="…">•••</div>}
      </div>

      <form style={styles.inputRow} onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          disabled={phase !== 'ready'}
          onChange={(e) => { setDraft(e.target.value); fitInput(e.target); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          placeholder={t?.('terminatorPlaceholder') || '하고 싶은 일을 말로 씁니다'}
          style={styles.input}
        />
        <button type="submit" disabled={phase !== 'ready' || !draft.trim()} style={styles.sendBtn} aria-label={t?.('terminatorSend') || '보내기'}>
          <Send size={15} />
        </button>
      </form>
      </>)}
    </div>
  );
};

const SEND_SIZE_PX = 32;
const INPUT_LINE_PX = 20;
const COMPOSER_PAD_PX = 4;
const INPUT_MAX_PX = 140;

// Grow the textarea with its content; reset first so it can also shrink.
const fitInput = (el) => {
  if (!el) return;
  el.style.height = `${SEND_SIZE_PX}px`;
  el.style.height = `${Math.min(INPUT_MAX_PX, Math.max(SEND_SIZE_PX, el.scrollHeight))}px`;
};

const styles = {
  panel: {
    position: 'fixed', zIndex: 900, display: 'flex', flexDirection: 'column',
    color: color.text, overflow: 'hidden', transition: 'opacity 120ms',
  },
  header: {
    display: 'flex', flexDirection: 'column', gap: '6px', padding: `${space[2]} ${space[2]} ${space[2]} ${space[3]}`,
    borderBottom: `1px solid ${color.borderSubtle}`,
  },
  headRow: { display: 'flex', alignItems: 'center', gap: space[2], height: '28px' },
  title: { fontSize: fontSize['14'], fontWeight: fontWeight.semibold },
  // The engine line never truncates (the context figure is at its end); when the row is
  // too narrow, the login marks wrap below it instead.
  metaRow: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: '4px',
    paddingRight: space[1], fontSize: fontSize['11'], fontFamily: font.mono, color: color.muted,
  },
  engine: { whiteSpace: 'nowrap', marginRight: 'auto' },
  logins: { display: 'inline-flex', gap: space[3], whiteSpace: 'nowrap' },
  login: { display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  segment: {
    display: 'inline-flex', padding: '2px', gap: '2px', borderRadius: radius.md,
    background: 'var(--ui-surface0, rgba(255,255,255,0.05))',
  },
  segmentBtn: {
    height: '24px', padding: `0 ${space[2]}`, borderRadius: radius.sm, border: 'none', background: 'transparent',
    color: color.subtext, fontSize: fontSize['12'], cursor: 'pointer',
  },
  segmentOn: { background: 'var(--ui-surface1, rgba(255,255,255,0.1))', color: color.text, fontWeight: fontWeight.semibold },
  terminalBox: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' },
  headBtn: {
    display: 'inline-flex', alignItems: 'center', gap: space[1], height: '26px', padding: `0 ${space[2]}`,
    borderRadius: radius.md, border: `1px solid ${color.borderSubtle}`, background: 'transparent',
    color: color.subtext, fontSize: fontSize['12'], cursor: 'pointer',
  },
  iconBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px',
    borderRadius: radius.md, border: 'none', background: 'transparent', color: color.subtext, cursor: 'pointer',
  },
  tasks: { padding: `0 ${space[2]} ${space[2]}`, display: 'flex', flexDirection: 'column', gap: '2px' },
  sectionLabel: { padding: `0 ${space[1]} ${space[1]}`, fontSize: fontSize['11'], color: color.muted },
  taskRow: {
    display: 'flex', alignItems: 'center', gap: space[2], height: '30px', padding: `0 ${space[2]}`,
    borderRadius: radius.md, border: 'none', background: 'var(--ui-surface0, rgba(255,255,255,0.04))',
    color: color.text, fontSize: fontSize['12'], cursor: 'pointer', textAlign: 'left',
  },
  dot: { width: '7px', height: '7px', borderRadius: radius.full, flexShrink: 0 },
  taskName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  taskStatus: { fontSize: fontSize['11'], color: color.muted },
  messages: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: `${space[2]} ${space[3]}`,
    display: 'flex', flexDirection: 'column', gap: space[2],
  },
  note: { fontSize: fontSize['13'], color: color.subtext, lineHeight: 1.55, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  bubble: {
    maxWidth: '86%', padding: `${space[2]} ${space[3]}`, borderRadius: radius.lg, fontSize: fontSize['13'],
    lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    background: 'var(--ui-surface0, rgba(255,255,255,0.06))',
  },
  bubbleMine: { background: `color-mix(in srgb, ${color.accent} 22%, transparent)` },
  bubbleReport: { borderLeft: `2px solid ${color.accent}` },
  reportHead: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: fontSize['11'], color: color.muted, marginBottom: '2px' },
  toolChip: {
    alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '5px',
    fontSize: fontSize['12'], color: color.muted, padding: `0 ${space[1]}`,
  },
  toolDetail: { color: color.subtext, fontFamily: font.mono, fontSize: fontSize['11'] },
  thinking: { color: color.muted, fontSize: fontSize['14'], letterSpacing: '3px', paddingLeft: space[1] },
  // One box holds both, like a messenger composer: the button sits inside it, so the two
  // can never disagree on height. The box grows with the text up to INPUT_MAX_PX.
  inputRow: {
    display: 'flex', alignItems: 'flex-end', gap: space[1], margin: space[3],
    padding: `${COMPOSER_PAD_PX}px`, borderRadius: radius.lg, border: `1px solid ${color.borderSubtle}`,
    background: 'var(--ui-surface0, rgba(255,255,255,0.05))',
  },
  input: {
    flex: 1, resize: 'none', height: `${SEND_SIZE_PX}px`, maxHeight: `${INPUT_MAX_PX}px`,
    padding: `${(SEND_SIZE_PX - INPUT_LINE_PX) / 2}px ${space[2]}`, border: 'none', outline: 'none',
    background: 'transparent', color: color.text, boxSizing: 'border-box',
    fontSize: fontSize['14'], fontFamily: 'inherit', lineHeight: `${INPUT_LINE_PX}px`,
  },
  sendBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: `${SEND_SIZE_PX}px`, height: `${SEND_SIZE_PX}px`, borderRadius: radius.md, border: 'none',
    background: color.accent, color: color.base, cursor: 'pointer', flexShrink: 0,
  },
};

export default memo(TerminatorPanel);
