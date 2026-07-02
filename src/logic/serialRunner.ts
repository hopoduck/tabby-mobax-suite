export interface SerialRunner {
  /** Request a run. While a run is in flight, repeated calls coalesce into a single follow-up run. */
  trigger(): void;
  /** True while a run is in flight. */
  isRunning(): boolean;
}

/**
 * Wrap an async task so runs never overlap. If trigger() is called while a run is
 * in flight, exactly one follow-up run is scheduled after it settles, regardless of
 * how many triggers arrived in the meantime (coalescing). A rejected task does not
 * break sequencing — the runner swallows it, so the task must surface its own errors.
 */
export function createSerialRunner(task: () => Promise<void>): SerialRunner {
  let running = false;
  let pending = false;

  async function run(): Promise<void> {
    running = true;
    try {
      await task();
    } catch {
      // Task is responsible for surfacing its own errors.
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void run();
      }
    }
  }

  return {
    trigger(): void {
      if (running) {
        pending = true;
        return;
      }
      void run();
    },
    isRunning(): boolean {
      return running;
    },
  };
}
