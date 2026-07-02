// Probes whether `tmux` is available on the remote server, over the SSH session's own one-shot
// exec channel (the same russh mechanism the stats bar uses — see runStatsCommand). russh-
// dependent; verified by manual QA, not unit tests.

import { runStatsCommand } from './statsExec';

// Printed by the probe command only when tmux resolves on the server's PATH.
const TMUX_MARKER = '@@TMUX=1';

// `command -v` is a POSIX shell builtin (sh/bash/dash), so this works on any normal login shell.
// The trailing `echo "@@END"` is the sentinel runStatsCommand waits on (statsExec END_MARKER) to
// know the output is complete — it must be printed last and must not contain TMUX_MARKER.
const TMUX_PROBE_COMMAND = 'command -v tmux >/dev/null 2>&1 && echo "@@TMUX=1"; echo "@@END"';

/**
 * Returns `true`/`false` when the server definitively does / does not have tmux, or `null` when
 * the probe could not complete (channel error or timeout). Callers should treat `null` as
 * "unknown" and retry later rather than caching it, so a transient failure doesn't permanently
 * hide a feature that depends on tmux.
 */
export async function probeServerTmux(
  sshSession: unknown,
  timeoutMs = 4000,
): Promise<boolean | null> {
  const out = await runStatsCommand(sshSession, TMUX_PROBE_COMMAND, timeoutMs);
  if (out === null) {
    return null;
  }
  return out.includes(TMUX_MARKER);
}
