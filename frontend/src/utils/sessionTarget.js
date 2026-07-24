/**
 * 탭이 가리키는 터미널의 "접속 주소 + tmux 세션" 한 줄 — 탭 번호 클릭 시 클립보드로
 * 복사한다. "저 터미널을 직접 봐라" 처럼 특정 pane 을 지목·재접속할 때 쓰는 핸들.
 *
 * 로컬 pane = 웹 접속 주소(window.location.host) + tmux 세션명(=sessionId).
 * 원격 pane = SSH 주소(user@host[:port]) + 원격 tmux 세션명.
 */

/** SSH 접속 주소 문자열 — user@host[:port]. 22번 포트는 생략(관례). */
export function buildSshAddr(host) {
  if (!host) return '';
  const user = (host.ssh_user || '').trim();
  const name = (host.hostname || host.name || '').trim();
  if (!name) return '';
  const port = host.port && Number(host.port) !== 22 ? `:${host.port}` : '';
  return `${user ? `${user}@` : ''}${name}${port}`;
}

/** "<접속주소>  tmux:<세션>" 한 줄. 둘 중 하나만 있으면 그것만. */
export function formatSessionTarget({ server = '', tmuxSession = '' } = {}) {
  const parts = [];
  if (server) parts.push(server);
  if (tmuxSession) parts.push(`tmux:${tmuxSession}`);
  return parts.join('  ');
}
