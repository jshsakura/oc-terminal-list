/**
 * pane 을 가리키는 **LLM 친화 핸들** 한 줄 — pane 우상단 번호 클릭 시 클립보드로 복사.
 * "저 터미널(2.3) 봐줘" 처럼 LLM 에게 특정 pane 을 지목할 때 붙여넣는다.
 *
 * 웹 도메인(사람이 브라우저로 접속하는 주소)은 **넣지 않는다** — LLM 에겐 무용지물이다.
 * 대신 LLM 이 바로 쓰는 것만: itl 주소(`itl send 2.3`) · tmux 세션명 · 작업 경로(cwd).
 * 원격 pane 은 어느 머신인지 SSH 주소(user@host)를 함께 넣는다(도메인과 다름).
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

/** "<itl주소>  <ssh주소>  tmux:<세션>  <cwd>" 한 줄. 있는 조각만 이어 붙인다.
 *  address(itl 주소)를 맨 앞에 둔다 — LLM 이 `itl send <address>` 로 바로 쓰는 핸들. */
export function formatSessionTarget({ address = '', server = '', tmuxSession = '', cwd = '' } = {}) {
  const parts = [];
  if (address) parts.push(address);
  if (server) parts.push(server);
  if (tmuxSession) parts.push(`tmux:${tmuxSession}`);
  if (cwd) parts.push(cwd);
  return parts.join('  ');
}
