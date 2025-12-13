/**
 * Visual Viewport 훅
 * iOS에서 가상 키보드가 올라올 때 요소를 키보드 위에 고정
 */
import { useEffect } from 'react';

export const useVisualViewport = (elementRef) => {
  useEffect(() => {
    // Visual Viewport API 지원 확인
    if (!window.visualViewport || !elementRef.current) {
      return;
    }

    const updatePosition = () => {
      const vvHeight = window.visualViewport.height;
      const vvOffsetTop = window.visualViewport.offsetTop;

      // 툴바를 키보드 바로 위에 배치
      const bottomOffset = window.innerHeight - vvHeight - vvOffsetTop;
      elementRef.current.style.bottom = `${bottomOffset}px`;
    };

    // 초기 위치 설정
    updatePosition();

    // 리스너 등록
    window.visualViewport.addEventListener('resize', updatePosition);
    window.visualViewport.addEventListener('scroll', updatePosition);

    // 정리
    return () => {
      window.visualViewport.removeEventListener('resize', updatePosition);
      window.visualViewport.removeEventListener('scroll', updatePosition);
    };
  }, [elementRef]);
};

export default useVisualViewport;
