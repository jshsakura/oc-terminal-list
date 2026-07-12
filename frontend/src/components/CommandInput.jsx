import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, X, Eraser, ClipboardPaste, Mic, ChevronUp, ChevronDown, ImagePlus, Loader2 } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import useVisualViewport from '../hooks/useVisualViewport';
import HistoryPanel from './commandinput/HistoryPanel';
import TargetSelect from './commandinput/TargetSelect';
import focusToEnd from './commandinput/focusToEnd';
import useImageAttach from './commandinput/useImageAttach';
import useSendTargets from './commandinput/useSendTargets';
import useVoiceDictation from './commandinput/useVoiceDictation';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

// 키보드 위에 살짝 띄우는 여백 — 입력창이 키보드 / suggestion bar 와 딱 붙지 않게.
const MOBILE_BOTTOM_GAP = 8;
// 모달과 가시 영역 상단 사이 최소 간격 — 키보드 + 모달이 화면을 다 차지해도 위로 빈틈이 보이게.
const MOBILE_TOP_GAP = 12;
// 가시 영역이 이만큼 줄면 키보드가 올라온 것으로 본다(브라우저 UI 바 변동은 이보다 작다).
const KEYBOARD_SHRINK_THRESHOLD = 60;
// 보낼 대상 선택 UI 는 고를 게 둘 이상일 때만 의미가 있다.
const MIN_PANES_FOR_TARGETS = 2;

/**
 * 모바일에서 한글 IME 자소 분리 문제를 우회하기 위한 별도 입력창.
 * Ctrl+Enter / Cmd+Enter 로 전송, ESC 로 닫기.
 *
 * 입력 보존: command/setCommand 가 부모(App.jsx) state 라 X/ESC/backdrop 으로
 * 닫아도 텍스트는 유지된다. 비우는 건 명시적 "Clear" 또는 "Send" 시에만.
 */
const CommandInput = ({ isOpen, onClose, onSend, command, setCommand, t, language, terminalKey = null, panes = [] }) => {
  const textareaRef = useRef(null);
  const modalRef = useRef(null);
  // 지난 명령 이력 패널 토글 — 헤더의 화살표 버튼으로 열고, 항목 클릭 시 textarea 에 채운다.
  const [historyOpen, setHistoryOpen] = useState(false);

  const viewport = useVisualViewport(isOpen);
  const targets = useSendTargets(panes, terminalKey);
  const voice = useVoiceDictation({ isOpen, language, setCommand, textareaRef });

  // 현재 커서 위치(선택 영역이 있으면 대체)에 텍스트를 끼워넣고 caret 을 삽입 끝으로 옮긴다.
  // 이력 삽입·이미지 경로 삽입 공용.
  const insertAtCursor = (text) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? command.length;
    const end = ta?.selectionEnd ?? command.length;
    const caret = start + text.length;
    setCommand(command.slice(0, start) + text + command.slice(end));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* 미지원 환경 무시 */ }
      el.scrollTop = el.scrollHeight;
    });
  };

  const image = useImageAttach(insertAtCursor);

  // 모달이 닫히면 이력 패널도 접어, 다음에 열 때 항상 입력창부터 보이게 한다.
  useEffect(() => {
    if (!isOpen) setHistoryOpen(false);
  }, [isOpen]);

  // 모달이 mount 되는 즉시 caret 을 텍스트 끝으로 두고 focus.
  // useLayoutEffect — paint 직전에 실행돼 사용자가 모달을 본 시점에 이미 커서 위치 완료.
  // setTimeout 100ms 같은 지연을 두면 iOS Safari 가 user gesture 컨텍스트를 잃어
  // 키보드가 자동으로 안 올라오는 사고가 난다.
  useLayoutEffect(() => {
    if (isOpen) focusToEnd(textareaRef.current);
  }, [isOpen]);

  // 일부 모바일 브라우저는 useLayoutEffect 후에도 keyboard 가 즉시 안 올라오는
  // 케이스가 있어 다음 frame 에 한 번 더 보강. 데스크톱은 이미 끝나서 영향 없음.
  useEffect(() => {
    if (!isOpen) return undefined;
    const raf = requestAnimationFrame(() => focusToEnd(textareaRef.current));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // 모달이 떠있는 동안 포커스가 뒤쪽 xterm/input 으로 빠지면 즉시 되돌린다.
  // xterm 이 상태 변경/클릭 잔상으로 focus() 를 다시 호출하는 타이밍이 있어
  // document focusin + textarea blur 양쪽에서 방어한다.
  // (받아쓰기 중에는 쉰다 — 마이크 UI 와 가상 키보드가 경쟁하면 모바일이 프리즈한다.)
  const isDictatingRef = voice.isDictatingRef;
  useEffect(() => {
    if (!isOpen) return undefined;
    let raf = 0;
    const refocus = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (isDictatingRef.current) return;
        if (!modalRef.current || modalRef.current.contains(document.activeElement)) return;
        focusToEnd(textareaRef.current);
      });
    };
    const handleFocusIn = (e) => {
      if (modalRef.current?.contains(e.target)) return;
      refocus();
    };
    document.addEventListener('focusin', handleFocusIn, true);
    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isOpen, isDictatingRef]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (!command.trim()) return;
    onSend(command, targets.resolveTargets());
    setCommand('');
    onClose();
  };

  const handleClear = () => {
    if (command.trim() && !confirm(t?.('confirmClearInput') || '입력한 내용을 모두 지우시겠습니까?')) return;
    setCommand('');
    focusToEnd(textareaRef.current);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCommand(command + text);
      // setCommand 후 다음 렌더가 적용되어야 caret 이 새 끝으로 감
      requestAnimationFrame(() => focusToEnd(textareaRef.current));
    } catch {
      const text = prompt(t?.('paste') || '붙여넣을 텍스트:');
      if (!text) return;
      setCommand(command + text);
      requestAnimationFrame(() => focusToEnd(textareaRef.current));
    }
  };

  // 이력 항목 클릭 → 커서 위치에 그 명령을 끼워넣고 패널을 접는다.
  // 전송이 아니라 삽입만 — 사용자가 편집 후 직접 Send 하도록.
  const handlePickHistory = (text) => {
    insertAtCursor(text);
    setHistoryOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') onClose();
  };

  // 모달 뒤 터미널 등으로 touch drag 가 leak 되지 않도록 overlay 에서 명시 차단.
  // (z-index 만으론 일부 모바일 브라우저에서 touchmove 가 underlying 에 forward 될 수 있음.)
  const blockTouch = (e) => { e.preventDefault(); };

  // 가시 영역 안에서만 모달이 보이도록 overlay 를 visualViewport 좌표로 클램프.
  // 키보드가 올라오면 모달을 가시 영역 *하단* (suggestion bar 바로 위) 에 붙인다 —
  // 사용자 의도는 "단축키 바 위에 떠있는 입력 도크" 라 상단에 띄우면 어색하다.
  const keyboardUp = viewport.height < window.innerHeight - KEYBOARD_SHRINK_THRESHOLD;

  const overlayStyle = {
    ...styles.overlay,
    top: `${viewport.offsetTop}px`,
    height: `${viewport.height}px`,
    alignItems: keyboardUp ? 'flex-end' : 'center',
    paddingTop: `${MOBILE_TOP_GAP}px`,
    paddingBottom: keyboardUp ? `${MOBILE_BOTTOM_GAP}px` : '0',
    touchAction: 'none',
  };
  const modalStyle = {
    ...styles.modal,
    // 가시 영역 내 위/아래 여백을 빼고 남은 높이만 차지 — 키보드 떠있어도 푸터 버튼 안 잘림.
    maxHeight: `calc(${viewport.height}px - ${MOBILE_TOP_GAP + MOBILE_BOTTOM_GAP}px)`,
  };

  const micTitle = !voice.supported
    ? (t?.('voiceInputUnsupported') || 'Voice input is not supported in this browser')
    : voice.listening
      ? (t?.('voiceInputStop') || 'Stop voice input')
      : (t?.('voiceInputStart') || 'Start voice input');

  return (
    <div
      data-testid="command-input-overlay"
      style={overlayStyle}
      onClick={onClose}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onTouchMove={blockTouch}
    >
      <style>{CSS}</style>

      <div
        ref={modalRef}
        className="ci-modal"
        role="dialog"
        aria-label={t?.('commandInput') || 'Send command'}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.title}>
            <Send size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
            {t?.('commandInput') || 'Send command'}
          </div>
          <div style={styles.headerActions}>
            {terminalKey && (
              <button
                type="button"
                // mousedown 에서 focus 안 뺏게 — 안 그러면 textarea 가 blur 되며 iOS/Chrome 키보드가 내려간다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setHistoryOpen((v) => !v)}
                style={{ ...styles.closeBtn, ...(historyOpen ? styles.headerToggleActive : null) }}
                title={historyOpen ? (t?.('hideHistory') || 'Hide history') : (t?.('showHistory') || 'Show recent commands')}
                aria-pressed={historyOpen}
              >
                {historyOpen ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronUp size={14} strokeWidth={2} />}
              </button>
            )}
            <button onClick={onClose} style={styles.closeBtn}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* 지난 명령 패널 — 화살표 토글 시 입력창 *위쪽* 으로 펼쳐진다.
            모달이 (키보드 떠있을 때) 하단 고정이라 높이가 늘면 자연히 위로 길어진다. */}
        {historyOpen && terminalKey && (
          <HistoryPanel terminalKey={terminalKey} onPick={handlePickHistory} t={t} />
        )}

        {/* 패널이 열리면 textarea 영역은 자연 높이만 차지(flex 0) → 남는 공간을 패널이 가져가
            입력창이 가려지지 않게 한다. 닫혀 있으면 기존처럼 flex:1 로 채운다. */}
        <div style={historyOpen ? { ...styles.body, flex: '0 0 auto' } : styles.body}>
          <textarea
            ref={textareaRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={image.handlePaste}
            onBlur={() => {
              requestAnimationFrame(() => {
                if (isDictatingRef.current) return;
                if (!isOpen || modalRef.current?.contains(document.activeElement)) return;
                focusToEnd(textareaRef.current);
              });
            }}
            placeholder={t?.('commandInputHint') || 'Shift+Enter for new line, Ctrl+Enter to send'}
            className="command-input-textarea"
            style={styles.textarea}
            autoFocus
          />
        </div>

        <footer style={styles.footer}>
          {/* 좌측 — 붙여넣기 / 이미지 첨부 / 비우기 (보조 액션 그룹) */}
          <Button
            variant="ghost" size="icon" onClick={handlePaste} icon={ClipboardPaste} title={t?.('paste')} style={styles.footerIconBtn} />
          {/* 이미지 첨부/촬영 — 숨김 file input(accept=image/*). 모바일은 OS 피커가 카메라 촬영도 제공.
              업로드 중엔 아이콘만 로딩(Loader2)으로 — 버튼 통째 회전 없음. */}
          <input
            ref={image.fileInputRef}
            type="file"
            accept="image/*"
            onChange={image.handleFileChange}
            style={{ display: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={image.openPicker}
            disabled={image.isUploading}
            icon={image.isUploading ? Loader2 : ImagePlus}
            title={t?.('attachImage') || '이미지 첨부'}
            style={styles.footerIconBtn}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={!command.trim()}
            icon={Eraser}
            title={t?.('clearInput')}
            style={styles.footerIconBtn}
          />
          <div style={{ flex: 1 }} />

          {/* 보낼 대상 — pane 2개 이상일 때만. 아이콘 누르면 목록에서 멀티선택(색/호스트 표시). */}
          {panes.length >= MIN_PANES_FOR_TARGETS && (
            <TargetSelect targets={targets} terminalKey={terminalKey} t={t} />
          )}

          {/* 음성 입력 토글 — 보조 ghost 버튼과 사이즈/스타일 통일. 상태는 아이콘 컬러(빨강)로만. */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={voice.toggle}
            disabled={!voice.supported}
            title={micTitle}
            aria-pressed={voice.listening}
            aria-label={t?.('voiceInput') || 'Voice input'}
            onMouseEnter={(e) => {
              if (!voice.supported || voice.listening) return;
              e.currentTarget.style.color = `var(--ui-danger, ${color.danger})`;
              e.currentTarget.style.background = `var(--ui-surface0, ${color.surface0})`;
            }}
            onMouseLeave={(e) => {
              if (!voice.supported || voice.listening) return;
              e.currentTarget.style.color = `var(--ui-subtext, ${color.subtext})`;
              e.currentTarget.style.background = 'transparent';
            }}
            style={{
              ...styles.micBtn,
              ...(voice.listening ? styles.micBtnActive : null),
              cursor: voice.supported ? 'pointer' : 'not-allowed',
              opacity: voice.supported ? 1 : 0.45,
            }}
          >
            <Mic size={14} strokeWidth={2} />
          </button>

          {/* 우측 — 주 액션 (전송 문구 포함) */}
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!command.trim()}
            icon={Send}
            title={t?.('send') || 'Send'}
          >
            {t?.('send') || 'Send'}
          </Button>
        </footer>

        {/* 업로드 상태 — footer 버튼 줄을 어지럽히지 않게 모달 하단 전용 영역에 표시. */}
        {image.uploadState && (
          <div style={styles.statusBar}>
            {image.uploadState === 'uploading' && (
              <>
                <Loader2 size={12} style={{ color: `var(--ui-accent, ${color.accent})`, animation: 'command-input-spin 0.8s linear infinite' }} />
                <span>{t?.('imageUploading') || '이미지 업로드 중…'}</span>
              </>
            )}
            {image.uploadState === 'error' && (
              <span style={{ color: `var(--ui-danger, ${color.danger})` }}>{t?.('imageUploadFailed') || '업로드 실패'}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const CSS = `
  .command-input-textarea::placeholder { color: ${color.muted}; }
  @keyframes command-input-spin { to { transform: rotate(360deg); } }
  /* 클릭/포커스 후 남는 브라우저 기본 흰 아웃라인 제거 — 모달 내 모든 버튼 공통. */
  .ci-modal button:focus, .ci-modal button:focus-visible { outline: none !important; box-shadow: none !important; }
`;

const styles = {
  overlay: {
    // position:fixed + visualViewport 좌표 — 키보드가 올라와도 가시 영역 안에서만 그려진다.
    position: 'fixed',
    left: 0,
    right: 0,
    padding: space['3'],
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(var(--glass-blur-overlay, 4px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur-overlay, 4px))',
    fontFamily: font.sans,
  },
  modal: {
    width: '90%',
    maxWidth: '420px',
    maxHeight: '80%',
    background: `color-mix(in srgb, var(--ui-surface0, ${color.surface0}) 58%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 62%, transparent)`,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
    backdropFilter: 'blur(var(--glass-blur-panel, 20px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 20px))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 44%, transparent)`,
  },
  title: { fontSize: fontSize['12'], fontWeight: fontWeight.semibold, color: `var(--ui-text, ${color.text})`, display: 'flex', alignItems: 'center', gap: '6px' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '6px' },
  headerToggleActive: {
    color: `var(--ui-accent, ${color.accent})`,
    borderColor: `color-mix(in srgb, var(--ui-accent, ${color.accent}) 55%, transparent)`,
    background: `color-mix(in srgb, var(--ui-accent, ${color.accent}) 16%, transparent)`,
  },
  closeBtn: {
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 54%, transparent)`,
    color: `var(--ui-subtext, ${color.subtext})`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: '7px',
    cursor: 'pointer',
    transition: `background ${motion.fast}, color ${motion.fast}`,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    outline: 'none', // 포커스 시 브라우저 기본 흰 테두리 제거 (다른 버튼들과 동일)
    WebkitTapHighlightColor: 'transparent',
  },
  body: {
    flex: 1,
    padding: `${space['2']} ${space['3']}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    background: 'transparent',
  },
  textarea: {
    width: '100%',
    minHeight: '72px',
    maxHeight: '160px',
    padding: `${space['2']} ${space['2']}`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 58%, rgba(0,0,0,0.18))`,
    color: `var(--ui-text, ${color.text})`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: font.mono,
    lineHeight: 1.5,
    outline: 'none',
    resize: 'vertical',
    transition: `border-color ${motion.fast}`,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  footer: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    padding: `${space['1.5']} ${space['3']}`,
    borderTop: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 44%, transparent)`,
  },
  // 푸터 보조 아이콘 버튼(Paste/Attach/Clear) 공통 사이즈 — 우측 주 액션(Send, medium=30px) 과
  // 높이를 맞춰 한 줄이 들쭉날쭉하지 않게 한다. Button 의 size="icon"(28x28) 위로 덮어씀.
  footerIconBtn: { width: '30px', height: '30px' },
  // 업로드 상태 전용 영역 — footer 아래 얇은 바. 버튼 줄을 어지럽히지 않게 분리.
  statusBar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    padding: `${space['1']} ${space['3']}`,
    fontSize: fontSize['12'],
    color: `var(--ui-subtext, ${color.subtext})`,
    borderTop: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 60%, transparent)`,
  },
  // 음성 입력 토글 — 다른 보조 아이콘 버튼들 및 Send 와 동일한 30x30.
  // 비활성: subtext color · 호버: danger color + subtle bg · 활성: danger color + subtle danger bg.
  micBtn: {
    position: 'relative',
    width: '30px',
    height: '30px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: `var(--ui-subtext, ${color.subtext})`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: radius.sm,
    transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}`,
    outline: 'none',
    padding: 0,
  },
  micBtnActive: {
    color: `var(--ui-danger, ${color.danger})`,
    background: `color-mix(in srgb, var(--ui-danger, ${color.danger}) 12%, transparent)`,
    borderColor: `color-mix(in srgb, var(--ui-danger, ${color.danger}) 45%, transparent)`,
  },
};

export default CommandInput;
