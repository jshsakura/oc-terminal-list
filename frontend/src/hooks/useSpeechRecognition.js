import { useCallback, useEffect, useRef, useState } from 'react';

// Web Speech API 는 브라우저별 prefix 가 다르고 (Chrome/Edge=webkitSpeechRecognition)
// Firefox/Safari/Android WebView 일부에서는 아예 없을 수 있다. 지원 여부는 호출 시점에 확인.
const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

/**
 * 음성 인식 토글 훅.
 *
 * - 지원 안 되면 supported=false 로 반환. UI 에서는 버튼을 숨겨도 되고,
 *   비활성 상태로 보여줘도 된다.
 * - onResult(text) — 최종(final) 인식 결과 1 청크마다 호출. 호출 측에서 textarea 에 append.
 * - onInterim(text) — 잠정(interim) 결과. 라이브 프리뷰가 필요하면 사용.
 *
 * 콜백은 ref 로 동기화 — recognition 인스턴스 lifecycle 동안 최신 핸들러를 호출하려고.
 * 그렇지 않으면 stale closure 로 인해 첫 start 시점의 함수만 영구 호출된다.
 */
const useSpeechRecognition = ({ language = 'en-US', onResult, onInterim } = {}) => {
  const SpeechRecognition = getSpeechRecognition();
  const supported = !!SpeechRecognition;

  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    try { r.stop(); } catch { /* 이미 정지/abort 상태 */ }
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError('unsupported');
      return;
    }
    if (recognitionRef.current) return; // 이미 진행 중

    const recognition = new SpeechRecognition();
    // continuous=true — 사용자가 명시적으로 정지할 때까지 듣는다.
    // 짧은 발화 한 번이면 false 가 자연스럽지만, 터미널에서 긴 명령을 받아쓰기 할 수도 있어 continuous.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      // no-speech, audio-capture, not-allowed, network 등. UI 에는 코드만 노출.
      setError(event?.error || 'unknown');
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText) onResultRef.current?.(finalText);
      if (interimText) onInterimRef.current?.(interimText);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      // 마이크 권한 거부 / 이미 시작됨 등
      setError(String(e?.message || e));
      recognitionRef.current = null;
    }
  }, [SpeechRecognition, supported, language]);

  // unmount 시 정리. abort 는 onend 이벤트도 안 부르고 끊는다.
  useEffect(() => () => {
    const r = recognitionRef.current;
    if (!r) return;
    try { r.abort(); } catch { /* noop */ }
    recognitionRef.current = null;
  }, []);

  return { supported, listening, error, start, stop };
};

export default useSpeechRecognition;
