import { Component, OnInit, OnDestroy, NgZone, ChangeDetectorRef } from '@angular/core';
import {
  ConfigService,
  PlatformService,
  MenuItemOptions,
  AppService,
  ProfilesService,
  NotificationsService,
} from 'tabby-core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  Macro,
  MacroStep,
  MacroKey,
  CommandStep,
  macrosForProfile,
  applyVisibleReorder,
} from '../logic/macro';
import { buildVarMap } from '../logic/variables';
import { activeProfileId } from '../logic/activeSession';
import { MacroRunnerService } from '../services/macroRunner.service';
import { MacroViewService } from '../services/macroView.service';
import { writeFileSync, readFileSync } from 'fs';
import {
  buildExport,
  serializeExport,
  parseImport,
  applyImport,
  countConflicts,
  resolveProfileScopes,
  isParseOk,
} from '../logic/macroIO';

const KEY_OPTIONS: { value: MacroKey; label: string }[] = [
  { value: 'enter', label: 'Enter' },
  { value: 'ctrl-c', label: 'Ctrl+C' },
  { value: 'ctrl-d', label: 'Ctrl+D' },
  { value: 'ctrl-z', label: 'Ctrl+Z' },
  { value: 'ctrl-l', label: 'Ctrl+L (clear)' },
  { value: 'tab', label: 'Tab' },
  { value: 'esc', label: 'Esc' },
  { value: 'up', label: '↑' },
  { value: 'down', label: '↓' },
  { value: 'left', label: '←' },
  { value: 'right', label: '→' },
];

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Minimal structural type for the Electron `dialog` main module reached via @electron/remote,
// so we avoid an electron type dependency (electron is an external).
interface RemoteDialog {
  showSaveDialog(opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(opts: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

@Component({
  selector: 'macros-tab',
  template: `
    <div class="mobax-macros" *ngIf="mode === 'list'">
      <div class="mobax-toolbar">
        <button class="mobax-tool-btn" (click)="newMacro()" title="새 매크로">
          <i class="fas fa-plus"></i>
        </button>
        <button
          class="mobax-tool-btn"
          (click)="editSelected()"
          [disabled]="!selectedId"
          title="편집"
        >
          <i class="fas fa-pen"></i>
        </button>
        <button
          class="mobax-tool-btn"
          (click)="deleteSelected()"
          [disabled]="!selectedId"
          title="삭제"
        >
          <i class="fas fa-trash"></i>
        </button>
        <span class="mobax-tool-sep" aria-hidden="true"></span>
        <button class="mobax-tool-btn" (click)="openVariables()" title="변수 관리">
          <i class="fas fa-dollar-sign"></i>
        </button>
        <span class="mobax-toolbar-spacer"></span>
        <button
          class="mobax-tool-btn"
          [class.is-active]="view.showAll"
          (click)="openMoreMenu($event)"
          title="더보기"
        >
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>
      <div *ngIf="visibleMacros.length === 0" class="mobax-hint">표시할 매크로가 없습니다.</div>
      <div cdkDropList (cdkDropListDropped)="onDrop($event)">
        <div
          *ngFor="let m of visibleMacros"
          class="mobax-macro-row"
          cdkDrag
          [class.selected]="m.id === selectedId"
          (click)="select(m)"
          (dblclick)="run(m)"
          (contextmenu)="onContextMenu($event, m)"
        >
          <i class="fas fa-bolt fa-fw mobax-macro-icon"></i>
          <span class="mobax-macro-name">{{ m.name }}</span>
          <span class="mobax-macro-scope">{{ scopeBadge(m) }}</span>
          <span class="mobax-macro-count">{{ m.steps.length }}단계</span>
        </div>
      </div>
    </div>

    <div class="mobax-macros mobax-vars" *ngIf="mode === 'variables'">
      <div class="mobax-toolbar">
        <button class="mobax-tool-btn" (click)="closeVariables()" title="뒤로">
          <i class="fas fa-chevron-left"></i>
        </button>
        <span class="mobax-toolbar-title">변수</span>
        <span class="mobax-toolbar-spacer"></span>
      </div>
      <variables-tab></variables-tab>
    </div>

    <div class="mobax-macros mobax-edit" *ngIf="mode === 'edit' && draft">
      <div class="mobax-toolbar">
        <button class="mobax-tool-btn" (click)="cancelEdit()" title="취소">
          <i class="fas fa-chevron-left"></i>
        </button>
        <span class="mobax-toolbar-title">매크로 편집</span>
        <span class="mobax-toolbar-spacer"></span>
        <button class="mobax-tool-btn mobax-tool-primary" (click)="saveDraft()" title="저장">
          <i class="fas fa-check"></i> 저장
        </button>
      </div>
      <div class="mobax-field">
        <label>이름</label>
        <input class="mobax-text" [(ngModel)]="draft.name" placeholder="매크로 이름" />
      </div>
      <div class="mobax-field">
        <label>적용 대상</label>
        <select class="mobax-text" [(ngModel)]="draft.profileId">
          <option [ngValue]="null">전역 (모든 세션)</option>
          <option *ngFor="let p of profiles" [ngValue]="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="mobax-steps-head">
        <span>단계</span>
        <button class="mobax-tool-btn" (click)="addCommand()" title="명령 추가">
          <i class="fas fa-plus"></i> 명령
        </button>
        <button class="mobax-tool-btn" (click)="addKey()" title="키 추가">
          <i class="fas fa-plus"></i> 키
        </button>
      </div>
      <div class="mobax-var-chips" *ngIf="variableNames.length">
        <span class="mobax-var-chips-label">변수</span>
        <button
          type="button"
          class="mobax-var-chip"
          *ngFor="let n of variableNames"
          (mousedown)="insertVariable(n, $event)"
          title="커서 위치에 삽입"
        >
          {{ chipLabel(n) }}
        </button>
      </div>
      <div cdkDropList (cdkDropListDropped)="onStepDrop($event)">
        <div *ngFor="let s of draft.steps; let i = index" class="mobax-step" cdkDrag>
          <div class="mobax-step-row">
            <span class="mobax-step-handle" cdkDragHandle><i class="fas fa-grip-vertical"></i></span>
            <select [(ngModel)]="s.type" (ngModelChange)="onStepTypeChange(s)">
              <option value="command">명령</option>
              <option value="key">키</option>
            </select>
            <input
              *ngIf="s.type === 'command'"
              class="mobax-text"
              [(ngModel)]="$any(s).text"
              (focus)="onCommandFocus(s, $event)"
              placeholder="명령어"
            />
            <select *ngIf="s.type === 'key'" [(ngModel)]="$any(s).key">
              <option *ngFor="let k of keyOptions" [value]="k.value">{{ k.label }}</option>
            </select>
            <button class="mobax-tool-btn" (click)="removeStep(i)" title="삭제">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="mobax-step-row mobax-step-opts">
            <checkbox
              *ngIf="s.type === 'command'"
              class="mobax-check"
              text="Enter 실행"
              [(ngModel)]="$any(s).enter"
            ></checkbox>
            <label class="mobax-delay"
              >지연 <input type="number" min="0" [(ngModel)]="s.delayMs" /> ms</label
            >
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .mobax-macros {
        height: 100%;
        overflow: auto;
        /* No top padding so the opaque toolbar header sits flush at the top, aligning with
           Tabby's tab strip. */
        padding: 0 0 4px;
        user-select: none;
      }
      .mobax-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        box-sizing: border-box;
        /* Match Tabby's tab strip height (--tabs-height, inherited from app-root) so this
           panel header lines up with the main tab bar. */
        height: var(--tabs-height, 38px);
        padding: 0 6px;
        /* Pin the toolbar to the top of the scrolling .mobax-macros container so it stays put
           while the list scrolls under it; no margin-bottom so no transparent gap shows a row. */
        position: sticky;
        top: 0;
        z-index: 2;
        /* Opaque chrome bg so tabby-background doesn't show through the header. */
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        border-bottom: 1px solid var(--bs-border-color, #333);
        /* Empty toolbar space acts as a window-drag handle, like the app title bar. Interactive
           children (buttons, the show-all checkbox) opt back out with no-drag. */
        -webkit-app-region: drag;
      }
      .mobax-toolbar-title {
        font-weight: 500;
      }
      .mobax-toolbar-spacer {
        flex: 1 1 auto;
      }
      /* Vertical divider grouping the macro actions apart from the variables mode-switch, mirroring
         the SFTP toolbar's .mobax-tool-sep. Decorative, so it can stay in the window-drag region. */
      .mobax-tool-sep {
        flex: 0 0 auto;
        align-self: stretch;
        width: 1px;
        margin: 4px 2px;
        background: var(--bs-border-color, #333);
        opacity: 0.6;
      }
      .mobax-tool-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 26px;
        height: 24px;
        padding: 0 6px;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: inherit;
        opacity: 0.8;
        cursor: pointer;
        font-size: 13px;
        /* Opt out of the toolbar's window-drag region so clicks reach the button. */
        -webkit-app-region: no-drag;
      }
      .mobax-tool-btn:hover:not(:disabled) {
        opacity: 1;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .mobax-tool-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }
      /* The "모든 매크로" toggle now lives inside the ⋮ menu, so tint the ⋮ button while the filter
         is active to keep that state visible at a glance. */
      .mobax-tool-btn.is-active {
        opacity: 1;
        color: var(--bs-primary, #3b82f6);
      }
      /* Save is a deliberate commit action — full opacity + label so it reads as primary. */
      .mobax-tool-primary {
        opacity: 1;
        font-weight: 500;
      }
      .mobax-hint {
        padding: 12px;
        opacity: 0.6;
      }
      .mobax-macro-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        cursor: pointer;
      }
      .mobax-macro-row:hover {
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .mobax-macro-row.selected {
        box-shadow: inset 2px 0 0 var(--bs-primary, #3b82f6);
        background: rgba(127, 127, 127, 0.18);
      }
      .mobax-macro-name {
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
      .mobax-macro-count {
        flex: 0 0 auto;
        font-size: 11px;
        opacity: 0.5;
      }
      .mobax-macro-scope {
        flex: 0 0 auto;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.08));
        opacity: 0.7;
      }
      .mobax-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 6px 10px;
      }
      .mobax-field label {
        font-size: 11px;
        opacity: 0.7;
      }
      .mobax-text,
      select,
      input[type='number'] {
        background: var(--bs-body-bg, #1e1e1e);
        color: inherit;
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 3px;
        padding: 2px 5px;
        font: inherit;
      }
      .mobax-text {
        width: 100%;
      }
      .mobax-steps-head {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-top: 1px solid var(--bs-border-color, #333);
      }
      .mobax-steps-head span {
        flex: 1 1 auto;
        font-size: 11px;
        opacity: 0.7;
      }
      .mobax-step {
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 4px;
        margin: 4px 8px;
        padding: 4px;
        background: var(--bs-tertiary-bg, rgba(0, 0, 0, 0.12));
      }
      .mobax-step-row {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .mobax-step-row + .mobax-step-row {
        margin-top: 3px;
      }
      .mobax-step-opts {
        padding-left: 18px;
        font-size: 11px;
        opacity: 0.85;
      }
      .mobax-step-handle {
        cursor: grab;
        opacity: 0.5;
        flex: 0 0 auto;
      }
      .mobax-step .mobax-text {
        flex: 1 1 auto;
        min-width: 0;
      }
      .mobax-check {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      /* Tabby's <checkbox> renders Bootstrap's floated .form-check; at this compact editor size the
         float leaves box/label misaligned, so re-lay it as a centered flex row (mirrors the macro
         palette's toggle). */
      .mobax-check ::ng-deep .form-check {
        display: flex;
        align-items: center;
        gap: 4px;
        margin: 0;
        min-height: 0;
        padding-left: 0;
      }
      .mobax-check ::ng-deep .form-check-input {
        float: none;
        margin: 0;
      }
      .mobax-check ::ng-deep .form-check-label {
        margin: 0;
        line-height: 1;
      }
      /* Push 지연 to the far right of the options row so it reads as a separate control from the
         "Enter 실행" checkbox on the left (margin:auto works for key steps too, where Enter is absent). */
      .mobax-delay {
        margin-left: auto;
      }
      .mobax-delay input {
        width: 56px;
        margin-left: 3px;
      }
      .mobax-var-chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding: 2px 10px 6px;
      }
      .mobax-var-chips-label {
        font-size: 11px;
        opacity: 0.6;
        margin-right: 2px;
      }
      .mobax-var-chip {
        font-size: 11px;
        padding: 1px 7px;
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 10px;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
        color: inherit;
        cursor: pointer;
      }
      .mobax-var-chip:hover {
        background: var(--bs-primary, #3b82f6);
        color: #fff;
      }
      .cdk-drag-preview {
        background: var(--bs-body-bg, #1e1e1e);
        border-radius: 4px;
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5);
      }
      .cdk-drag-placeholder {
        opacity: 0.25;
      }
    `,
  ],
})
export class MacrosTabComponent implements OnInit, OnDestroy {
  mode: 'list' | 'edit' | 'variables' = 'list';
  macros: Macro[] = [];
  selectedId: string | null = null;
  draft: Macro | null = null;
  keyOptions = KEY_OPTIONS;
  // Editor variable chips: track the command input the caret is in so a chip can splice
  // ${name} at the caret. Both reset when leaving edit mode.
  focusedCommand: CommandStep | null = null;
  focusedInput: HTMLInputElement | null = null;
  profiles: { id: string; name: string }[] = [];
  private profileNames = new Map<string, string>();
  private destroyed$ = new Subject<void>();

  constructor(
    private config: ConfigService,
    private platform: PlatformService,
    private runner: MacroRunnerService,
    private zone: NgZone,
    private app: AppService,
    private profilesService: ProfilesService,
    private cdr: ChangeDetectorRef,
    private notifications: NotificationsService,
    public view: MacroViewService,
  ) {}

  async ngOnInit(): Promise<void> {
    // Populate the list synchronously so it paints in this view's first change-detection pass.
    // This component is created lazily by the host's *ngIf, and the profile fetch below resolves
    // outside Angular's zone — doing reload() only after it would leave the list blank until the
    // next incidental tick (the visible "data shows up late" lag).
    this.reload();
    // The default (filtered) view follows the active session; repaint when it changes.
    this.app.activeTabChange$.pipe(takeUntil(this.destroyed$)).subscribe(() => {
      this.cdr.detectChanges();
    });
    // "모든 매크로" is shared with the palette; repaint when it's toggled from either side.
    this.view.showAll$.pipe(takeUntil(this.destroyed$)).subscribe(() => {
      this.cdr.detectChanges();
    });
    // Profile names back the scope badges + editor selector; load them async, then repaint so the
    // badges fill in (the list itself doesn't depend on them).
    await this.loadProfiles();
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  private async loadProfiles(): Promise<void> {
    const all = await this.profilesService.getProfiles({ clone: true, includeBuiltin: false });
    this.profiles = all
      .filter((p) => p.id)
      .map((p) => ({ id: p.id as string, name: p.name ?? (p.id as string) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.profileNames = new Map(this.profiles.map((p) => [p.id, p.name]));
  }

  // Default view = global ∪ active-profile (the same set the palette runs). The "모든 매크로"
  // checkbox drops the filter so any macro can be managed from any session. `macros` stays the
  // authoritative full list that persist() writes.
  get visibleMacros(): Macro[] {
    if (this.view.showAll) {
      return this.macros;
    }
    return macrosForProfile(this.macros, activeProfileId(this.app.activeTab));
  }

  scopeBadge(m: Macro): string {
    if (!m.profileId) {
      return '전역';
    }
    return this.profileNames.get(m.profileId) ?? '(삭제된 프로필)';
  }

  private reload(): void {
    this.macros = [...(this.config.store.mobaxMacros?.list ?? [])];
  }

  private persist(): void {
    // ConfigProxy: mobaxMacros is getter-only; mutate the leaf 'list'.
    Object.assign(this.config.store.mobaxMacros, { list: this.macros });
    this.config.save();
  }

  select(m: Macro): void {
    this.selectedId = m.id;
  }

  run(m: Macro): void {
    void this.runner.run(m);
  }

  newMacro(): void {
    this.draft = {
      id: genId(),
      name: '새 매크로',
      steps: [],
      profileId: activeProfileId(this.app.activeTab),
    };
    this.mode = 'edit';
  }

  editSelected(): void {
    const m = this.macros.find((x) => x.id === this.selectedId);
    if (m) {
      // Deep clone so cancel discards edits.
      this.draft = JSON.parse(JSON.stringify(m));
      // Legacy macros have no profileId; normalize to null so the selector binds the global option.
      this.draft!.profileId = m.profileId ?? null;
      this.mode = 'edit';
    }
  }

  async deleteSelected(): Promise<void> {
    const m = this.macros.find((x) => x.id === this.selectedId);
    if (!m) {
      return;
    }
    const result = await this.platform.showMessageBox({
      type: 'warning',
      message: `'${m.name}' 매크로를 삭제할까요?`,
      buttons: ['삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) {
      return;
    }
    this.macros = this.macros.filter((x) => x.id !== m.id);
    this.selectedId = null;
    this.persist();
  }

  cancelEdit(): void {
    this.draft = null;
    this.focusedCommand = null;
    this.focusedInput = null;
    this.mode = 'list';
  }

  saveDraft(): void {
    if (!this.draft) {
      return;
    }
    this.draft.name = this.draft.name.trim() || '새 매크로';
    const idx = this.macros.findIndex((x) => x.id === this.draft!.id);
    if (idx >= 0) {
      this.macros[idx] = this.draft;
    } else {
      this.macros.push(this.draft);
    }
    this.selectedId = this.draft.id;
    this.persist();
    this.draft = null;
    this.focusedCommand = null;
    this.focusedInput = null;
    this.mode = 'list';
  }

  addCommand(): void {
    this.draft?.steps.push({ id: genId(), type: 'command', text: '', enter: true, delayMs: 300 });
  }

  addKey(): void {
    this.draft?.steps.push({ id: genId(), type: 'key', key: 'enter', delayMs: 0 });
  }

  removeStep(i: number): void {
    this.draft?.steps.splice(i, 1);
  }

  // Overflow "⋮" menu for the list toolbar — holds the show-all view filter so the toolbar row
  // stays icon-only (matching the SFTP tab). Click fires outside Angular's zone, so toggle inside
  // zone.run to trigger change detection.
  openMoreMenu(event: MouseEvent): void {
    event.preventDefault();
    const menu: MenuItemOptions[] = [
      {
        label: '모든 매크로 표시',
        type: 'checkbox',
        checked: this.view.showAll,
        click: () =>
          this.zone.run(() => {
            this.view.toggle();
          }),
      },
      { type: 'separator' },
      {
        label: '내보내기…',
        click: () => this.zone.run(() => void this.exportMacros()),
      },
      {
        label: '불러오기…',
        click: () => this.zone.run(() => void this.importMacros()),
      },
    ];
    this.platform.popupContextMenu(menu, event);
  }

  private getDialog(): RemoteDialog | null {
    try {
      const nodeRequire = (window as unknown as { nodeRequire?: (id: string) => unknown })
        .nodeRequire;
      if (!nodeRequire) {
        return null;
      }
      const remote = nodeRequire('@electron/remote') as
        | { getBuiltin?: (name: string) => unknown }
        | undefined;
      return (remote?.getBuiltin?.('dialog') as RemoteDialog | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private dateStamp(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  async exportMacros(): Promise<void> {
    const dialog = this.getDialog();
    if (!dialog) {
      this.notifications.error('내보내기 불가', 'Electron 대화상자를 사용할 수 없습니다.');
      return;
    }
    const file = buildExport(
      this.config.store.mobaxMacros?.list ?? [],
      this.config.store.mobaxVariables?.list ?? [],
    );
    const res = await dialog.showSaveDialog({
      title: '매크로 내보내기',
      defaultPath: `tabby-macros-${this.dateStamp()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) {
      return;
    }
    try {
      writeFileSync(res.filePath, serializeExport(file), 'utf8');
    } catch (err) {
      this.notifications.error('내보내기 실패', String((err as Error)?.message ?? err));
      return;
    }
    this.notifications.notice(
      `내보내기 완료: 매크로 ${file.macros.length}개, 변수 ${file.variables.length}개`,
    );
  }

  async importMacros(): Promise<void> {
    const dialog = this.getDialog();
    if (!dialog) {
      this.notifications.error('불러오기 불가', 'Electron 대화상자를 사용할 수 없습니다.');
      return;
    }
    const res = await dialog.showOpenDialog({
      title: '매크로 불러오기',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.length) {
      return;
    }
    let text: string;
    try {
      text = readFileSync(res.filePaths[0], 'utf8');
    } catch (err) {
      this.notifications.error('불러오기 실패', String((err as Error)?.message ?? err));
      return;
    }
    const parsed = parseImport(text);
    if (!isParseOk(parsed)) {
      await this.platform.showMessageBox({
        type: 'error',
        message: '불러오기 실패',
        detail: parsed.error,
        buttons: ['확인'],
        defaultId: 0,
      });
      return;
    }
    const existing = {
      macros: this.config.store.mobaxMacros?.list ?? [],
      variables: this.config.store.mobaxVariables?.list ?? [],
    };
    // Refresh the local profile list, then keep each imported macro's profileId only if that
    // profile exists here; otherwise it falls back to global.
    await this.loadProfiles();
    const incoming = {
      macros: resolveProfileScopes(
        parsed.macros,
        this.profiles.map((p) => p.id),
      ),
      variables: parsed.variables,
    };
    const conflicts = countConflicts(existing, incoming);
    const detail =
      `매크로 ${incoming.macros.length}개, 변수 ${incoming.variables.length}개\n` +
      `이름이 겹치는 항목 ${conflicts}개` +
      (parsed.skipped ? `\n형식 오류로 건너뛴 항목 ${parsed.skipped}개` : '');
    const choice = await this.platform.showMessageBox({
      type: 'warning',
      message: '매크로 불러오기',
      detail,
      buttons: ['전체 교체', '병합·덮어쓰기', '병합·건너뛰기', '취소'],
      defaultId: 1,
      cancelId: 3,
    });
    let mode: 'replace' | 'merge';
    let onConflict: 'overwrite' | 'skip';
    if (choice.response === 0) {
      mode = 'replace';
      onConflict = 'overwrite';
    } else if (choice.response === 1) {
      mode = 'merge';
      onConflict = 'overwrite';
    } else if (choice.response === 2) {
      mode = 'merge';
      onConflict = 'skip';
    } else {
      return;
    }
    const next = applyImport(existing, incoming, { mode, onConflict }, genId);
    Object.assign(this.config.store.mobaxMacros, { list: next.macros });
    Object.assign(this.config.store.mobaxVariables, { list: next.variables });
    this.config.save();
    this.reload();
    this.cdr.detectChanges();
    this.notifications.notice(
      `불러오기 완료: 매크로 ${next.macros.length}개, 변수 ${next.variables.length}개`,
    );
  }

  openVariables(): void {
    this.mode = 'variables';
  }

  closeVariables(): void {
    this.mode = 'list';
  }

  // Valid, de-duplicated variable names available for insertion.
  get variableNames(): string[] {
    return Object.keys(buildVarMap(this.config.store.mobaxVariables?.list ?? []));
  }

  // Render the token label in TS (not the backtick template) to avoid the `${` being
  // parsed as a JS template-literal interpolation. Single-quoted string → literal text.
  chipLabel(name: string): string {
    return '${' + name + '}';
  }

  onCommandFocus(step: MacroStep, ev: FocusEvent): void {
    if (step.type !== 'command') {
      return;
    }
    this.focusedCommand = step;
    this.focusedInput = ev.target as HTMLInputElement;
  }

  // mousedown (not click) so the input keeps focus + selection; preventDefault stops blur.
  insertVariable(name: string, ev: MouseEvent): void {
    ev.preventDefault();
    const step = this.focusedCommand;
    const input = this.focusedInput;
    if (!step || !input) {
      return;
    }
    const token = '${' + name + '}';
    const start = input.selectionStart ?? step.text.length;
    const end = input.selectionEnd ?? start;
    step.text = step.text.slice(0, start) + token + step.text.slice(end);
    const caret = start + token.length;
    // Restore the caret after Angular re-renders the bound value.
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  }

  // Switching type rewrites the step in place so the discriminated union stays valid.
  onStepTypeChange(s: MacroStep): void {
    if (!this.draft) {
      return;
    }
    const i = this.draft.steps.indexOf(s);
    if (i < 0) {
      return;
    }
    if (s.type === 'command') {
      this.draft.steps[i] = {
        id: s.id,
        type: 'command',
        text: '',
        enter: true,
        delayMs: s.delayMs,
      };
    } else {
      this.draft.steps[i] = { id: s.id, type: 'key', key: 'enter', delayMs: s.delayMs };
    }
  }

  onDrop(event: CdkDragDrop<unknown>): void {
    // event indices are within the rendered (possibly filtered) view; map back onto the full list
    // so hidden macros are not dropped when we persist.
    this.macros = applyVisibleReorder(
      this.macros,
      this.visibleMacros,
      event.previousIndex,
      event.currentIndex,
    );
    this.persist();
  }

  onStepDrop(event: CdkDragDrop<unknown>): void {
    if (this.draft) {
      moveItemInArray(this.draft.steps, event.previousIndex, event.currentIndex);
    }
  }

  onContextMenu(event: MouseEvent, m: Macro): void {
    event.preventDefault();
    this.select(m);
    const menu: MenuItemOptions[] = [
      { label: '실행', click: () => this.zone.run(() => this.run(m)) },
      { type: 'separator' },
      { label: '편집', click: () => this.zone.run(() => this.editSelected()) },
      { label: '삭제', click: () => this.zone.run(() => void this.deleteSelected()) },
    ];
    this.platform.popupContextMenu(menu, event);
  }
}
