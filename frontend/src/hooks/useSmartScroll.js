/**
 * useSmartScroll 훅
 * AI 스트리밍 출력 시 스크롤 안정화
 *
 * 동작 원리:
 * 1. 사용자가 수동으로 스크롤하면 자동 스크롤 비활성화
 * 2. 사용자가 맨 아래로 스크롤하면 다시 자동 스크롤 활성화
 * 3. sensitivity로 "맨 아래"의 범위 조정 (AI 스트리밍 대응)
 */
import { useRef, useCallback } from 'react';

export const useSmartScroll = (containerRef, options = {}) => {
  const {
    autoScroll = 'smart', // 'always' | 'smart' | 'never'
    sensitivity = 0.8, // 0~1, 높을수록 민감
    smoothScroll = true,
  } = options;

  const userScrolledUpRef = useRef(false);
  const lastScrollTimeRef = useRef(0);
  const scrollTimeoutRef = useRef(null);

  // 맨 아래에 있는지 확인
  const isNearBottom = useCallback(() => {
    if (!containerRef.current) return false;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const scrollableHeight = scrollHeight - clientHeight;

    if (scrollableHeight === 0) return true;

    // sensitivity가 높을수록 더 넓은 범위를 "맨 아래"로 간주
    // 예: sensitivity=0.8 → 하위 20% 영역
    const threshold = scrollableHeight * (1 - sensitivity * 0.2);

    return scrollTop >= threshold;
  }, [containerRef, sensitivity]);

  // 맨 아래로 스크롤
  const scrollToBottom = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollHeight, clientHeight } = containerRef.current;

    if (smoothScroll) {
      containerRef.current.scrollTo({
        top: scrollHeight - clientHeight,
        behavior: 'smooth',
      });
    } else {
      containerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [containerRef, smoothScroll]);

  // 사용자 스크롤 감지
  const handleUserScroll = useCallback(() => {
    if (!containerRef.current) return;

    const now = Date.now();

    // 짧은 시간에 연속된 스크롤 이벤트는 무시 (성능 최적화)
    if (now - lastScrollTimeRef.current < 100) {
      return;
    }

    lastScrollTimeRef.current = now;

    // 맨 아래에 있으면 자동 스크롤 활성화
    if (isNearBottom()) {
      userScrolledUpRef.current = false;
    } else {
      // 사용자가 위로 스크롤함
      userScrolledUpRef.current = true;
    }

    // 스크롤 후 일정 시간 동안 움직임이 없으면 상태 확인
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      if (isNearBottom()) {
        userScrolledUpRef.current = false;
      }
    }, 500);
  }, [containerRef, isNearBottom]);

  // 새 데이터가 추가되었을 때 호출
  const handleNewData = useCallback(() => {
    if (autoScroll === 'never') return;

    if (autoScroll === 'always') {
      // 항상 자동 스크롤
      setTimeout(scrollToBottom, 10);
      return;
    }

    // 'smart' 모드: 사용자가 위로 스크롤하지 않았으면 자동 스크롤
    if (!userScrolledUpRef.current) {
      setTimeout(scrollToBottom, 10);
    }
  }, [autoScroll, scrollToBottom]);

  // 강제로 맨 아래로 스크롤 (사용자 클릭 등)
  const forceScrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    scrollToBottom();
  }, [scrollToBottom]);

  return {
    handleUserScroll,
    handleNewData,
    forceScrollToBottom,
    isNearBottom,
  };
};

export default useSmartScroll;
