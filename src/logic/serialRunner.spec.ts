import { describe, it, expect } from 'vitest';
import { createSerialRunner } from './serialRunner';

// Drain all pending microtasks + timers.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createSerialRunner', () => {
  it('runs the task once on trigger and reports running state', async () => {
    const gates: Array<() => void> = [];
    let calls = 0;
    const runner = createSerialRunner(
      () =>
        new Promise<void>((resolve) => {
          calls++;
          gates.push(resolve);
        }),
    );

    runner.trigger();
    expect(calls).toBe(1);
    expect(runner.isRunning()).toBe(true);

    gates[0]();
    await flush();
    expect(runner.isRunning()).toBe(false);
  });

  it('does not start a second run while one is in flight', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const gates: Array<() => void> = [];
    const runner = createSerialRunner(
      () =>
        new Promise<void>((resolve) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          gates.push(() => {
            concurrent--;
            resolve();
          });
        }),
    );

    runner.trigger();
    runner.trigger();
    gates[0]();
    await flush();
    if (gates[1]) gates[1]();
    await flush();

    expect(maxConcurrent).toBe(1);
  });

  it('coalesces multiple triggers during a run into a single follow-up run', async () => {
    const gates: Array<() => void> = [];
    let calls = 0;
    const runner = createSerialRunner(
      () =>
        new Promise<void>((resolve) => {
          calls++;
          gates.push(resolve);
        }),
    );

    runner.trigger(); // run #1
    expect(calls).toBe(1);
    runner.trigger(); // pending
    runner.trigger(); // coalesced into the same pending
    expect(calls).toBe(1);

    gates[0](); // finish run #1
    await flush();
    expect(calls).toBe(2); // exactly one follow-up

    gates[1](); // finish run #2
    await flush();
    expect(calls).toBe(2); // nothing else queued
    expect(runner.isRunning()).toBe(false);
  });

  it('keeps sequencing after a task rejection', async () => {
    const gates: Array<(ok: boolean) => void> = [];
    let calls = 0;
    const runner = createSerialRunner(
      () =>
        new Promise<void>((resolve, reject) => {
          calls++;
          gates.push((ok) => (ok ? resolve() : reject(new Error('boom'))));
        }),
    );

    runner.trigger(); // run #1
    runner.trigger(); // pending
    gates[0](false); // reject run #1
    await flush();
    expect(calls).toBe(2); // follow-up still ran

    gates[1](true);
    await flush();
    expect(calls).toBe(2);
  });
});
