import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, X, Eraser, ClipboardPaste, Copy, Mic, ChevronUp, ChevronDown, ImagePlus, Loader2, Camera, Crosshair } from 'lucide-react';
import Button from './common/Button';
import CameraCapture from './CameraCapture';
import { tokens } from '../styles/tokens';
import useSpeechRecognition from '../hooks/useSpeechRecognition';
import useCommandHistory from '../hooks/useCommandHistory';
import { removeCommand } from '../utils/commandHistory';
import { uploadImageAndGetPath } from './terminal/terminalHelpers';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

// 앱 i18n 코드(ko / en) → Web Speech API BCP-47 태그.
// ko 외 모든 값은 기본적으로 en-US 로 떨어진다.
const speechLangFor = (language) => (language === 'ko' ? 'ko-KR' : 'en-US');

// 키보드 위에 살짝 띄우는 여백 — 입력창이 키보드 / suggestion bar 와 딱 붙지 않게.
const MOBILE_BOTTOM_GAP = 8;
// 모달과 가시 영역 상단 사이 최소 간격 — 키보드 + 모달이 화면을 다 차지해도 위로 빈틈이 보이게.
const MOBILE_TOP_GAP = 12;
const VOICE_CHUNK_MAX_CHARS = 1000;

// textarea 의 caret 을 항상 텍스트 끝으로 — 다시 열 때, 붙여넣기 후, clear 후 등
// 사용자가 이어서 입력하기 좋은 위치에 두기 위함.
const focusToEnd = (ta) => {
  if (!ta) return;
  ta.focus();
  try {
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    // 멀티라인일 때 caret 위치까지 스크롤되게 강제 reflow 트릭
    ta.scrollTop = ta.scrollHeight;
  } catch { /* setSelectionRange 미지원 환경 무시 */ }
};

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
  const voiceModeRef = useRef(false);
  // 이미지 첨부용 숨김 file input — 📎 버튼이 click() 으로 연다(모바일은 카메라/갤러리 선택지 노출).
  const fileInputRef = useRef(null);
  // 지난 명령 이력 패널 토글 — footer 의 History 버튼으로 열고, 항목 클릭 시 textarea 에 채운다.
  const [historyOpen, setHistoryOpen] = useState(false);
  // 이미지 업로드 진행 상태 — null | 'uploading' | 'error'. 모바일은 hover title 이 없어 인라인 표시.
  const [imageUploadState, setImageUploadState] = useState(null);
  // 라이브 카메라 촬영 오버레이 토글 — 촬영 결과 blob 은 uploadImage 로 흘려 경로 삽입.
  const [cameraOpen, setCameraOpen] = useState(false);
  // 명령 전송 대상 — 'active'(활성 pane) | 'all'(탭 내 전체) | pane.key(특정 pane).
  // pane 이 1개면 항상 active. 분할/탭전환으로 대상 pane 이 사라지면 active 로 되돌린다.
  const [target, setTarget] = useState('active');
  useEffect(() => {
    if (target !== 'active' && target !== 'all' && !panes.some((p) => p.key === target)) {
      setTarget('active');
    }
  }, [panes, target]);
  // 가시 영역 (visualViewport) 추적 — 키보드가 올라올 때 모달 상하 위치/높이를 그 안으로 클램프.
  // iOS Safari 는 layout viewport 가 키보드를 무시하기 때문에 absolute/fixed inset:0 만으로는
  // 가운데 정렬이 키보드 밑까지 내려가 입력창 일부가 가려진다.
  const [vv, setVv] = useState(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return { height: typeof window !== 'undefined' ? window.innerHeight : 0, offsetTop: 0 };
    }
    return { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop };
  });

  // 인식된 텍스트를 textarea 끝에 이어붙인다. 직전 문자가 공백/줄바꿈이 아니면 한 칸 띄움.
  // setCommand 가 함수형이 아닐 가능성에 대비해 직접 command 를 참조 — App 의 상태는 일반 useState.
  const appendVoiceText = useCallback((text) => {
    const chunk = text.replace(/\s+/g, ' ').trim().slice(0, VOICE_CHUNK_MAX_CHARS);
    if (!chunk) return;
    setCommand((prev = '') => {
      const needsSpace = prev && !/[\s\n]$/.test(prev);
      return prev + (needsSpace ? ' ' : '') + chunk;
    });
    if (!voiceModeRef.current) requestAnimationFrame(() => focusToEnd(textareaRef.current));
  }, [setCommand]);

  const {
    supported: voiceSupported,
    listening: voiceListening,
    error: voiceError,
    start: voiceStart,
    stop: voiceStop,
  } = useSpeechRecognition({
    language: speechLangFor(language),
    onResult: appendVoiceText,
  });

  // 모달이 닫히면 진행 중인 음성 인식도 함께 정지 — 백그라운드에서 마이크가 살아있지 않게.
  // 이력 패널도 함께 접어, 다음에 열 때 항상 입력창부터 보이게 한다.
  useEffect(() => {
    if (isOpen) return;
    voiceModeRef.current = false;
    if (voiceListening) voiceStop();
    setHistoryOpen(false);
  }, [isOpen, voiceListening, voiceStop]);

  useEffect(() => {
    if (voiceListening) {
      voiceModeRef.current = true;
      return;
    }
    if (!voiceModeRef.current) return;
    voiceModeRef.current = false;
    if (isOpen) requestAnimationFrame(() => focusToEnd(textareaRef.current));
  }, [voiceListening, isOpen]);

  useEffect(() => {
    if (!voiceError || !voiceModeRef.current) return;
    voiceModeRef.current = false;
    if (isOpen) requestAnimationFrame(() => focusToEnd(textareaRef.current));
  }, [voiceError, isOpen]);

  const toggleVoice = () => {
    if (!voiceSupported) return;
    if (voiceListening || voiceModeRef.current) {
      voiceModeRef.current = false;
      voiceStop();
      requestAnimationFrame(() => focusToEnd(textareaRef.current));
      return;
    }
    // 모바일에서 textarea focus 를 유지한 채 SpeechRecognition 을 열면 가상 키보드와
    // 마이크 UI 가 동시에 경쟁해 심한 렉/프리즈가 난다. 음성 중에는 강제 refocus 도 멈춘다.
    voiceModeRef.current = true;
    try { textareaRef.current?.blur(); } catch { /* noop */ }
    voiceStart();
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const target = window.visualViewport;
    if (!target) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      setVv({ height: target.height, offsetTop: target.offsetTop });
    };
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    target.addEventListener('resize', onChange);
    target.addEventListener('scroll', onChange);
    return () => {
      target.removeEventListener('resize', onChange);
      target.removeEventListener('scroll', onChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isOpen]);

  // 모달이 mount 되는 즉시 caret 을 텍스트 끝으로 두고 focus.
  // useLayoutEffect — paint 직전에 실행돼 사용자가 모달을 본 시점에 이미 커서 위치 완료.
  // setTimeout 100ms 같은 지연을 두면 iOS Safari 가 user gesture 컨텍스트를 잃어
  // 키보드가 자동으로 안 올라오는 사고가 난다.
  useLayoutEffect(() => {
    if (!isOpen) return;
    focusToEnd(textareaRef.current);
  }, [isOpen]);

  // 일부 모바일 브라우저는 useLayoutEffect 후에도 keyboard 가 즉시 안 올라오는
  // 케이스가 있어 다음 frame 에 한 번 더 보강. 데스크톱은 이미 끝나서 영향 없음.
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => focusToEnd(textareaRef.current));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // 모달이 떠있는 동안 포커스가 뒤쪽 xterm/input 으로 빠지면 즉시 되돌린다.
  // xterm 이 상태 변경/클릭 잔상으로 focus() 를 다시 호출하는 타이밍이 있어
  // document focusin + textarea blur 양쪽에서 방어한다.
  useEffect(() => {
    if (!isOpen) return undefined;
    let raf = 0;
    const refocus = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const modal = modalRef.current;
        const active = document.activeElement;
        if (voiceModeRef.current || voiceListening) return;
        if (!modal || modal.contains(active)) return;
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
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (command.trim()) {
      onSend(command, panes.length >= 2 ? target : 'active');
      setCommand('');
      onClose();
    }
  };

  // 보낼 대상 아이콘 버튼 — 탭해서 활성→전체→P1→P2…→활성 순환(공간 절약). 현재 값은 배지+툴팁.
  const targetOptions = ['active', 'all', ...panes.map((p) => p.key)];
  const cycleTarget = () => {
    const i = targetOptions.indexOf(target);
    setTarget(targetOptions[(i + 1) % targetOptions.length]);
  };
  const targetPaneIdx = panes.findIndex((p) => p.key === target);
  const targetShort = target === 'all'
    ? (t?.('sendToAll') || 'All')
    : (targetPaneIdx >= 0 ? `P${targetPaneIdx + 1}` : (t?.('sendToActive') || 'Active'));

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
      if (text) {
        setCommand(command + text);
        requestAnimationFrame(() => focusToEnd(textareaRef.current));
      }
    }
  };

  const handleCopy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // 권한/브라우저 fallback — 텍스트 선택 후 execCommand
      const ta = textareaRef.current;
      if (ta) {
        ta.select();
        try { document.execCommand('copy'); } catch { /* 무시 */ }
        focusToEnd(ta);
      }
    }
  };

  // 현재 커서 위치(선택 영역이 있으면 대체)에 텍스트를 끼워넣고 caret 을 삽입 끝으로 옮긴다.
  // 이력 삽입·이미지 경로 삽입 공용.
  const insertAtCursor = (text) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? command.length;
    const end = ta?.selectionEnd ?? command.length;
    const next = command.slice(0, start) + text + command.slice(end);
    const caret = start + text.length;
    setCommand(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* 미지원 환경 무시 */ }
      el.scrollTop = el.scrollHeight;
    });
  };

  // 이력 항목 클릭 → 커서 위치에 그 명령을 끼워넣고 패널을 접는다.
  // 전송이 아니라 삽입만 — 사용자가 편집 후 직접 Send 하도록 (눈 아이콘 popover 의 즉시 재전송과 역할 분리).
  const handlePickHistory = (text) => {
    insertAtCursor(text);
    setHistoryOpen(false);
  };

  // 이미지 blob → 압축·업로드 → 저장 경로를 커서 위치에 삽입(뒤 공백, 데스크톱 붙여넣기와 동일).
  // PTY 는 텍스트만 보내므로 이미지 자체가 아니라 서버 저장 경로로 우회한다.
  const uploadImage = async (blob) => {
    if (imageUploadState === 'uploading') return; // 중복 업로드 차단
    setImageUploadState('uploading');
    try {
      const data = await uploadImageAndGetPath(blob);
      insertAtCursor(`${data.path} `);
      setImageUploadState(null);
    } catch (err) {
      console.error('image upload failed', err);
      setImageUploadState('error');
      setTimeout(() => setImageUploadState(null), 2500);
    }
  };

  // textarea 붙여넣기 — 클립보드에 이미지가 있으면 가로채 업로드, 텍스트는 기본 동작에 맡긴다.
  const handleTextareaPaste = (e) => {
    const imageItem = Array.from(e.clipboardData?.items || []).find(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    );
    if (!imageItem) return;
    const blob = imageItem.getAsFile();
    if (!blob) return;
    e.preventDefault();
    uploadImage(blob);
  };

  // 📎 버튼 → 숨김 file input 열기. 같은 파일 재선택을 위해 값 리셋 후 업로드.
  const handleAttachClick = () => fileInputRef.current?.click();
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && file.type.startsWith('image/')) uploadImage(file);
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
  // 키보드가 올라오면 vv.height 가 줄고 vv.offsetTop 이 양수가 될 수 있다.
  // 모달은 가시 영역 *하단* (키보드 suggestion bar 바로 위) 에 붙임 — 사용자 의도는
  // "단축키 바 위에 떠있는 입력 도크" 라 상단에 띄우면 어색하다.
  const keyboardUp = vv.height < window.innerHeight - 60;

  const overlayStyle = {
    ...styles.overlay,
    top: `${vv.offsetTop}px`,
    height: `${vv.height}px`,
    alignItems: keyboardUp ? 'flex-end' : 'center',
    paddingTop: `${MOBILE_TOP_GAP}px`,
    paddingBottom: keyboardUp ? `${MOBILE_BOTTOM_GAP}px` : '0',
    touchAction: 'none',
  };
  const modalStyle = {
    ...styles.modal,
    // 가시 영역 내 위/아래 여백을 빼고 남은 높이만 차지 — 키보드 떠있어도 푸터 버튼 안 잘림.
    maxHeight: `calc(${vv.height}px - ${MOBILE_TOP_GAP + MOBILE_BOTTOM_GAP}px)`,
  };

  return (
    <div
      data-testid="command-input-overlay"
      style={overlayStyle}
      onClick={onClose}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onTouchMove={blockTouch}
    >
      <style>{`
        .command-input-textarea::placeholder { color: ${color.muted}; }
        @keyframes command-input-history-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes command-input-skel-shimmer {
          0%   { background-position: 150% center; }
          100% { background-position: -150% center; }
        }
        @keyframes command-input-spin {
          to { transform: rotate(360deg); }
        }
        .command-input-history-list { scrollbar-width: thin; }
        .command-input-history-list::-webkit-scrollbar { width: 6px; }
        .command-input-history-list::-webkit-scrollbar-thumb {
          background: var(--ui-surface1, ${color.surface1}); border-radius: 3px;
        }
        .command-input-history-row:hover {
          background: color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 70%, transparent);
        }
        .command-input-history-row:active {
          background: color-mix(in srgb, var(--ui-accent, ${color.accent}) 22%, transparent);
        }
        .command-input-history-row .ci-rm:hover { color: var(--ui-danger, ${color.danger}); }
        /* 클릭/포커스 후 남는 브라우저 기본 흰 아웃라인 제거 — 모달 내 모든 버튼 공통. */
        .ci-modal button:focus, .ci-modal button:focus-visible { outline: none !important; box-shadow: none !important; }
      `}</style>

      <CameraCapture
        isOpen={cameraOpen}
        onCapture={uploadImage}
        onClose={() => setCameraOpen(false)}
        t={t}
      />

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
            onPaste={handleTextareaPaste}
            onBlur={() => {
              requestAnimationFrame(() => {
                const active = document.activeElement;
                if (voiceModeRef.current || voiceListening) return;
                if (!isOpen || modalRef.current?.contains(active)) return;
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
          {/* 좌측 — 복사/붙여넣기/비우기 (보조 액션 그룹) */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            disabled={!command}
            icon={Copy}
            title={t?.('copy') || 'Copy'}
            style={styles.footerIconBtn}
          />
          <Button variant="ghost" size="icon" onClick={handlePaste} icon={ClipboardPaste} title={t?.('paste')} style={styles.footerIconBtn} />
          {/* 이미지 첨부 — 숨김 file input 을 📎 버튼이 연다. 업로드 중엔 스피너로 표시. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleAttachClick}
            disabled={imageUploadState === 'uploading'}
            icon={imageUploadState === 'uploading' ? Loader2 : ImagePlus}
            title={t?.('attachImage') || '이미지 첨부'}
            style={imageUploadState === 'uploading' ? { ...styles.footerIconBtn, ...styles.attachSpin } : styles.footerIconBtn}
          />
          {/* 라이브 카메라 촬영 — 데스크톱 웹캠/모바일 카메라로 바로 찍어 경로 삽입. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCameraOpen(true)}
            disabled={imageUploadState === 'uploading'}
            icon={Camera}
            title={t?.('takePhoto') || '사진 촬영'}
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
          {imageUploadState === 'uploading' && (
            <span style={styles.uploadStatus}>{t?.('imageUploading') || '이미지 업로드 중…'}</span>
          )}
          {imageUploadState === 'error' && (
            <span style={{ ...styles.uploadStatus, color: `var(--ui-danger, ${color.danger})` }}>
              {t?.('imageUploadFailed') || '업로드 실패'}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {/* 우측 직전 — 음성 입력 토글. 다른 보조 ghost 버튼들과 사이즈/스타일 통일.
              호버/활성 상태는 아이콘 컬러(빨강)로만 표현 — 점/펄스/박스그림자 같은 과한 장식 없이. */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleVoice}
            disabled={!voiceSupported}
            title={
              !voiceSupported
                ? (t?.('voiceInputUnsupported') || 'Voice input is not supported in this browser')
                : voiceListening
                  ? (t?.('voiceInputStop') || 'Stop voice input')
                  : (t?.('voiceInputStart') || 'Start voice input')
            }
            aria-pressed={voiceListening}
            aria-label={t?.('voiceInput') || 'Voice input'}
            onMouseEnter={(e) => {
              if (!voiceSupported || voiceListening) return;
              e.currentTarget.style.color = `var(--ui-danger, ${color.danger})`;
              e.currentTarget.style.background = `var(--ui-surface0, ${color.surface0})`;
            }}
            onMouseLeave={(e) => {
              if (!voiceSupported || voiceListening) return;
              e.currentTarget.style.color = `var(--ui-subtext, ${color.subtext})`;
              e.currentTarget.style.background = 'transparent';
            }}
            style={{
              ...styles.micBtn,
              ...(voiceListening ? styles.micBtnActive : null),
              cursor: voiceSupported ? 'pointer' : 'not-allowed',
              opacity: voiceSupported ? 1 : 0.45,
            }}
          >
            <Mic size={14} strokeWidth={2} />
          </button>
          {/* 보낼 대상 — pane 2개 이상일 때만. 아이콘 버튼: 탭해서 순환(활성/전체/P1…), 배지로 현재값. */}
          {panes.length >= 2 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cycleTarget}
              title={`${t?.('sendTarget') || 'Send to'}: ${target === 'all' ? (t?.('sendToAll') || 'All panes') : (targetPaneIdx >= 0 ? panes[targetPaneIdx].label : (t?.('sendToActive') || 'Active'))}`}
              aria-label={t?.('sendTarget') || 'Send to'}
              style={styles.targetBtn}
            >
              <Crosshair size={13} strokeWidth={2} />
              <span style={styles.targetBadge}>{targetShort}</span>
            </button>
          )}
          {/* 우측 — 주 액션 (아이콘만) */}
          <Button
            variant="primary"
            size="icon"
            onClick={handleSend}
            disabled={!command.trim()}
            icon={Send}
            title={t?.('send') || 'Send'}
            aria-label={t?.('send') || 'Send'}
          />
        </footer>
      </div>
    </div>
  );
};

/**
 * 빠른입력 모달 안에서 입력창 위로 펼쳐지는 지난 명령 목록.
 * 항목 터치 → onPick(text) 로 textarea 에 채우고 패널은 부모가 접는다.
 * 끝까지 스크롤하면 sentinel 이 다음 페이지를 lazy fetch (무한 스크롤).
 */
const HistoryPanel = ({ terminalKey, onPick, t }) => {
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const { items, hasMore, loading, loadingMore, loadMore } = useCommandHistory(terminalKey);

  useEffect(() => {
    if (!sentinelRef.current || !listRef.current || !hasMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: listRef.current, rootMargin: '60px 0px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div style={styles.historyPanel}>
      <div style={styles.historyHeader}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          {t?.('historyTitle') || 'Recent commands'}
          {items.length > 0 && (
            <span style={styles.historyCount}>{items.length}{hasMore ? '+' : ''}</span>
          )}
        </span>
      </div>
      <div ref={listRef} className="command-input-history-list" style={styles.historyList}>
        {loading && items.length === 0 ? (
          [0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ ...styles.historySkel, animationDelay: `${i * 80}ms`, width: `${92 - (i % 3) * 16}%` }} />
          ))
        ) : items.length === 0 ? (
          <div style={styles.historyEmpty}>{t?.('historyEmpty') || 'No history yet'}</div>
        ) : (
          <>
            {items.map((entry, idx) => (
              <div key={`${entry.ts}-${idx}`} className="command-input-history-row" style={styles.historyRow}>
                <button
                  type="button"
                  // mousedown 에서 focus 안 뺏게 — iOS 키보드 유지 (cmdInput 버튼과 동일 패턴).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(entry.text)}
                  title={`${entry.text}\n— ${t?.('clickToInsert') || 'click to insert into input'}`}
                  style={styles.historyItemText}
                >
                  {entry.text}
                </button>
                <button
                  type="button"
                  className="ci-rm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); removeCommand(terminalKey, entry.text); }}
                  title={t?.('remove') || 'Remove'}
                  aria-label={t?.('remove') || 'Remove'}
                  style={styles.historyRemove}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} style={{ height: '1px', flexShrink: 0 }} />}
            {loadingMore && <div style={{ ...styles.historySkel, width: '70%' }} />}
          </>
        )}
      </div>
    </div>
  );
};

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
  // 푸터 보조 아이콘 버튼(Copy/Paste/Clear) 공통 사이즈 — 우측 주 액션(Send, medium=30px) 과
  // 높이를 맞춰 한 줄이 들쭉날쭉하지 않게 한다. Button 의 size="icon"(28x28) 위로 덮어씀.
  footerIconBtn: { width: '30px', height: '30px' },
  // 보낼 대상 아이콘 버튼 — 아이콘 + 현재값 배지. 탭해서 순환. 공간 최소.
  targetBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    height: '30px',
    padding: `0 ${space['1.5']}`,
    borderRadius: radius.sm,
    border: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 80%, transparent)`,
    background: `var(--ui-surface0, ${color.surface0})`,
    color: `var(--ui-subtext, ${color.subtext})`,
    cursor: 'pointer',
    flexShrink: 0,
  },
  targetBadge: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    fontFamily: font.mono,
    color: `var(--ui-text, ${color.text})`,
    lineHeight: 1,
  },
  // 업로드 중 📎 버튼 전체를 회전시켜 스피너로 보이게(Loader2 아이콘 + 회전).
  attachSpin: { animation: 'command-input-spin 0.8s linear infinite' },
  // 업로드 상태 인라인 라벨 — 모바일은 hover title 이 없어 텍스트로 명시.
  uploadStatus: {
    fontSize: fontSize['12'],
    color: `var(--ui-subtext, ${color.subtext})`,
    whiteSpace: 'nowrap',
    alignSelf: 'center',
    marginLeft: space.xs,
  },
  historyPanel: {
    // 남는 세로 공간을 모두 차지하고 내부 리스트만 스크롤 → 화면 크기에 맞게 열리되 입력창은 안 가림.
    flex: '1 1 auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderBottom: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    // 또렷한 배경 — 모달보다 살짝 어둡게 깔아 카드형 항목이 떠 보이게 한다.
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 88%, transparent)`,
    animation: 'command-input-history-in 160ms ease both',
  },
  historyHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['1.5']} ${space['3']}`,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: `var(--ui-subtext, ${color.subtext})`,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  historyCount: {
    fontSize: '10px',
    color: `var(--ui-muted, ${color.muted})`,
    letterSpacing: 'normal',
    textTransform: 'none',
  },
  historyList: {
    // flex:1 + minHeight:0 → 패널(=남은 공간) 안에서만 스크롤. 고정 maxHeight 없이 화면에 맞춰 늘어남.
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: `0 ${space['2']} ${space['1.5']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  // 스켈레톤 블록과 동일한 모양의 카드 행 — 같은 높이/radius, 테두리 없이 동일 톤 배경.
  // 안에 텍스트 버튼(클릭→삽입) + X 버튼(개별 삭제) 을 담는다.
  historyRow: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: '30px',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 32%, transparent)`,
    borderRadius: radius.sm,
    overflow: 'hidden',
    transition: `background ${motion.fast}`,
  },
  historyItemText: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    textAlign: 'left',
    padding: `0 ${space['1']} 0 ${space['2']}`,
    background: 'transparent',
    color: `var(--ui-text, ${color.text})`,
    border: 'none',
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    lineHeight: '30px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  historyRemove: {
    flexShrink: 0,
    width: '26px',
    height: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: `var(--ui-subtext, ${color.subtext})`,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    WebkitTapHighlightColor: 'transparent',
    transition: `color ${motion.fast}`,
  },
  // 로딩 placeholder — historyItem 과 같은 높이/모양에 shimmer 만 흐른다.
  historySkel: {
    flexShrink: 0,
    height: '30px',
    borderRadius: radius.sm,
    background: `linear-gradient(90deg,
      color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 32%, transparent) 0%,
      color-mix(in srgb, var(--ui-accent, ${color.accent}) 16%, transparent) 50%,
      color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 32%, transparent) 100%)`,
    backgroundSize: '300% 100%',
    animation: 'command-input-skel-shimmer 1.6s ease-in-out infinite',
  },
  historyEmpty: {
    padding: `${space['3']} ${space['2']}`,
    textAlign: 'center',
    fontSize: fontSize['12'],
    color: `var(--ui-subtext, ${color.subtext})`,
    opacity: 0.7,
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
