import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Shared, in-memory "show all macros" view state for the Macros tab and the Ctrl-Space
 * palette. Both read/write this single source so toggling in one place reflects in the
 * other. Intentionally NOT persisted (matches the tab's original in-memory semantics) —
 * it resets to false on every Tabby launch.
 */
@Injectable({ providedIn: 'root' })
export class MacroViewService {
  private readonly showAll$$ = new BehaviorSubject<boolean>(false);
  readonly showAll$: Observable<boolean> = this.showAll$$.asObservable();

  get showAll(): boolean {
    return this.showAll$$.value;
  }

  setShowAll(value: boolean): void {
    if (this.showAll$$.value !== value) {
      this.showAll$$.next(value);
    }
  }

  toggle(): void {
    this.setShowAll(!this.showAll$$.value);
  }
}
