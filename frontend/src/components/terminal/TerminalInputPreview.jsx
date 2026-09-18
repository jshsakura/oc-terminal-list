import { useEffect, useState } from 'react';
import { createSubmittedInputCapture } from './submittedInput';
import { buildThemeUI } from '../../styles/themeUI';
import tokens from '../../styles/tokens';
import { cellBackground } from './terminalPromptContext';

export default function TerminalInputPreview({ xtermRef, inputPreviewRef, ready,
  active, scrolled, scrollbar, theme, t, sessionId, context, onJump }) {
  const text = context?.text || '';
  const [expanded, setExpanded] = useState(false);
  const [inputBackground, setInputBackground] = useState(null);
  const [toggleFocused, setToggleFocused] = useState(false);
  const themeUi = buildThemeUI(theme);

  useEffect(() => {
    setExpanded(false);
    setInputBackground(null);
    const term = xtermRef.current;
    if (!ready || !term) return;
    const capture = createSubmittedInputCapture(term, () => {
      // Match the submitted prompt's fill (including terminal RGB/ANSI colors).
      // Plain shells use the raised theme surface instead of the terminal floor.
      const buffer = term.buffer.active;
      setInputBackground(cellBackground(term, buffer.baseY + buffer.cursorY, buffer.cursorX));
    });
    if (inputPreviewRef) inputPreviewRef.current = capture;
    const subscription = term.onData(capture);
    return () => {
      subscription.dispose();
      if (inputPreviewRef?.current === capture) inputPreviewRef.current = null;
    };
  }, [ready, sessionId, xtermRef, inputPreviewRef]);

  useEffect(() => { setExpanded(false); }, [text]);

  if (!ready || !active || !scrolled || !text) return null;
  const canJump = Number.isFinite(context?.offset);
  const jump = () => {
    // Selecting text for copying must not navigate the terminal.
    if (!window.getSelection()?.toString() && canJump) onJump?.();
  };
  return (
    <div role="region" aria-label={t('terminalContextInput')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); jump(); }}
      style={{ position: 'absolute', top: tokens.space['1.5'], left: tokens.space['2'],
        right: scrollbar ? tokens.space['6'] : tokens.space['2'],
        zIndex: tokens.z.terminalInputPreview, color: theme.foreground,
        background: context?.background || inputBackground || themeUi.surface0,
        border: `1px solid ${themeUi['border-strong']}`,
        borderRadius: tokens.radius.sm, boxShadow: tokens.shadow.md,
        padding: `${tokens.space['1.5']} ${tokens.space['2.5']}`,
        fontSize: tokens.fontSize['12'], lineHeight: tokens.lineHeight.normal,
        maxHeight: '35%', overflow: 'auto',
        touchAction: 'pan-y', userSelect: 'text' }}>
      <button type="button" disabled={!canJump} title={t('terminalInputJump')}
        onClick={(event) => { event.stopPropagation(); jump(); }}
        style={{ display: 'block', width: '100%', textAlign: 'left', color: 'inherit',
          background: 'none', border: 0, padding: 0, font: 'inherit', userSelect: 'text',
          cursor: canJump ? 'pointer' : 'default' }}>
        <span style={{ display: 'block',
          paddingRight: `calc(${tokens.space['12']} + ${tokens.space['4']})`,
          color: themeUi.subtext }}>{t('terminalContextInput')}</span>
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          display: expanded ? 'block' : '-webkit-box', WebkitBoxOrient: 'vertical',
          WebkitLineClamp: expanded ? 'unset' : 2, overflow: 'hidden' }}>{text}</span>
      </button>
      <button type="button" aria-expanded={expanded}
        onFocus={() => setToggleFocused(true)} onBlur={() => setToggleFocused(false)}
        onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}
        style={{ position: 'absolute', top: tokens.space['1'], right: tokens.space['2'],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minWidth: tokens.space['6'], minHeight: tokens.space['6'],
          background: 'none', border: 0, borderRadius: tokens.radius.sm,
          padding: 0, color: themeUi.subtext, font: 'inherit', cursor: 'pointer',
          boxShadow: toggleFocused
            ? `0 0 0 ${tokens.space['0.5']} ${theme.foreground}`
            : tokens.shadow.none }}>
        {t(expanded ? 'terminalInputCollapse' : 'terminalInputExpand')}
      </button>
    </div>
  );
}
