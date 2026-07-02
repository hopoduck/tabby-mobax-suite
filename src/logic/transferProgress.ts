// Pure transfer-progress state + transitions. No Angular/Tabby imports so it stays unit-testable.
// TransferService holds one of these; the SFTP bottom strip renders from it.

export type TransferDirection = 'upload' | 'download';

export interface TransferProgressState {
  active: boolean;
  direction: TransferDirection;
  totalFiles: number; // 1 for a single-file transfer
  doneFiles: number;
  currentName: string;
  doneBytes: number; // accumulated for the current file
  totalBytes: number; // size of the current file
  cancelRequested: boolean;
}

export function idleState(): TransferProgressState {
  return {
    active: false,
    direction: 'download',
    totalFiles: 0,
    doneFiles: 0,
    currentName: '',
    doneBytes: 0,
    totalBytes: 0,
    cancelRequested: false,
  };
}

// Begin a batch of `totalFiles` transfers in `direction`; resets counters and the cancel flag.
export function started(direction: TransferDirection, totalFiles: number): TransferProgressState {
  return {
    active: true,
    direction,
    totalFiles: Math.max(0, totalFiles),
    doneFiles: 0,
    currentName: '',
    doneBytes: 0,
    totalBytes: 0,
    cancelRequested: false,
  };
}

// Switch to a new current file: name + its total size; byte counter resets.
export function withCurrent(
  s: TransferProgressState,
  name: string,
  totalBytes: number,
): TransferProgressState {
  return { ...s, currentName: name, totalBytes: Math.max(0, totalBytes), doneBytes: 0 };
}

// Add `n` transferred bytes to the current file (clamped at totalBytes when that is known).
export function withBytes(s: TransferProgressState, n: number): TransferProgressState {
  const doneBytes = s.doneBytes + Math.max(0, n);
  return { ...s, doneBytes: s.totalBytes > 0 ? Math.min(doneBytes, s.totalBytes) : doneBytes };
}

// Mark the current file finished (increments doneFiles).
export function fileCompleted(s: TransferProgressState): TransferProgressState {
  return { ...s, doneFiles: s.doneFiles + 1 };
}

// End the batch — back to inactive so the strip hides; clears the cancel flag.
export function finished(s: TransferProgressState): TransferProgressState {
  return { ...s, active: false, cancelRequested: false };
}

// Flag a cancel request; the running transfer polls this and throws.
export function withCancel(s: TransferProgressState): TransferProgressState {
  return { ...s, cancelRequested: true };
}

// Progress of the CURRENT file in [0, 1] (its transferred bytes). Transfers are serial, so the strip
// shows one bar = the single file in flight, not a blended all-files total. The doneFiles/totalFiles
// count is surfaced separately as text (which file we're on).
export function progressFraction(s: TransferProgressState): number {
  if (!s.active) {
    return 0;
  }
  return s.totalBytes > 0 ? Math.min(1, s.doneBytes / s.totalBytes) : 0;
}
