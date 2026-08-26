import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X, Eraser, ClipboardPaste, Mic, ChevronUp, ChevronDown, ImagePlus, Loader2 } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import useVisualViewport from '../hooks/useVisualViewport';
import HistoryPanel from './commandinput/HistoryPanel';
import TargetSelect from './commandinput/TargetSelect';
import focusToEnd from './commandinput/focusToEnd';
import useImageAttach from './commandinput/useImageAttach';
import useSendTargets from './commandinput/useSendTargets';
import { FOCUS_DOCK_EVENT, DOCK_SLOT_ID } from './commandinput/focusDock';
import useVoiceDictation from './commandinput/useVoiceDictation';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

// 키보드 위에 살짝 띄우는 여백 — 입력창이 키보드 / suggestion bar 와 딱 붙지 않게.
const MOBILE_BOTTOM_GAP = 8;
// 모달과 가시 영역 상단 사이 최소 간격 — 키보드 + 모달이 화면을 다 차지해도 위로 빈틈이 보이게.
const MOBILE_TOP_GAP = 12;
// 가시 영역이 이만큼 줄면 키보드가 올라온 것으로 본다(브라우저 UI 바 변동은 이보다 작다).
const KEYBOARD_SHRINK_THRESHOLD = 60;
// 보낼 대상 선택 UI 는 고를 게 둘 이상일 때만 의미가 있다.
// 도크의 모든 컨트롤이 공유하는 한 변. 입력 높이도 여기에 맞춘다.
const DOCK_BTN = 26;
// 아이콘은 버튼보다 확실히 작아야 눌리는 면이 보인다. 26 버튼에 12 아이콘.
const DOCK_ICON = 12;

const MIN_PANES_FOR_TARGETS = 2;

/**
 * 모바일에서 한글 IME 자소 분리 문제를 우회하기 위한 별도 입력창.
 * Ctrl+Enter / Cmd+Enter 로 전송, ESC 로 닫기.
 *
 * 입력 보존: command/setCommand 가 부모(App.jsx) state 라 X/ESC/backdrop 으로
 * 닫아도 텍스트는 유지된다. 비우는 건 명시적 "Clear" 또는 "Send" 시에만.
 */
/* `docked` — 모바일에서 **모달이 아니라 하단에 상시 붙는** 형태.
 *
 * 왜: 폰에서 한 줄 보내려면 터미널 탭 → 키보드 → 키바에서 입력 버튼 찾기 → 모달, 네 걸음이었다.
 * 폰에서 사람이 하는 일은 대개 키를 치는 게 아니라 **한 줄 보내는 것**이라, 그게 늘 열려
 * 있는 편이 맞다. 데스크탑은 그대로 모달이다 — 거기서는 터미널에 직접 치는 게 기본이고,
 * 화면을 상시로 먹는 입력창이 오히려 방해다.
 *
 * ⚠️ docked 에서는 **포커스를 붙잡지 않는다.** 모달 모드의 focus 트랩(아래 focusin 방어)이
 * 그대로 돌면 터미널을 탭해도 포커스가 입력창으로 되튕겨 **터미널에 아무것도 못 친다.**
 * 그게 모달과 도크의 결정적 차이다.
 */
const CommandInput = ({ isOpen, onClose, onSend, command, setCommand, t, language, terminalKey = null, panes = [], docked = false }) => {
  const textareaRef = useRef(null);
  const modalRef = useRef(null);
  // 지난 명령 이력 패널 토글 — 헤더의 화살표 버튼으로 열고, 항목 클릭 시 textarea 에 채운다.
  const [historyOpen, setHistoryOpen] = useState(false);
  /* 퀵바의 고정 슬롯 노드. 퀵바가 우리보다 먼저/나중에 마운트될 수 있어 ref 가 아니라
     DOM 조회로 잡는다 — 없으면 그냥 안 보낸다(데스크탑에는 퀵바가 없다). */
  const [dockSlot, setDockSlot] = useState(null);
  useEffect(() => {
    if (!docked) { setDockSlot(null); return undefined; }
    const find = () => setDockSlot(document.getElementById(DOCK_SLOT_ID));
    find();
    const id = window.setTimeout(find, 0);   // 퀵바가 아직 안 그려졌을 때 한 틱 뒤 재시도
    return () => window.clearTimeout(id);
  }, [docked]);

  const viewport = useVisualViewport(isOpen && !docked);
  const targets = useSendTargets(panes, terminalKey);
  const voice = useVoiceDictation({ isOpen, language, setCommand, textareaRef });

  // 현재 커서 위치(선택 영역이 있으면 대체)에 텍스트를 끼워넣고 caret 을 삽입 끝으로 옮긴다.
  // 이력 삽입·이미지 경로 삽입 공용.
  // ⚠️ **함수형 업데이트여야 한다.** 이미지 여러 장을 고르면 업로드가 순차로 끝나며 이 함수가
  // N 번 불리는데, 렌더 시점의 `command` 를 기준으로 잘라 붙이면 매 삽입이 같은 옛 문자열
  // 위에서 계산돼 **앞의 경로를 덮는다** — 5장을 올려도 마지막 하나만 남았다.
  // caret 위치는 DOM(textareaRef)에서 읽는다: 직전 삽입 후 rAF 가 caret 을 옮겨놨으므로
  // 실제 커서는 최신이고, 낡은 건 상태값뿐이다.
  const insertAtCursor = (text) => {
    const ta = textareaRef.current;
    const start = ta ? ta.selectionStart : null;
    const end = ta ? ta.selectionEnd : null;
    const caret = (start ?? 0) + text.length;
    setCommand((prev) => {
      const from = start ?? prev.length;
      const to = end ?? prev.length;
      return prev.slice(0, from) + text + prev.slice(to);
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* 미지원 환경 무시 */ }
      el.scrollTop = el.scrollHeight;
    });
  };

  // 첨부 이미지는 지금 보고 있는 pane 의 호스트로 올린다.
  const focusedHostId = panes.find((p) => p.key === terminalKey)?.hostId || null;
  const image = useImageAttach(insertAtCursor, focusedHostId);

  // 모달이 닫히면 이력 패널도 접어, 다음에 열 때 항상 입력창부터 보이게 한다.
  useEffect(() => {
    if (!isOpen) setHistoryOpen(false);
  }, [isOpen]);

  // 모달이 mount 되는 즉시 caret 을 텍스트 끝으로 두고 focus.
  // useLayoutEffect — paint 직전에 실행돼 사용자가 모달을 본 시점에 이미 커서 위치 완료.
  // setTimeout 100ms 같은 지연을 두면 iOS Safari 가 user gesture 컨텍스트를 잃어
  // 키보드가 자동으로 안 올라오는 사고가 난다.
  useLayoutEffect(() => {
    if (isOpen && !docked) focusToEnd(textareaRef.current);
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
    if (!isOpen || docked) return undefined;   // 도크는 포커스를 붙잡지 않는다 (위 주석)
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
  }, [isOpen, isDictatingRef, docked]);

  /* 터미널을 탭하면 이 도크로 포커스를 옮긴다 — 폰에서 사람이 하는 일은 대개 키를 치는 게
     아니라 한 줄 보내는 것이라, 탭 한 번에 쓸 자리로 가는 편이 맞다(herdr 에서 가져온 개념).
     App↔Terminal 사이는 이 저장소의 관례대로 window 이벤트로 잇는다(`iterm:open-file` 과 같은 패턴).
     ⚠️ 포커스 이동은 **탭 제스처 안에서** 일어나야 iOS 키보드가 올라온다. */
  useEffect(() => {
    if (!docked) return undefined;
    const onFocusRequest = () => focusToEnd(textareaRef.current);
    window.addEventListener(FOCUS_DOCK_EVENT, onFocusRequest);
    return () => window.removeEventListener(FOCUS_DOCK_EVENT, onFocusRequest);
  }, [docked]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (!command.trim()) return;
    const keys = targets.resolveTargets();

    // 첨부가 없으면 **동기로** 보낸다. 흔한 경우에 await 를 끼우면 클릭과 전송
    // 사이에 마이크로태스크가 들어가 체감 지연이 생긴다.
    if (!image.hasAttachments()) {
      onSend(command, keys, {});
    } else {
      // 첨부가 있으면 대상 호스트마다 올린 뒤 그 pane 에 갈 텍스트의 경로만 갈아끼운다.
      // 입력창은 먼저 닫고 전송은 업로드가 끝나는 대로 — 사용자를 붙잡아두지 않는다.
      image.resolveTextForTargets(command, keys, panes).then((textByKey) => {
        onSend(command, keys, textByKey);
        image.clearAttachments();
      });
    }
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

  /* 도크와 모달이 **같은 조각**을 쓴다 — 배치만 다르다. 복사해 두면 한쪽만 고쳐진다. */
  const historyToggle = terminalKey ? (
    <button
      type="button"
      // mousedown 에서 focus 안 뺏게 — 안 그러면 textarea 가 blur 되며 키보드가 내려간다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setHistoryOpen((v) => !v)}
      style={{
        ...styles.closeBtn,
        ...(docked ? styles.dockBtn : null),
        ...(historyOpen ? styles.headerToggleActive : null),
      }}
      title={historyOpen ? (t?.('hideHistory') || 'Hide history') : (t?.('showHistory') || 'Show recent commands')}
      aria-pressed={historyOpen}
    >
      {historyOpen
        ? <ChevronDown size={docked ? DOCK_ICON : 14} strokeWidth={2} />
        : <ChevronUp size={docked ? DOCK_ICON : 14} strokeWidth={2} />}
    </button>
  ) : null;

  const targetSelect = panes.length >= MIN_PANES_FOR_TARGETS ? (
    <TargetSelect targets={targets} terminalKey={terminalKey} t={t} size={docked ? DOCK_BTN : null} />
  ) : null;

  const imageInput = (
    <input
      ref={image.fileInputRef}
      type="file"
      accept="image/*"
      multiple
      onChange={image.handleFileChange}
      style={{ display: 'none' }}
      aria-hidden="true"
      tabIndex={-1}
    />
  );

  const micButton = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={voice.toggle}
      disabled={!voice.supported}
      title={micTitle}
      aria-pressed={voice.listening}
      style={{
        ...styles.micBtn,
        ...(docked ? styles.dockBtn : null),
        ...(voice.listening ? styles.micBtnActive : null),
      }}
    >
      <Mic size={docked ? DOCK_ICON : 14} strokeWidth={2} />
    </button>
  );

  const textarea = (
    <textarea
      ref={textareaRef}
      value={command}
      onChange={(e) => setCommand(e.target.value)}
      onKeyDown={handleKeyDown}
      onPaste={image.handlePaste}
      onBlur={() => {
        requestAnimationFrame(() => {
          if (isDictatingRef.current) return;
          if (docked) return;                      // 도크는 포커스를 붙잡지 않는다
          if (!isOpen || modalRef.current?.contains(document.activeElement)) return;
          focusToEnd(textareaRef.current);
        });
      }}
      placeholder={t?.('commandInputHint') || 'Shift+Enter for new line, Ctrl+Enter to send'}
      className="command-input-textarea"
      /* ⚠️ 도크는 `rows={1}` 이 필수다. textarea 의 브라우저 기본은 **2줄**이라
         minHeight 를 32px 로 낮춰도 내용 상자가 2줄을 차지해 도크가 두 줄로 보인다. */
      rows={docked ? 1 : undefined}
      style={docked ? { ...styles.textarea, ...styles.dockTextarea } : styles.textarea}
      autoFocus={!docked}
    />
  );

  const body = (
    <>
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
          multiple
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
        {/* 여러 장을 올리는 중에만 n/N — 한 장은 아이콘 회전만으로 충분하다. */}
        {image.uploadProgress && (
          <span style={styles.uploadCount}>
            {image.uploadProgress.current + 1}/{image.uploadProgress.total}
          </span>
        )}
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

      {/* 첨부의 예상 토큰 — 보낼 대상이 읽을 때 드는 값이다. 지금 지우면 안 든다. */}
      {!image.uploadState && image.attachedTokens > 0 && (
        <div style={styles.statusBar}>
          <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
            {`${t?.('imageAttached') || '이미지 첨부'} · ≈${image.attachedTokens.toLocaleString()} tok`}
          </span>
        </div>
      )}

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
          {/* 요청이 서버에 닿지도 못한 경우 — 파일이나 호스트 문제가 아니라 연결이다. */}
          {image.uploadState === 'blocked' && (
            <span style={{ color: `var(--ui-danger, ${color.danger})` }}>
              {t?.('imagePasteBlocked') || '연결이 막혀 업로드하지 못했습니다 — 새로고침 후 다시 시도하세요'}
            </span>
          )}
        </div>
      )}
    </>
  );

  /* 도크는 **감싸는 층이 없다.** 모달의 바깥 div 는 backdrop(누르면 닫힘) + 터치 차단 +
     visualViewport 좌표 고정을 하는데, 상시 노출에서는 셋 다 해로우므로 껍데기 자체를 뺀다.
     같은 자리에 투명한 fixed 층을 두면 그 아래 터미널이 터치를 못 받는다. */
  if (docked) {
    /* 도크는 **한 줄**이다. 제목·닫기는 없다 — 상시 노출이라 무엇인지 자명하고 닫을 것도
       없다. 히스토리·대상 선택은 왼쪽 끝으로, 입력은 가운데, 마이크·보내기는 오른쪽 끝으로
       몰아 세로를 최대한 아낀다. 폰 화면에서 이 도크가 먹는 높이가 곧 터미널이 잃는 높이다. */
    return (
      <div
        ref={modalRef}
        data-testid="command-input-dock"
        className="ci-modal"
        style={styles.dock}
      >
        <style>{CSS}</style>
        {/* 대상 선택·히스토리 토글은 **퀵바의 고정 슬롯**으로 보낸다. 그 슬롯은 도크보다
            먼저 그려지므로 포탈로 넘긴다 — prop 을 App 까지 올렸다 내리는 것보다 짧고,
            슬롯이 없으면(데스크탑) 아무 일도 일어나지 않는다. */}
        {dockSlot && createPortal(
          <>
            {targetSelect}
            {historyToggle}
            {/* 구분선은 **내용과 함께** 보낸다 — 퀵바에 두면 슬롯이 비었을 때도 선이 선다. */}
            <span style={styles.dockSlotDivider} />
          </>,
          dockSlot,
        )}
        {historyOpen && terminalKey && (
          <HistoryPanel terminalKey={terminalKey} onPick={handlePickHistory} t={t} />
        )}
        {/* 입력은 **폭을 다 쓴다.** 버튼을 같은 줄에 늘어놓으면 정작 글자 칠 자리가 좁아진다 —
            그래서 보조 버튼은 아래 한 줄로 내리고, 그 줄은 24px 짜리 얇은 띠다.
            결과: 입력 32px + 버튼 띠 24px ≈ 예전 모달 대비 훨씬 낮으면서 입력은 훨씬 넓다. */}
        {/* 도크는 **한 줄**이다. [첨부] 입력 [마이크][전송].
            대상 선택·히스토리는 퀵바(MobileToolbar) 고정 슬롯으로 올라갔다 — 여기 두면
            줄이 하나 더 생기고, 폰에서 도크가 먹는 높이가 곧 터미널이 잃는 높이다. */}
        <div style={styles.dockInputRow}>
          {imageInput}
          <Button
            variant="ghost" size="icon" onClick={image.openPicker} disabled={image.isUploading}
            icon={image.isUploading ? Loader2 : ImagePlus}
            title={t?.('attachImage') || '이미지 첨부'} style={styles.dockBtn}
          />
          {textarea}
          {micButton}
          <Button
            variant="primary" size="icon" onClick={handleSend} icon={Send}
            title={t?.('send') || 'Send'} style={styles.dockBtn}
          />
        </div>
        {/* 첨부/업로드 상태만 한 줄 — 있을 때만 나온다. 없으면 도크는 한 줄 그대로다. */}
        {(image.uploadState || image.attachedTokens > 0) && (
          <div style={{ ...styles.statusBar, paddingTop: 0 }}>
            {image.uploadState === 'uploading' && (
              <span>{t?.('imageUploading') || '이미지 업로드 중…'}</span>
            )}
            {image.uploadState === 'error' && (
              <span style={{ color: `var(--ui-danger, ${color.danger})` }}>{t?.('imageUploadFailed') || '업로드 실패'}</span>
            )}
            {image.uploadState === 'blocked' && (
              <span style={{ color: `var(--ui-danger, ${color.danger})` }}>
                {t?.('imagePasteBlocked') || '연결이 막혀 업로드하지 못했습니다 — 새로고침 후 다시 시도하세요'}
              </span>
            )}
            {!image.uploadState && image.attachedTokens > 0 && (
              <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                {`${t?.('imageAttached') || '이미지 첨부'} · ≈${image.attachedTokens.toLocaleString()} tok`}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

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
        {body}
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
  /* 하단 도크 — 폭을 다 쓰고, 높이는 내용만큼. 위쪽만 테두리를 둬서 키바와 한 덩어리로 보이게. */
  dock: {
    width: '100%',
    flexShrink: 0,
    background: `color-mix(in srgb, var(--ui-surface0, ${color.surface0}) 92%, transparent)`,
    borderTop: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 62%, transparent)`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: font.sans,
    /* 화면 맨 아래에 칼같이 붙으면 눌린 것처럼 보이고, iOS 홈 인디케이터와도 겹친다.
       안전영역만큼 아래를 띄운다(없는 기기에서는 0 이라 그대로 붙는다). */
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  /* ⚠️ 도크 안의 버튼은 **전부 같은 크기**여야 한다. 예전에는 28/30/34 가 섞여 있어
     한 줄에 놓으니 들쭉날쭉했다(각자 다른 자리에서 자란 스타일이라 티가 안 났다).
     DOCK_BTN 하나만 고치면 전부 따라온다. */
  dockInputRow: {
    display: 'flex',
    alignItems: 'flex-end',    // 여러 줄로 자라도 버튼은 아래에 고정
    gap: '4px',
    padding: '4px 6px',
  },
  dockTextarea: {
    flex: 1,
    minWidth: 0,                    // flex 안에서 줄어들 수 있게 — 없으면 버튼을 밀어낸다
    minHeight: `${DOCK_BTN}px`,
    height: `${DOCK_BTN}px`,        // rows=1 과 짝 — 한 줄에서 시작한다
    maxHeight: '96px',              // 여러 줄을 써도 화면 절반을 먹지 않게
    padding: '4px 8px',
    fontSize: fontSize['12'],
    lineHeight: 1.4,
    borderRadius: radius.sm,        // 버튼과 같은 모서리
    resize: 'none',
    overflowY: 'auto',
  },
  dockSlotDivider: {
    width: '1px',
    height: '16px',
    marginLeft: '2px',
    background: `color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
  },
  /* 도크 컨트롤 공통 — 크기·모서리를 여기 하나로 묶는다. */
  dockBtn: {
    flexShrink: 0,
    width: `${DOCK_BTN}px`,
    height: `${DOCK_BTN}px`,
    borderRadius: radius.sm,
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
  // 다중 업로드 진행 카운터 — 첨부 버튼 옆에 붙는 작은 숫자.
  uploadCount: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    color: color.muted,
    marginLeft: '-2px',
    fontVariantNumeric: 'tabular-nums',
  },
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
