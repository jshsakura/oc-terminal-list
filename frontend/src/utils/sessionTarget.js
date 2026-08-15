/**
 * An **LLM-friendly handle** for a pane — copied to the clipboard when the pane number
 * (top-right) is clicked. It is what you paste when you say "look at this terminal".
 *
 * **The line is a command**, with everything else in a trailing `#` comment:
 *
 *   local:   tmux -L iterminallist-app attach -t '=46aca…:'  # a1-ubuntu 100.109.62.68 (tailscale) · type: send-keys -l 'TEXT' then Enter
 *   remote:  ssh -t pi@10.0.0.5 "tmux attach -t '=mobile-xx:'"  # type: send-keys -l 'TEXT' then Enter
 *
 * Why that shape, and what stays out:
 *  - **A sentence gets read as prose.** Told "session", a receiving agent reaches for its
 *    own agent-to-agent channel (ListAgents/SendMessage and friends), which never sees a
 *    foreign harness — it wanders instead of running `send-keys`. A line starting with
 *    `tmux` cannot be mistaken for anything else, and it runs as pasted.
 *  - **One command, not two.** The send form differs from the attach form by one word,
 *    and the comment says which — spelling both out doubled the length and buried both.
 *  - **No web domain** (that is for a browser), **no pane number** (`2.2` means something
 *    only inside this app, and it shifts when a pane closes), **no cwd** (the prompt
 *    already shows it).
 *  - The socket is not optional: our sessions live on a private one (`tmux -L <socket>`),
 *    and a plain `tmux attach -t X` looks at the default socket and says "session not found".
 */

/**
 * SSH address string — user@host[:port]. Port 22 is omitted, by convention.
 *
 * This is the **display** form. It is not a command: `ssh user@host:2222` reads the whole
 * thing as a hostname and still dials port 22 (`ssh -G` confirms). See `buildSshCmd`.
 */
export function buildSshAddr(host) {
  if (!host) return '';
  const user = (host.ssh_user || '').trim();
  const name = (host.hostname || host.name || '').trim();
  if (!name) return '';
  const port = host.port && Number(host.port) !== 22 ? `:${host.port}` : '';
  return `${user ? `${user}@` : ''}${name}${port}`;
}

/**
 * How *this app* reaches that host, spelled as a command the receiver can run.
 *
 * Two things the display address cannot carry:
 *  - **The port belongs in `-p`**, not glued to the hostname with a colon.
 *  - **A `tailscale` host has no ssh credentials of ours.** `host_manager` spawns
 *    `tailscale ssh -t user@host` for those (the backend's tailnet identity is the auth),
 *    so a plain `ssh` line points at a door the receiver has no key to. `tailscale ssh`
 *    always goes over the tailnet's port 22 — `-p` has no meaning there.
 *
 * `tty` adds `-t`: attaching needs a terminal.
 */
export function buildSshCmd(host, { tty = false } = {}) {
  if (!host) return '';
  const user = (host.ssh_user || '').trim();
  const name = (host.hostname || host.name || '').trim();
  if (!name) return '';
  const dest = `${user ? `${user}@` : ''}${name}`;
  const flags = [];
  if (host.auth_method !== 'tailscale' && host.port && Number(host.port) !== 22) {
    flags.push(`-p ${Number(host.port)}`);
  }
  if (tty) flags.push('-t');
  return [host.auth_method === 'tailscale' ? 'tailscale ssh' : 'ssh', ...flags, dest].join(' ');
}

/**
 * `tmux [-L sock] attach -t '=name:'` — the one command the handle hands out.
 *
 * Both decorations on the target are load-bearing:
 *  - `-t name` is a prefix/fnmatch pattern in tmux, so a bare name can resolve to a
 *    *different* session, or to nothing once the name carries a glob character. `=name`
 *    forces an exact match, and the quotes keep the shell out of it.
 *  - The trailing colon makes the **same string** work for `send-keys`, which wants a
 *    *pane* target and fails on `=name` with "can't find pane". `=name:` stays exact
 *    while resolving to the session's current window. That is why the handle can get
 *    away with printing one command: swapping `attach` for `send-keys` is all it takes.
 *    Verified on this box — `-t '=X'` gives an empty `#{pane_id}`, `-t '=X:'` gives the
 *    pane, and `attach -t '=X:'` resolves (it only fails later, for want of a terminal).
 */
export function buildAttachCmd(tmuxSession, socket = '') {
  if (!tmuxSession) return '';
  const sock = String(socket || '').trim();
  return `tmux${sock ? ` -L ${sock}` : ''} attach -t '=${tmuxSession}:'`;
}

/**
 * The tail of the comment.
 *
 * `-l` is the trap worth the characters: without it tmux reads the text as key *names*,
 * so a message containing "Enter" or "C-c" fires them. Enter is therefore a separate
 * send-keys call, without `-l`.
 */
const TYPE_HINT = "type: send-keys -l 'TEXT' then Enter";

/** `a1-ubuntu 100.109.62.68 (tailscale)` — whichever parts we actually know. */
export function formatServerAddr({ hostname = '', ip = '', ipKind = '' } = {}) {
  const parts = [];
  if (hostname) parts.push(hostname);
  if (ip) parts.push(ipKind ? `${ip} (${ipKind})` : ip);
  return parts.join(' ');
}

export function formatSessionTarget({
  server = '', tmuxSession = '', socket = '', remote = false, host = null,
} = {}) {
  // No tmux on this host (`use_remote_tmux` off) — then the way in is the ssh line itself.
  if (!tmuxSession) {
    if (!server) return '';
    const ssh = buildSshCmd(host, { tty: true });
    return ssh ? `${ssh}  # no tmux session on this host` : `host ${server}`;
  }

  if (remote) {
    // A remote session lives on that box's default socket — ours would point at nothing.
    // The ssh line comes from the host record, not the display address: the port has to
    // be `-p`, and a tailscale host is reached with `tailscale ssh`.
    const attach = buildAttachCmd(tmuxSession);
    const ssh = buildSshCmd(host, { tty: true }) || (server ? `ssh -t ${server}` : '');
    // Everything inside is single-quoted, so wrapping it in "…" is safe.
    return ssh ? `${ssh} "${attach}"  # ${TYPE_HINT}` : `${attach}  # on ${server}, ${TYPE_HINT}`;
  }

  // Local: the command runs on that box, so it is not wrapped in ssh (we do not know a
  // login user). The address rides in the comment — an attach command with no address
  // silently means "on whichever box you happen to be", true only for a reader already
  // here. It is tagged (`tailscale` / `lan`) because the two are not interchangeable, and
  // it comes from the backend (`/api/system/self`), never from `location.hostname`, which
  // is the *web* address.
  const where = server ? `${server} · ` : '';
  return `${buildAttachCmd(tmuxSession, socket)}  # ${where}${TYPE_HINT}`;
}


/**
 * The **toast** version — one line, no command.
 *
 * The clipboard payload has to be runnable somewhere else; a toast that repeats it fills
 * half a phone screen with text nobody reads. The confirmation only has to say *which*
 * session was copied.
 */
export function formatSessionTargetLabel({ server = '', tmuxSession = '' } = {}) {
  if (tmuxSession) return tmuxSession;
  return server || '';
}
