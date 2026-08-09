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
 *  - **The machine's address, for local sessions too.** An attach command with no address
 *    silently means "on whichever box you happen to be", which is only true when the
 *    reader is already on this one. The address is tagged (`tailscale` / `lan`) because
 *    the two are not interchangeable — a tailnet address works from anywhere on the
 *    tailnet, a LAN one only from the same network. It comes from the backend
 *    (`/api/system/self`), never from `location.hostname`, which is the *web* address.
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
 *   local:  tmux session 'abc' on a1-ubuntu 100.109.62.68 (tailscale) — attach: tmux -L iterminallist-app attach -t abc  (cwd: /w)
 *   local:  tmux session 'abc' on a1-ubuntu 192.168.0.5 (lan) — attach: tmux -L iterminallist-app attach -t abc  (cwd: /w)
 *   remote: tmux session 'mobile-xx' on pi@10.0.0.5 — attach: ssh pi@10.0.0.5 -t "tmux attach -t mobile-xx"  (cwd: /home/pi)
 *
 * A remote session belongs to **that** machine's tmux, so our socket name is left off —
 * over there it lives on the default socket, and its address already came from the host
 * record. Only the local side needs the server to tell it where it is.
 */

/** `a1-ubuntu 100.109.62.68 (tailscale)` — whichever parts we actually know. */
export function formatServerAddr({ hostname = '', ip = '', ipKind = '' } = {}) {
  const parts = [];
  if (hostname) parts.push(hostname);
  if (ip) parts.push(ipKind ? `${ip} (${ipKind})` : ip);
  return parts.join(' ');
}

export function formatSessionTarget({
  server = '', tmuxSession = '', cwd = '', socket = '', remote = false,
} = {}) {
  const parts = [];
  if (tmuxSession) {
    const attach = buildAttachCmd(tmuxSession, remote ? '' : socket);
    if (remote && server) {
      parts.push(`tmux session '${tmuxSession}' on ${server} — attach: ssh ${server} -t "${attach}"`);
    } else {
      // The address is informational for a local session — the attach command runs on
      // that box, so it must not be wrapped in ssh here (we do not know a login user).
      const where = server ? ` on ${server}` : '';
      parts.push(`tmux session '${tmuxSession}'${where} — attach: ${attach}`);
    }
  } else if (server) {
    parts.push(`host ${server}`);
  }
  if (cwd) parts.push(`(cwd: ${cwd})`);
  return parts.join('  ');
}
