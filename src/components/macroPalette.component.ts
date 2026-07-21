import { Component, ElementRef } from '@angular/core';
import { COMPOSITION_BUFFER_MODE } from '@angular/forms';
import { AppService, ConfigService } from 'tabby-core';
import { Macro, filterMacros, macrosForProfile } from '../logic/macro';
import { activeScopeKey, focusedLeaf } from '../logic/activeSession';
import { MacroRunnerService } from '../services/macroRunner.service';
import { MacroViewService } from '../services/macroView.service';

@Component({
  selector: 'macro-palette',
  template: `
    <div class="mobax-palette-backdrop" *ngIf="visible" (mousedown)="close()">
      <div class="mobax-palette" (mousedown)="$event.stopPropagation()">
        <div class="mobax-palette-scope">
          <span class="mobax-palette-scope-label">{{ scopeLabel }}</span>
          <checkbox
            class="mobax-palette-showall"
            text="모든 매크로"
            [ngModel]="view.showAll"
            (ngModelChange)="onToggleShowAll($event)"
          ></checkbox>
        </div>
        <input
          #queryInput
          class="mobax-palette-input"
          [(ngModel)]="query"
          (ngModelChange)="onQueryChange()"
          (keydown)="onKeydown($event)"
          placeholder="매크로 검색…"
        />
        <div class="mobax-palette-list">
          <div *ngIf="filtered.length === 0" class="mobax-palette-empty">결과 없음</div>
          <div
            *ngFor="let m of filtered; let i = index"
            class="mobax-palette-item"
            [class.active]="i === selectedIndex"
            (mouseenter)="selectedIndex = i"
            (mousedown)="$event.preventDefault(); runAt(i)"
          >
            <i class="fas fa-bolt fa-fw mobax-macro-icon"></i>
            <span class="mobax-palette-name">{{ m.name }}</span>
            <span class="mobax-palette-count">{{ m.steps.length }}단계</span>
          </div>
        </div>
        <div class="mobax-palette-hint">
          ↑↓ 이동 · Enter 실행 · Esc 닫기 ({{ filtered.length }}/{{ macros.length }})
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .mobax-palette-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 12vh;
      }
      .mobax-palette {
        width: 520px;
        max-width: 90vw;
        max-height: 60vh;
        display: flex;
        flex-direction: column;
        background: var(--bs-body-bg, #1e1e1e);
        color: var(--bs-body-color, #ddd);
        border: 1px solid var(--bs-border-color, #444);
        border-radius: 8px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
        overflow: hidden;
        font-size: 13px;
      }
      .mobax-palette-input {
        border: none;
        border-bottom: 1px solid var(--bs-border-color, #444);
        background: transparent;
        color: inherit;
        padding: 12px 14px;
        font: inherit;
        outline: none;
      }
      /* Dim the whole scope row (label + the "모든 매크로" toggle) uniformly, so the toggle's
         opacity matches the scope label instead of sitting at full brightness beside it. */
      .mobax-palette-scope {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 6px 14px 0;
        font-size: 11px;
        opacity: 0.7;
      }
      .mobax-palette-scope-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Right-aligned "모든 매크로" view toggle (Tabby's own <checkbox>, Bootstrap .form-check),
         shared with the Macros tab via MacroViewService. */
      .mobax-palette-showall {
        flex: 0 0 auto;
        font-size: 11px;
      }
      /* Tabby's <checkbox> renders Bootstrap's .form-check, which floats the input with a
         margin-top:0.25em tuned for the 1rem base font — at our 11px it leaves the box and label
         vertically misaligned. Re-lay the inner .form-check as a centered flex row and clear the
         float/negative-margin the block layout relied on. */
      .mobax-palette-showall ::ng-deep .form-check {
        display: flex;
        align-items: center;
        gap: 5px;
        margin: 0;
        min-height: 0;
        padding-left: 0;
      }
      .mobax-palette-showall ::ng-deep .form-check-input {
        float: none;
        margin: 0;
      }
      .mobax-palette-showall ::ng-deep .form-check-label {
        margin: 0;
        line-height: 1;
      }
      .mobax-palette-list {
        overflow: auto;
        flex: 1 1 auto;
      }
      .mobax-palette-empty {
        padding: 14px;
        opacity: 0.5;
      }
      .mobax-palette-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        cursor: pointer;
      }
      .mobax-palette-item.active {
        background: rgba(127, 127, 127, 0.26);
        background: color-mix(in srgb, currentColor 16%, transparent);
        box-shadow: inset 2px 0 0 var(--bs-primary, #3b82f6);
      }
      .mobax-palette-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Leading row marker — dimmed so it reads as a bullet, not a loud icon. fa-fw gives it a
         fixed, centered box so the glyph has equal whitespace on both sides; the row's gap then
         separates it from the name evenly. */
      .mobax-macro-icon {
        flex: 0 0 auto;
        opacity: 0.6;
      }
      .mobax-palette-count {
        flex: 0 0 auto;
        font-size: 11px;
        opacity: 0.7;
      }
      .mobax-palette-hint {
        padding: 6px 14px;
        font-size: 11px;
        opacity: 0.55;
        border-top: 1px solid var(--bs-border-color, #444);
      }
    `,
  ],
  // Korean/CJK IME: by default Angular's DefaultValueAccessor buffers input during
  // composition and only fires ngModelChange on compositionend, so the filter would
  // not update while a Hangul syllable is still being composed. Disabling the
  // composition buffer propagates every keystroke immediately for live search.
  providers: [{ provide: COMPOSITION_BUFFER_MODE, useValue: false }],
})
export class MacroPaletteComponent {
  visible = false;
  query = '';
  macros: Macro[] = [];
  filtered: Macro[] = [];
  selectedIndex = 0;
  scopeLabel = '전역';
  // Captured at open() so the "모든 매크로" toggle can re-derive `macros` without re-reading
  // config/active-tab: the full list and the active profile scope for the current session.
  private allMacros: Macro[] = [];
  private pid: string | null = null;

  constructor(
    private config: ConfigService,
    private runner: MacroRunnerService,
    private host: ElementRef<HTMLElement>,
    private app: AppService,
    public view: MacroViewService,
  ) {}

  open(): void {
    this.allMacros = [...(this.config.store.mobaxMacros?.list ?? [])];
    this.pid = activeScopeKey(this.app.activeTab);
    const leaf = focusedLeaf(this.app.activeTab) as { profile?: { name?: string } } | null;
    this.scopeLabel = leaf?.profile?.name ? `${leaf.profile.name} 세션` : '전역';
    this.query = '';
    this.recompute();
    this.visible = true;
    this.focusInput();
  }

  // Re-derive the candidate list from the shared show-all state, then re-apply the search
  // filter. Used on open and whenever the "모든 매크로" toggle flips while the palette is open.
  private recompute(): void {
    this.macros = this.view.showAll
      ? this.allMacros
      : macrosForProfile(this.allMacros, this.pid);
    this.filtered = filterMacros(this.query, this.macros);
    this.selectedIndex = 0;
  }

  private focusInput(): void {
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.mobax-palette-input',
      ) as HTMLInputElement | null;
      el?.focus();
    });
  }

  close(): void {
    this.visible = false;
  }

  toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  onQueryChange(): void {
    this.filtered = filterMacros(this.query, this.macros);
    this.selectedIndex = 0;
  }

  // Shared with the Macros tab: write the new state, re-derive the list, and return focus to
  // the search input so keyboard flow (typing / ↑↓ / Enter) is uninterrupted.
  onToggleShowAll(value: boolean): void {
    this.view.setShowAll(value);
    this.recompute();
    this.focusInput();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.runAt(this.selectedIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  runAt(index: number): void {
    const m = this.filtered[index];
    if (!m) {
      return;
    }
    this.close();
    void this.runner.run(m);
  }
}
