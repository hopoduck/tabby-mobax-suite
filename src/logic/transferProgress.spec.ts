import { describe, it, expect } from 'vitest';
import {
  idleState,
  started,
  withCurrent,
  withBytes,
  fileCompleted,
  finished,
  withCancel,
  progressFraction,
} from './transferProgress';

describe('transferProgress', () => {
  it('idleState is inactive with zero fraction', () => {
    expect(idleState().active).toBe(false);
    expect(progressFraction(idleState())).toBe(0);
  });

  it('started activates a batch and resets counters', () => {
    const s = started('upload', 5);
    expect(s.active).toBe(true);
    expect(s.direction).toBe('upload');
    expect(s.totalFiles).toBe(5);
    expect(s.doneFiles).toBe(0);
    expect(s.cancelRequested).toBe(false);
  });

  it('withCurrent sets the current file and resets the byte counter', () => {
    let s = started('download', 2);
    s = withBytes(withCurrent(s, 'a.bin', 100), 40);
    s = withCurrent(s, 'b.bin', 200);
    expect(s.currentName).toBe('b.bin');
    expect(s.totalBytes).toBe(200);
    expect(s.doneBytes).toBe(0);
  });

  it('withBytes accumulates and clamps at totalBytes', () => {
    let s = withCurrent(started('download', 1), 'a.bin', 100);
    s = withBytes(s, 30);
    s = withBytes(s, 30);
    expect(s.doneBytes).toBe(60);
    s = withBytes(s, 1000);
    expect(s.doneBytes).toBe(100);
  });

  it('fileCompleted increments doneFiles', () => {
    let s = started('download', 3);
    s = fileCompleted(s);
    s = fileCompleted(s);
    expect(s.doneFiles).toBe(2);
  });

  it('finished deactivates and clears the cancel flag', () => {
    let s = withCancel(started('download', 1));
    s = finished(s);
    expect(s.active).toBe(false);
    expect(s.cancelRequested).toBe(false);
  });

  it('withCancel flags cancellation', () => {
    expect(withCancel(started('download', 1)).cancelRequested).toBe(true);
  });

  it('progressFraction tracks only the current file byte fraction (not blended)', () => {
    let s = started('download', 3);
    s = withCurrent(s, 'a', 100);
    s = withBytes(s, 50);
    expect(progressFraction(s)).toBeCloseTo(0.5, 5);
    s = fileCompleted(s);
    s = withCurrent(s, 'b', 200);
    s = withBytes(s, 50);
    // 50/200 of the current file — independent of how many files are already done.
    expect(progressFraction(s)).toBeCloseTo(0.25, 5);
  });

  it('progressFraction is 0 when inactive and capped at 1', () => {
    expect(progressFraction(idleState())).toBe(0);
    let s = started('download', 1);
    s = withCurrent(s, 'a', 100);
    s = withBytes(s, 100);
    expect(progressFraction(s)).toBe(1);
  });
});
