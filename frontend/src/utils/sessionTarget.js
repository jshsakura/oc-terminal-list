/**
 * An **LLM-friendly handle** for a pane — copied to the clipboard when the pane number
 * (top-right) is clicked. It is what you paste when you say "look at this terminal".
 *
 * What goes in, and what does not:
 *  - **No web domain.** That is the address a human opens in a browser; useless to an LLM.
 *  - **No pane number (2.2) either.** It only means something inside this app, and it
 *    shifts when a pane closes — to whoever receives the paste (an LLM in another
 *    terminal) it points at nothing.
 *  - **No cwd.** The receiver attaches or sends keys; the directory the shell happens to
 *    sit in tells it nothing it cannot read off the prompt, and it made the line long
 *    enough that the commands got lost in it.
 *  - Instead: **the commands that actually reach the session**. A session name alone is
 *    not enough here, because our sessions live on a private socket (`tmux -L <socket>`);
 *    a plain `tmux attach -t X` looks at the default socket and ends in "session not found".
 *  - **It says out loud that it is a tmux session**, and that tmux is the only way in.
 *    A receiving agent that reads "session" reaches for its own agent-to-agent channel
 *    first (ListAgents/SendMessage and friends), which never sees a foreign harness —
 *    it then wanders instead of just running `send-keys`.
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

/** `tmux -L sock` prefix — without a socket, `-L` is dropped (default socket). */
function tmuxPrefix(socket) {
  const sock = String(socket || '').trim();
  return `tmux${sock ? ` -L ${sock}` : ''}`;
}

/**
 * Exact-match targets, quoted.
 *
 * `-t name` is a prefix/fnmatch pattern in tmux, so a bare name can resolve to a
 * *different* session (or to nothing, once the name carries a glob character). `=name`
 * forces an exact match — and the quotes keep the shell out of it.
 *
 * The trailing colon is not decoration: **`send-keys -t` wants a pane target**, and
 * `=name` alone fails there with "can't find pane". `=name:` stays exact while resolving
 * to the session's current window. Verified on this box: `display-message -p -t '=X'
 * '#{pane_id}'` prints nothing, `-t '=X:'` prints the pane.
 */
export function buildAttachCmd(tmuxSession, socket = '') {
  if (!tmuxSession) return '';
  return `${tmuxPrefix(socket)} attach -t '=${tmuxSession}'`;
}

/**
 * Typing into the session from outside: literal text, then Enter as a *key*.
 *
 * Two commands, not one — `-l` (literal) is what stops the text from being read as key
 * names (a message containing "Enter" or "C-c" would otherwise fire them), and Enter
 * therefore has to be sent separately, without `-l`. They are joined with `;` rather
 * than tmux's `\;` so the line survives being wrapped in `ssh "..."` unchanged.
 */
export function buildSendCmd(tmuxSession, socket = '') {
  if (!tmuxSession) return '';
  const tm = tmuxPrefix(socket);
  const target = `'=${tmuxSession}:'`;
  return `${tm} send-keys -t ${target} -l 'TEXT'; ${tm} send-keys -t ${target} Enter`;
}

/**
 * The single line that gets copied.
 *
 * It is phrased as a sentence because **the first words have to say what this is**,
 * whether a human or a model reads it. The old form (`2.3  tmux:abc  /w`) only meant
 * something to someone who already knew our conventions.
 *
 *   local:  tmux session 'abc' on a1-ubuntu 100.109.62.68 (tailscale) — reach it with tmux only …
 *   remote: tmux session 'mobile-xx' on pi@10.0.0.5 — reach it with tmux only (over ssh) …
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

/** The sentence that keeps the receiver from looking for an agent channel. */
const REACH_LOCAL = 'reach it with tmux only (it is a terminal, not an agent channel)';
const REACH_REMOTE = 'reach it with tmux over ssh only (it is a terminal, not an agent channel)';

export function formatSessionTarget({
  server = '', tmuxSession = '', socket = '', remote = false,
} = {}) {
  if (!tmuxSession) return server ? `host ${server}` : '';

  const where = server ? ` on ${server}` : '';
  // A remote session lives on that box's default socket — ours would point at nothing.
  const attach = buildAttachCmd(tmuxSession, remote ? '' : socket);
  const send = buildSendCmd(tmuxSession, remote ? '' : socket);

  if (remote && server) {
    // Inner commands are single-quoted throughout, so wrapping them in "…" is safe.
    return `tmux session '${tmuxSession}'${where} — ${REACH_REMOTE}.`
      + ` attach: ssh ${server} -t "${attach}"`
      + ` · send: ssh ${server} "${send}"`;
  }
  // The address is informational for a local session — the attach command runs on that
  // box, so it must not be wrapped in ssh here (we do not know a login user).
  return `tmux session '${tmuxSession}'${where} — ${REACH_LOCAL}.`
    + ` attach: ${attach}`
    + ` · send: ${send}`;
}


/**
 * The **toast** version — one line, no command.
 *
 * The clipboard payload above is deliberately long (it has to be runnable somewhere
 * else), but a toast that repeats it fills half a phone screen with a wall of text
 * nobody reads. The confirmation only has to say *which* session was copied.
 */
export function formatSessionTargetLabel({ server = '', tmuxSession = '' } = {}) {
  if (tmuxSession) return tmuxSession;
  return server || '';
}
