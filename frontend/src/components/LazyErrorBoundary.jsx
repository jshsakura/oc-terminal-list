import { Component } from 'react';

/* 배포로 지워진 청크를 물었을 때의 문구 — 브라우저마다 다르다. 하나만 보고 있으면
   사파리/파이어폭스에서는 못 알아채고 조용히 죽는다. */
const CHUNK_ERROR_HINTS = [
  'dynamically imported module',      // Chrome/Vite
  'Loading chunk',                    // webpack 계열
  'Importing a module script failed', // Safari
  'error loading dynamically imported module',
];
const RELOAD_GUARD_KEY = 'iterm-chunk-reload-at';
const RELOAD_GUARD_MS = 30 * 1000;

/**
 * lazy 모달용 경계.
 *
 * **한 번 걸렸다고 영원히 죽으면 안 된다.** 예전 구현은 `hasError` 가 서면 계속 `null` 을
 * 렌더했다 — 모달들이 이 경계 하나를 공유하므로, 청크 하나가 404 난 순간부터 그 세션에서는
 * 설정도 확인창도 다시는 안 떴다("설정을 눌러도 아무 일이 없다" 의 정체). 다음에 열 때는
 * 다시 시도해야 한다: `resetKey` 가 바뀌면(=무엇을 열었는지가 바뀌면) 상태를 푼다.
 *
 * 청크 404 는 새로고침이 답이지만, 그것도 **한 번만** 한다. 조건이 남아 있으면 새로고침이
 * 무한히 반복돼 앱이 아예 못 뜬다 — 30초 가드를 둔다.
 */
class LazyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    const msg = error?.message || '';
    if (!CHUNK_ERROR_HINTS.some((hint) => msg.includes(hint))) return;
    if (typeof window === 'undefined') return;
    try {
      const last = Number(window.sessionStorage?.getItem(RELOAD_GUARD_KEY) || 0);
      if (Date.now() - last < RELOAD_GUARD_MS) return;   // 방금 새로고침했다 — 또 하면 루프
      window.sessionStorage?.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch { /* 프라이빗 모드 등 — 가드 없이 진행 */ }
    window.location.reload();
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    if (prevProps.resetKey === this.props.resetKey) return;
    // 다음 시도는 깨끗한 상태에서 — 실패가 그대로 굳지 않게 한다.
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default LazyErrorBoundary;
