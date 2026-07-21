/**
 * cwd 표시용 경로 정리 — 순수 함수.
 *
 * 브레드크럼은 로컬 pane 이면 절대경로를, 원격이면 `user@host:/path` 형태를 받는다.
 * 화면에는 경로만 보여야 하므로 호스트 접두사를 떼고 홈은 `~` 로 접는다.
 */

/** `/home/foo/bar` · `/Users/foo/bar` → `~/bar`. 홈이 아니면 그대로. */
const homeTilde = (path) => {
  if (!path) return path;
  return path.replace(/^\/(?:home|Users)\/[^/]+/, '~');
};

/** `user@host:/path` 에서 경로만 뽑는다. 이미 절대/틸드 경로면 그대로 둔다. */
const stripHostPathPrefix = (path) => {
  if (!path || typeof path !== 'string') return path || '';
  const trimmed = path.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return trimmed;
  const match = trimmed.match(/^(?:[^@:\s]+@)?[^:\s]+:(\/?~?\/?[^\s].*)$/);
  return match ? match[1] : trimmed;
};

export { homeTilde, stripHostPathPrefix };
