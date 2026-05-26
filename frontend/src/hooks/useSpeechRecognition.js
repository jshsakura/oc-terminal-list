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
  const emittedFinalIndexesRef = useRef(new Set());
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    // abort() — stop() 은 최종 결과를 기다리느라 Chrome 이 마이크 점유 표시를 더 끌고 가는 경우가 있다.
    // 사용자가 끄려는 의도이므로 즉시 끊어 마이크/표시를 바로 해제한다. (말하는 동안의 결과는 이미 onResult 로 반영됨)
    try { r.abort(); } catch { /* 이미 정지/abort 상태 */ }
    // onend 가 누락되는 브라우저 대비 상태도 즉시 정리.
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError('unsupported');
      return;
    }
    if (recognitionRef.current) return; // 이미 진행 중

    const recognition = new SpeechRecognition();
    emittedFinalIndexesRef.current = new Set();
    // continuous=false — 한 발화가 끝나면 자동으로 onend → 마이크 즉시 해제.
    // continuous=true 로 두면 Chrome 이 사용자가 말을 멈춰도 탭 마이크를 계속 점유해
    // "안 쓰는데 켜져 있다" 는 문제가 생긴다. 길게 받아쓰려면 버튼을 다시 누르면 된다.
    recognition.continuous = false;
    // CommandInput 은 interim preview 를 쓰지 않는다. 모바일에서 interimResults=true 는
    // 같은 발화의 중간 문자열을 매우 자주 발생시켜 렌더/키보드/마이크 경합을 키운다.
    recognition.interimResults = Boolean(onInterimRef.current);
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
        const transcript = result?.[0]?.transcript || '';
        if (result.isFinal) {
          if (emittedFinalIndexesRef.current.has(i)) continue;
          emittedFinalIndexesRef.current.add(i);
          finalText += transcript;
        } else {
          interimText += transcript;
        }
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
