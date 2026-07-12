import { useEffect, useState } from 'react';

const readViewport = () => {
  if (typeof window === 'undefined') return { height: 0, offsetTop: 0 };
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, offsetTop: 0 };
  return { height: vv.height, offsetTop: vv.offsetTop };
};

/**
 * 가시 영역(visualViewport) 추적 — 키보드가 올라올 때 모달을 그 안으로 클램프하기 위함.
 *
 * iOS Safari 는 layout viewport 가 키보드를 무시하기 때문에 fixed inset:0 만으로 가운데
 * 정렬하면 모달이 키보드 밑까지 내려가 입력창 일부가 가려진다.
 *
 * @param enabled false 면 구독하지 않는다(모달이 닫혀 있을 때).
 */
const useVisualViewport = (enabled) => {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    if (!enabled) return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;

    let raf = 0;
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setViewport({ height: vv.height, offsetTop: vv.offsetTop });
      });
    };

    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return viewport;
};

export default useVisualViewport;
