"""What kind of machine is on the other end of that SSH connection.

Everything this app does to a host assumes a POSIX shell: tmux for sessions that outlive
the browser, `/tmp` for pasted files, `~/.local/bin` for the itl CLI. On a Windows host
none of it works — and until now it failed *quietly*, one confusing symptom at a time
(the tmux toggle refusing, pastes landing nowhere, the handoff silently unavailable).

Saying "this host is Windows, here is what will not work" is worth more than pretending
to support it. Detection is deliberately one round trip and one probe: `uname -s`.
"""
from __future__ import annotations

POSIX_UNAMES = {
    "linux", "darwin", "freebsd", "openbsd", "netbsd", "dragonfly",
    "sunos", "aix", "gnu", "cygwin_nt", "msys_nt",
}

# What a shell says when `uname` is not a program it has. cmd.exe and PowerShell word it
# differently, and PowerShell also names the exception type.
_WINDOWS_HINTS = (
    "is not recognized",              # cmd.exe
    "not recognized as the name",     # PowerShell
    "commandnotfoundexception",       # PowerShell, verbose form
    "microsoft windows",              # `ver` output, if a wrapper ran it
)


def classify_platform(output: str | None) -> str:
    """'posix' | 'windows' | 'unknown' from the combined stdout+stderr of `uname -s`.

    Unknown is a real answer, not a failure to try: a locked-down shell can refuse the
    probe entirely, and guessing "windows" there would put a scary warning on a host that
    works fine.
    """
    text = (output or "").strip()
    if not text:
        return "unknown"
    lowered = text.lower()
    for line in lowered.splitlines():
        word = line.strip().split()[0] if line.strip() else ""
        # cygwin/msys report `CYGWIN_NT-10.0`, so compare on the prefix before the dash.
        if word.split("-")[0] in POSIX_UNAMES:
            return "posix"
    if any(hint in lowered for hint in _WINDOWS_HINTS):
        return "windows"
    return "unknown"


# One line, because the far side may not have a shell that understands `;` or `&&`
# (cmd.exe does not chain the POSIX way). Anything it prints — including its own
# complaint about `uname` — is the signal.
PLATFORM_PROBE = "uname -s 2>&1"
