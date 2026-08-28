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

    /* ⚠️ **구독을 시작할 때 반드시 다시 읽는다.** 초기값은 `useState(readViewport)` 라
       마운트 때 한 번뿐인데, 이 훅은 `enabled` 로 껐다 켜진다 — 꺼져 있는 동안 실제
       뷰포트는 얼마든지 변하고, 다시 켜도 그 사이의 변화를 아무도 안 알려준다(이벤트는
       구독 중일 때만 온다).

       그 낡은 값이 실제 버그를 만들었다. 도크는 키보드가 내려가면 blur 하는데(포커스만
       남는 것을 막으려고), blur 하는 순간 구독이 끊겨 **키보드가 내려가는 중간 높이**가
       그대로 얼어붙었다. 다시 탭하면 그 값으로 "키보드가 올라와 있다" 고 판정해 래치가
       t=0 에 서고, 곧이어 진짜 이벤트가 "아직 안 올라왔다" 를 알려주는 순간 그 래치가
       blur 를 불러 **키보드가 올라왔다가 곧바로 내려갔다.** 탭할 때마다 반복됐다. */
    setViewport({ height: vv.height, offsetTop: vv.offsetTop });

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
