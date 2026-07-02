// Runs a one-shot command on the active SSH connection via a dedicated russh
// session channel (separate from the user's interactive shell) and returns the
// combined stdout. russh-dependent; verified by manual QA, not unit tests.
//
// russh API (host russh/lib/index.js + channel.js):
//   ssh.openSessionChannel()    -> NewChannel  (NOT usable directly)
//   ssh.activateChannel(newCh)  -> Channel      (has data$ / requestExec / close)
//   channel.data$   : Observable<Buffer>  (stdout; buffers pre-subscription data via startWith)
//   channel.requestExec(command): Promise<void>
//   channel.close(): Promise<void>
//
// Completion is detected by the "@@END" sentinel the command prints last — NOT by the
// channel's eof$/closed$ events. russh buffers events per channel id and replays them on
// subscribe (ChannelEventBuffer); with a fresh channel opened every poll, those events can
// fire early and truncate the trailing sections (user/disk flicker every other poll). Waiting
// for the sentinel guarantees we only ever return the complete output.

interface RusshSubscription {
  unsubscribe(): void;
}

interface RusshObservable<T> {
  subscribe(next: (value: T) => void): RusshSubscription;
}

interface RusshChannel {
  data$: RusshObservable<Buffer>;
  requestExec(command: string): Promise<void>;
  close(): Promise<void>;
}

interface AuthenticatedClient {
  openSessionChannel(): Promise<unknown>;
  activateChannel(newChannel: unknown): Promise<RusshChannel>;
}

interface StatsCapableSession {
  ssh?: Partial<AuthenticatedClient>;
}

// Must match the final `echo "@@END"` in buildStatsCommand() (src/logic/serverStats.ts).
const END_MARKER = '@@END';

export async function runStatsCommand(
  sshSession: unknown,
  command: string,
  timeoutMs = 5000,
): Promise<string | null> {
  const ssh = (sshSession as StatsCapableSession | null)?.ssh;
  if (
    !ssh ||
    typeof ssh.openSessionChannel !== 'function' ||
    typeof ssh.activateChannel !== 'function'
  ) {
    return null;
  }

  // openSessionChannel() returns a NewChannel; activateChannel() turns it into a usable Channel.
  let ch: RusshChannel;
  try {
    const newChannel = await ssh.openSessionChannel();
    ch = await ssh.activateChannel(newChannel);
  } catch {
    return null;
  }

  if (!ch || !ch.data$ || typeof ch.data$.subscribe !== 'function' || typeof ch.requestExec !== 'function') {
    try {
      await ch?.close?.();
    } catch {
      /* ignore */
    }
    return null;
  }

  const channel = ch;
  let acc = '';
  let dataSub: RusshSubscription | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        dataSub?.unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        void channel.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    try {
      // Timeout returns the output only if complete (sentinel seen); otherwise null, so the
      // caller keeps the last good values instead of blanking the bar.
      timer = setTimeout(() => finish(acc.includes(END_MARKER) ? acc : null), timeoutMs);
      dataSub = channel.data$.subscribe((d) => {
        acc += Buffer.from(d).toString('utf8');
        if (acc.includes(END_MARKER)) {
          finish(acc);
        }
      });
      channel.requestExec(command).catch(() => finish(null));
    } catch {
      finish(null);
    }
  });
}
