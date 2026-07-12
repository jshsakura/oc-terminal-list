import { useCallback, useEffect, useRef } from 'react';
import useSpeechRecognition from '../../hooks/useSpeechRecognition';
import focusToEnd from './focusToEnd';

// 앱 i18n 코드(ko / en) → Web Speech API BCP-47 태그.
// ko 외 모든 값은 기본적으로 en-US 로 떨어진다.
const speechLangFor = (language) => (language === 'ko' ? 'ko-KR' : 'en-US');

const CHUNK_MAX_CHARS = 1000;

/**
 * 빠른입력 모달의 음성 받아쓰기. 인식된 텍스트를 입력창 끝에 이어붙이고,
 * 받아쓰기가 끝나면 caret 을 텍스트 끝으로 되돌린다.
 *
 * `isDictatingRef` 는 모달의 focus 방어(뒤쪽 xterm 으로 포커스가 새면 되돌리는 로직)가
 * 받아쓰기 중에는 쉬어야 하기 때문에 밖으로 내보낸다 — 모바일에서 가상 키보드와
 * 마이크 UI 가 동시에 뜨면 심한 렉/프리즈가 난다.
 */
const useVoiceDictation = ({ isOpen, language, setCommand, textareaRef }) => {
  const isDictatingRef = useRef(false);

  // 직전 문자가 공백/줄바꿈이 아니면 한 칸 띄우고 이어붙인다.
  const appendText = useCallback((text) => {
    const chunk = text.replace(/\s+/g, ' ').trim().slice(0, CHUNK_MAX_CHARS);
    if (!chunk) return;
    setCommand((prev = '') => {
      const needsSpace = prev && !/[\s\n]$/.test(prev);
      return prev + (needsSpace ? ' ' : '') + chunk;
    });
    if (!isDictatingRef.current) requestAnimationFrame(() => focusToEnd(textareaRef.current));
  }, [setCommand, textareaRef]);

  const {
    supported,
    listening,
    error,
    start,
    stop,
  } = useSpeechRecognition({
    language: speechLangFor(language),
    onResult: appendText,
  });

  // 모달이 닫히면 진행 중인 인식도 정지 — 백그라운드에서 마이크가 살아있지 않게.
  useEffect(() => {
    if (isOpen) return;
    isDictatingRef.current = false;
    if (listening) stop();
  }, [isOpen, listening, stop]);

  // 인식이 끝나면(또는 실패하면) 입력창으로 포커스를 되돌린다.
  const restoreFocus = useCallback(() => {
    isDictatingRef.current = false;
    if (isOpen) requestAnimationFrame(() => focusToEnd(textareaRef.current));
  }, [isOpen, textareaRef]);

  useEffect(() => {
    if (listening) {
      isDictatingRef.current = true;
      return;
    }
    if (isDictatingRef.current) restoreFocus();
  }, [listening, restoreFocus]);

  useEffect(() => {
    if (!error || !isDictatingRef.current) return;
    restoreFocus();
  }, [error, restoreFocus]);

  const toggle = () => {
    if (!supported) return;
    if (listening || isDictatingRef.current) {
      isDictatingRef.current = false;
      stop();
      requestAnimationFrame(() => focusToEnd(textareaRef.current));
      return;
    }
    // 받아쓰기 중에는 textarea 포커스를 놓아준다 — 가상 키보드와 마이크 UI 가
    // 동시에 경쟁하면 모바일에서 프리즈한다. 강제 refocus 도 이 동안 멈춘다.
    isDictatingRef.current = true;
    try { textareaRef.current?.blur(); } catch { /* noop */ }
    start();
  };

  return { supported, listening, toggle, isDictatingRef };
};

export default useVoiceDictation;
