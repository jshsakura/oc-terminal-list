import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useSpeechRecognition from './useSpeechRecognition';

describe('useSpeechRecognition', () => {
  let originalSpeechRecognition;
  let originalWebkitSpeechRecognition;
  let instances;

  class MockSpeechRecognition {
    constructor() {
      instances.push(this);
      this.continuous = null;
      this.interimResults = null;
      this.lang = '';
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
      this.onresult = null;
    }

    start() {
      this.onstart?.();
    }

    abort() {
      this.onend?.();
    }
  }

  beforeEach(() => {
    instances = [];
    originalSpeechRecognition = window.SpeechRecognition;
    originalWebkitSpeechRecognition = window.webkitSpeechRecognition;
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  });

  afterEach(() => {
    window.SpeechRecognition = originalSpeechRecognition;
    window.webkitSpeechRecognition = originalWebkitSpeechRecognition;
  });

  it('keeps interim results off unless a preview callback is provided', () => {
    const { result } = renderHook(() => useSpeechRecognition({ language: 'ko-KR' }));

    act(() => result.current.start());

    expect(instances[0].continuous).toBe(false);
    expect(instances[0].interimResults).toBe(false);
    expect(instances[0].lang).toBe('ko-KR');
  });

  it('does not emit the same final result index twice', () => {
    const onResult = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onResult }));

    act(() => result.current.start());
    const recognition = instances[0];

    act(() => {
      recognition.onresult({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'ls' } },
        ],
      });
      recognition.onresult({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'ls' } },
        ],
      });
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('ls');
  });
});
