import { useRef } from 'react';

const useSwipe = (onSwipeLeft, onSwipeRight, threshold = 70) => {
  const touchStartX = useRef(null);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    }
    touchStartX.current = null;
  };

  return {
    handleTouchStart,
    handleTouchEnd
  };
};

export default useSwipe;
