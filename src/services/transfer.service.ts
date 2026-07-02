import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  TransferProgressState,
  TransferDirection,
  idleState,
  started,
  withCurrent,
  withBytes,
  fileCompleted,
  finished,
  withCancel,
} from '../logic/transferProgress';
import { ProgressSink } from '../transferWrap';

// Holds the single in-flight transfer-progress state for the SFTP bottom strip. Root singleton so
// the file list (runs transfers) and the SFTP tab (renders the strip) share one instance, and so it
// survives the SFTP tab component's *ngIf re-create. Implements ProgressSink so a wrapped transfer
// reports straight into it.
@Injectable({ providedIn: 'root' })
export class TransferService implements ProgressSink {
  private state$ = new BehaviorSubject<TransferProgressState>(idleState());

  get changes$(): Observable<TransferProgressState> {
    return this.state$;
  }
  get state(): TransferProgressState {
    return this.state$.value;
  }

  start(direction: TransferDirection, totalFiles: number): void {
    this.state$.next(started(direction, totalFiles));
  }
  setCurrent(name: string, totalBytes: number): void {
    this.state$.next(withCurrent(this.state$.value, name, totalBytes));
  }
  completeFile(): void {
    this.state$.next(fileCompleted(this.state$.value));
  }
  finish(): void {
    this.state$.next(finished(this.state$.value));
  }
  requestCancel(): void {
    this.state$.next(withCancel(this.state$.value));
  }

  // --- ProgressSink (called per chunk by a wrapped transfer) ---
  addBytes(n: number): void {
    this.state$.next(withBytes(this.state$.value, n));
  }
  isCancelRequested(): boolean {
    return this.state$.value.cancelRequested;
  }
}
