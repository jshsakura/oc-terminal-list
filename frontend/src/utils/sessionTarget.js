/**
 * An **LLM-friendly handle** for a pane — copied to the clipboard when the pane number
 * (top-right) is clicked. It is what you paste when you say "look at this terminal".
 *
 * What goes in, and what does not:
 *  - **No web domain.** That is the address a human opens in a browser; useless to an LLM.
 *  - **No pane number (2.2) either.** It only means something inside this app, and it
 *    shifts when a pane closes — to whoever receives the paste (an LLM in another
 *    terminal) it points at nothing.
 *  - Instead: **the command that actually attaches**. A session name alone is not enough
 *    here, because our sessions live on a private socket (`tmux -L <socket>`); a plain
 *    `tmux attach -t X` looks at the default socket and ends in "session not found".
 */

/** SSH address string — user@host[:port]. Port 22 is omitted, by convention. */
export function buildSshAddr(host) {
  if (!host) return '';
  const user = (host.ssh_user || '').trim();
  const name = (host.hostname || host.name || '').trim();
  if (!name) return '';
  const port = host.port && Number(host.port) !== 22 ? `:${host.port}` : '';
  return `${user ? `${user}@` : ''}${name}${port}`;
}

/** `tmux -L sock attach -t name` — without a socket, `-L` is dropped (default socket). */
export function buildAttachCmd(tmuxSession, socket = '') {
  if (!tmuxSession) return '';
  const sock = String(socket || '').trim();
  return `tmux${sock ? ` -L ${sock}` : ''} attach -t ${tmuxSession}`;
}

/**
 * The single line that gets copied.
 *
 * It is phrased as a sentence because **the first word has to say what this is**,
 * whether a human or a model reads it. The old form (`2.3  tmux:abc  /w`) only meant
 * something to someone who already knew our conventions.
 *
 *   local:  tmux session 'abc' — attach: tmux -L iterminallist-app attach -t abc  (cwd: /w)
 *   remote: tmux session 'mobile-xx' on pi@10.0.0.5 — attach: ssh pi@10.0.0.5 -t "tmux attach -t mobile-xx"  (cwd: /home/pi)
 *
 * A remote session belongs to **that** machine's tmux, so our socket name is left off —
 * over there it lives on the default socket.
 */
export function formatSessionTarget({
  server = '', tmuxSession = '', cwd = '', socket = '', remote = false,
} = {}) {
  const parts = [];
  if (tmuxSession) {
    const attach = buildAttachCmd(tmuxSession, remote ? '' : socket);
    parts.push(
      remote && server
        ? `tmux session '${tmuxSession}' on ${server} — attach: ssh ${server} -t "${attach}"`
        : `tmux session '${tmuxSession}' — attach: ${attach}`,
    );
  } else if (server) {
    parts.push(`host ${server}`);
  }
  if (cwd) parts.push(`(cwd: ${cwd})`);
  return parts.join('  ');
}
