/**
 * Terminator: the in-app help companion. It answers how-to questions about this screen and
 * does what a button does (open a terminal, split, open settings…), nothing more.
 *
 * It overlays the right side (a sheet on phones) instead of pushing the terminals aside:
 * pushing would resize every pane and make tmux reflow every screen each time it opens.
 * Every button here and every action in an answer goes through utils/uiActions, the same
 * short list the model is allowed to use.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, RotateCcw, Check, LocateFixed } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import useTerminator from '../../hooks/useTerminator';
import useVisualViewport from '../../hooks/useVisualViewport';
import { UI_ACTIONS, uiAction, uiActionLabel, runUiAction } from '../../utils/uiActions';

const { color, font, fontSize, fontWeight, space, radius } = tokens;
const PANEL_WIDTH_PX = 400;
const SHEET_RATIO = 0.78;
const SHEET_TOP_GAP_PX = 8;
const SEND_SIZE_PX = 32;
const INPUT_LINE_PX = 20;
const INPUT_MAX_PX = 140;
const SUGGESTIONS = [
  ['terminatorSuggest1', '파일은 어떻게 올려요?'],
  ['terminatorSuggest2', '터미널 하나 더 옆에 열어 줘'],
  ['terminatorSuggest3', '칸을 닫으려면 어떻게 해요?'],
];
const ACCENT_GRADIENT = `linear-gradient(135deg, ${color.accent}, color-mix(in srgb, ${color.accent} 45%, ${color.info}))`;

const glass = {
  background: 'color-mix(in srgb, var(--ui-base, #1e1e2e) var(--modal-fill, 72%), transparent)',
  border: `1px solid color-mix(in srgb, ${color.accent} 22%, color-mix(in srgb, var(--ui-border, #45475a) var(--modal-line, 60%), transparent))`,
  backdropFilter: 'blur(var(--modal-blur, 28px)) saturate(150%)',
  WebkitBackdropFilter: 'blur(var(--modal-blur, 28px)) saturate(150%)',
  boxShadow: `0 18px 48px rgba(0,0,0,0.38), 0 0 32px color-mix(in srgb, ${color.accent} 14%, transparent)`,
};

const KEYFRAMES = `
  @keyframes tm-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes tm-dot { 0%, 80%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-4px); opacity: 1; } }
  @keyframes tm-glow { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, ${color.accent} 45%, transparent); }
                       50% { box-shadow: 0 0 0 6px color-mix(in srgb, ${color.accent} 0%, transparent); } }
  .tm-in { animation: tm-in 180ms ease-out both; }
  .tm-action:hover { border-color: color-mix(in srgb, ${color.accent} 60%, transparent) !important;
                     background: color-mix(in srgb, ${color.accent} 14%, transparent) !important; }
  .tm-strip::-webkit-scrollbar { display: none; }
`;

// Grow the textarea with its content; reset first so it can also shrink.
const fitInput = (el) => {
  if (!el) return;
  el.style.height = `${SEND_SIZE_PX}px`;
  el.style.height = `${Math.min(INPUT_MAX_PX, Math.max(SEND_SIZE_PX, el.scrollHeight))}px`;
};

const Avatar = ({ size = 26, thinking = false }) => (
  <span style={{
    ...styles.avatar, width: `${size}px`, height: `${size}px`,
    animation: thinking ? 'tm-glow 1.4s ease-in-out infinite' : 'none',
  }}>
    <Sparkles size={Math.round(size * 0.55)} strokeWidth={2.2} aria-hidden="true" />
  </span>
);

const ActionButton = ({ id, t, variant = 'pill' }) => {
  const action = uiAction(id);
  if (!action) return null;
  const Icon = action.icon;
  const label = uiActionLabel(id, t);
  const run = () => runUiAction(id);
  if (variant === 'card') {
    return (
      <button type="button" className="tm-action" onClick={run} style={styles.card}>
        <span style={styles.cardIcon}><Icon size={16} aria-hidden="true" /></span>
        <span style={styles.cardLabel}>{label}</span>
      </button>
    );
  }
  return (
    <button type="button" className="tm-action" onClick={run} style={styles.pill}>
      <Icon size={13} aria-hidden="true" style={{ color: color.accent }} />
      <span>{label}</span>
    </button>
  );
};

const Message = ({ item, t }) => {
  if (item.role === 'user') {
    return (
      <div className="tm-in" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ ...styles.bubble, ...styles.bubbleMine, opacity: item.pending ? 0.75 : 1 }}>{item.text}</div>
      </div>
    );
  }
  return (
    <div className="tm-in" style={styles.assistantRow}>
      <Avatar size={24} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[2], minWidth: 0, flex: 1 }}>
        {item.text && <div style={styles.bubble}>{item.text}</div>}
        {item.did && (
          <div style={styles.didChip}>
            <Check size={12} aria-hidden="true" />
            <span>{uiActionLabel(item.did, t)} · {t?.('terminatorDid') || '했습니다'}</span>
          </div>
        )}
        {item.point && (
          <button
            type="button"
            className="tm-action"
            style={{ ...styles.didChip, ...styles.pointChip }}
            onClick={() => window.dispatchEvent(new CustomEvent('iterm:spotlight', { detail: { id: item.point } }))}
          >
            <LocateFixed size={12} aria-hidden="true" />
            <span>{t?.('terminatorPointed') || '화면에서 비췄습니다 · 다시 보기'}</span>
          </button>
        )}
        {item.offer?.length > 0 && (
          <div style={styles.offerRow}>
            {item.offer.map((id) => <ActionButton key={id} id={id} t={t} />)}
          </div>
        )}
      </div>
    </div>
  );
};

const Thinking = () => (
  <div className="tm-in" style={styles.assistantRow} aria-label="…">
    <Avatar size={24} thinking />
    <div style={{ ...styles.bubble, display: 'inline-flex', gap: '5px', padding: `${space[3]} ${space[3]}` }}>
      {[0, 1, 2].map((n) => (
        <span key={n} style={{ ...styles.typingDot, animation: `tm-dot 1.1s ${n * 0.15}s infinite ease-in-out` }} />
      ))}
    </div>
  </div>
);

const Welcome = ({ t, onAsk }) => (
  <div className="tm-in" style={styles.welcome}>
    <div style={styles.hero}>
      <Avatar size={44} />
      <div style={styles.heroTitle}>{t?.('terminatorHello') || '무엇을 도와드릴까요?'}</div>
      <div style={styles.heroSub}>{t?.('terminatorHelloSub') || '화면 쓰는 법을 묻거나, 버튼으로 할 수 있는 일을 시킵니다.'}</div>
    </div>
    <div style={styles.sectionLabel}>{t?.('terminatorQuick') || '바로 하기'}</div>
    <div style={styles.cardGrid}>
      {UI_ACTIONS.map((action) => <ActionButton key={action.id} id={action.id} t={t} variant="card" />)}
    </div>
    <div style={styles.sectionLabel}>{t?.('terminatorAsk') || '이렇게 물어봅니다'}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
      {SUGGESTIONS.map(([key, fallback]) => {
        const text = t?.(key) || fallback;
        return (
          <button key={key} type="button" className="tm-action" style={styles.suggestion} onClick={() => onAsk(text)}>
            {text}
          </button>
        );
      })}
    </div>
  </div>
);

const TerminatorPanel = ({ open, onClose, isMobile = false, t }) => {
  const { status, error, messages, isThinking, say, reset } = useTerminator(open);
  const [draft, setDraft] = useState('');
  const [hiddenForSpotlight, setHiddenForSpotlight] = useState(false);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  // Phones: the keyboard covers the bottom of the layout viewport, so the sheet sits on the
  // bottom of the *visible* area, or the input ends up under the keyboard.
  const viewport = useVisualViewport(open && isMobile);

  useEffect(() => {
    if (!open) return undefined;
    // Escape is the panel's only while focus is in it (or nowhere): a palette or settings
    // window opened on top owns its own Escape, and both closing at once loses the chat.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const focused = document.activeElement;
      if (!focused || focused === document.body || panelRef.current?.contains(focused)) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('keydown', onKey); cancelAnimationFrame(id); };
  }, [open, onClose]);

  // Follow the conversation to its end. The welcome screen stays at its top.
  useEffect(() => {
    const el = listRef.current;
    if (el && (messages.length > 0 || isThinking)) el.scrollTop = el.scrollHeight;
  }, [messages, isThinking]);

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

  const configured = status?.configured !== false;
  const canSend = configured && !isThinking;
  const send = async (text = draft) => {
    if (!text.trim() || !canSend) return;
    const fromInput = text === draft;
    if (fromInput) {
      setDraft('');
      if (inputRef.current) inputRef.current.style.height = `${SEND_SIZE_PX}px`;
    }
    const ok = await say(text);
    if (!ok && fromInput) setDraft(text);
  };

  const sheetHeight = Math.min(window.innerHeight * SHEET_RATIO, viewport.height - SHEET_TOP_GAP_PX);
  const placement = isMobile
    ? {
      left: 0, right: 0, top: `${viewport.offsetTop + viewport.height - sheetHeight}px`, height: `${sheetHeight}px`,
      borderRadius: `${radius.xl} ${radius.xl} 0 0`,
    }
    : {
      top: '44px', right: '8px', bottom: '8px', borderRadius: radius.xl,
      width: `min(${PANEL_WIDTH_PX}px, calc(100vw - 16px))`,
    };

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
      <style>{KEYFRAMES}</style>
      <div style={styles.header}>
        <span style={styles.title}>{t?.('terminator') || '터미네이터'}</span>
        {status?.model && <span style={styles.modelChip}>{status.model.toUpperCase()}</span>}
        <span style={{ flex: 1 }} />
        {messages.length > 0 && (
          <button type="button" onClick={reset} style={styles.iconBtn} title={t?.('terminatorReset') || '새 대화'} aria-label={t?.('terminatorReset') || '새 대화'}>
            <RotateCcw size={14} />
          </button>
        )}
        <button type="button" onClick={onClose} style={styles.iconBtn} aria-label={t?.('close') || '닫기'}>
          <X size={16} />
        </button>
      </div>

      <div ref={listRef} style={styles.messages}>
        {!configured && (
          <div style={styles.note}>{t?.('terminatorNoKey') || '터미네이터 연결이 아직 설정되지 않았습니다. 관리자에게 연결을 요청합니다.'}</div>
        )}
        {configured && messages.length === 0 && !isThinking && <Welcome t={t} onAsk={(text) => send(text)} />}
        {messages.map((item) => <Message key={item.id} item={item} t={t} />)}
        {isThinking && <Thinking />}
        {error && <div style={{ ...styles.note, color: color.danger }}>{(t?.('terminatorFailed') || '답을 받지 못했습니다')}: {error}</div>}
      </div>

      {messages.length > 0 && (
        <div className="tm-strip" style={styles.strip}>
          {UI_ACTIONS.map((action) => <ActionButton key={action.id} id={action.id} t={t} />)}
        </div>
      )}

      <form style={styles.inputRow} onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          disabled={!configured}
          onChange={(e) => { setDraft(e.target.value); fitInput(e.target); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          placeholder={t?.('terminatorPlaceholder') || '이 화면에 대해 물어봅니다'}
          style={styles.input}
        />
        <button type="submit" disabled={!canSend || !draft.trim()} style={{ ...styles.sendBtn, opacity: !canSend || !draft.trim() ? 0.5 : 1 }} aria-label={t?.('terminatorSend') || '보내기'}>
          <Send size={15} />
        </button>
      </form>
    </div>
  );
};

const styles = {
  panel: {
    position: 'fixed', zIndex: 900, display: 'flex', flexDirection: 'column',
    color: color.text, overflow: 'hidden', transition: 'opacity 120ms', fontFamily: font.sans,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: space[2], padding: `${space[2]} ${space[2]} ${space[2]} ${space[3]}`,
    borderBottom: `1px solid ${color.borderSubtle}`,
  },
  avatar: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    borderRadius: radius.full, background: ACCENT_GRADIENT, color: color.base,
  },
  title: { fontSize: fontSize['14'], fontWeight: fontWeight.semibold, lineHeight: 1.2 },
  modelChip: {
    padding: '0 6px', borderRadius: radius.full, lineHeight: '18px',
    fontSize: fontSize['10'], fontFamily: font.mono, letterSpacing: '0.04em', color: color.accent,
    background: `color-mix(in srgb, ${color.accent} 14%, transparent)`,
  },
  iconBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px',
    borderRadius: radius.md, border: 'none', background: 'transparent', color: color.subtext, cursor: 'pointer',
  },
  messages: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: `${space[3]} ${space[3]}`,
    display: 'flex', flexDirection: 'column', gap: space[3],
  },
  welcome: { display: 'flex', flexDirection: 'column', gap: space[2] },
  hero: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: space[2], padding: `${space[3]} 0 ${space[2]}` },
  heroTitle: { fontSize: fontSize['16'], fontWeight: fontWeight.semibold },
  heroSub: { fontSize: fontSize['13'], color: color.subtext, lineHeight: 1.5, maxWidth: '300px', wordBreak: 'keep-all' },
  sectionLabel: { marginTop: space[2], fontSize: fontSize['11'], color: color.muted, fontWeight: fontWeight.semibold, letterSpacing: '0.02em' },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space[2] },
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: `${space[3]} ${space[1]}`,
    borderRadius: radius.lg, border: `1px solid ${color.borderSubtle}`, cursor: 'pointer', color: color.text,
    background: 'color-mix(in srgb, var(--ui-surface0, #313244) var(--modal-section-fill, 55%), transparent)', minWidth: 0,
    transition: 'background 120ms, border-color 120ms',
  },
  cardIcon: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px',
    borderRadius: radius.md, color: color.accent, background: `color-mix(in srgb, ${color.accent} 16%, transparent)`,
  },
  cardLabel: { fontSize: fontSize['12'], lineHeight: 1.3, textAlign: 'center', wordBreak: 'keep-all' },
  suggestion: {
    textAlign: 'left', padding: `${space[2]} ${space[3]}`, borderRadius: radius.lg, cursor: 'pointer',
    border: `1px solid ${color.borderSubtle}`, background: 'transparent', color: color.text, fontSize: fontSize['13'],
    transition: 'background 120ms, border-color 120ms',
  },
  assistantRow: { display: 'flex', alignItems: 'flex-start', gap: space[2] },
  bubble: {
    alignSelf: 'flex-start', maxWidth: '100%', padding: `${space[2]} ${space[3]}`, borderRadius: radius.lg,
    fontSize: fontSize['13'], lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'anywhere',
    background: 'color-mix(in srgb, var(--ui-surface1, #45475a) var(--modal-section-fill, 70%), transparent)',
    borderTopLeftRadius: radius.sm,
  },
  bubbleMine: {
    maxWidth: '84%', background: ACCENT_GRADIENT, color: color.base,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.sm,
  },
  didChip: {
    alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '5px', padding: `2px ${space[2]}`,
    borderRadius: radius.full, fontSize: fontSize['12'], color: color.success,
    background: `color-mix(in srgb, ${color.success} 14%, transparent)`,
  },
  pointChip: {
    border: 'none', cursor: 'pointer', color: color.accent,
    background: `color-mix(in srgb, ${color.accent} 12%, transparent)`,
  },
  offerRow: { display: 'flex', flexWrap: 'wrap', gap: space[1] },
  pill: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', height: '28px', padding: `0 ${space[3]}`, flexShrink: 0,
    borderRadius: radius.full, border: `1px solid color-mix(in srgb, ${color.accent} 30%, transparent)`,
    background: `color-mix(in srgb, ${color.accent} 7%, transparent)`, color: color.text,
    fontSize: fontSize['12'], cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 120ms, border-color 120ms',
  },
  typingDot: { width: '6px', height: '6px', borderRadius: radius.full, background: color.accent },
  note: { fontSize: fontSize['13'], color: color.subtext, lineHeight: 1.55 },
  strip: {
    display: 'flex', gap: space[1], overflowX: 'auto', padding: `${space[2]} ${space[3]} 0`, scrollbarWidth: 'none',
    borderTop: `1px solid ${color.borderSubtle}`,
  },
  // One box holds both, like a messenger composer, so the two never disagree on height.
  inputRow: {
    display: 'flex', alignItems: 'flex-end', gap: space[1], margin: space[3], padding: '4px',
    borderRadius: radius.lg, border: `1px solid color-mix(in srgb, ${color.accent} 25%, ${color.borderSubtle})`,
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
    background: ACCENT_GRADIENT, color: color.base, cursor: 'pointer', flexShrink: 0,
  },
};

export default memo(TerminatorPanel);
