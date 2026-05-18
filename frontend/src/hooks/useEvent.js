import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * useEvent — 항상 최신 closure 를 호출하면서 callback identity 는 안정적인 stable callback.
 *
 * React 의 useCallback 은 deps 가 바뀌면 새로운 함수를 만든다 → 자식 memo() 가 깨짐.
 * 반대로 deps 없이 만들면 stale closure 가 된다.
 *
 * useEvent 는 ref 에 최신 fn 을 저장하고, 반환 함수는 항상 ref.current 로 dispatch.
 * 결과적으로:
 *   - identity 는 mount~unmount 까지 동일 (자식 memo 안 깨짐)
 *   - 호출 시 항상 최신 fn (state/props 변화 즉시 반영)
 *
 * React 가 표준 useEffectEvent 를 도입하면 그쪽으로 교체 가능.
 */
const useEvent = (fn) => {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args) => ref.current?.(...args), []);
};

export default useEvent;
