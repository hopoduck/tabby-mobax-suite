import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  NotificationsService,
  PlatformService,
  MenuItemOptions,
  FileUpload,
  FileDownload,
} from 'tabby-core';
import { SFTPSession, SFTPFile } from 'tabby-ssh';
import { existsSync, lstatSync, mkdirSync, rmSync } from 'fs';
import {
  join as joinLocal,
  basename as baseLocal,
  relative as relLocal,
  sep as sepLocal,
} from 'path';
import {
  sortEntries,
  applyFilter,
  iconFor,
  iconColor,
  modeString,
  classifyClick,
  ClickState,
} from '../logic/fileList';
import { rangeNames, rowsInMarquee, stepName, RowRect, Span } from '../logic/selection';
import { planMoves, DraggedItem } from '../logic/move';
import {
  pathCandidates,
  derivePrefixMapping,
  applyPrefixMapping,
  PrefixMapping,
} from '../logic/resolveSftpPath';
import {
  downloadFile,
  DownloadOutcome,
  joinPath,
  makeDir,
  renameEntry,
  removeEntry,
  moveEntry,
  walkRemoteDir,
} from '../sftpOps';
import { editLocally } from '../sftpLocalEdit';
import { FsFileDownload, FsFileUpload, walkLocalDir } from '../fsTransfer';
import { TransferService } from '../services/transfer.service';
import { wrapUpload, CancelledError } from '../transferWrap';
import {
  memoryAction,
  resolveConflict,
  relativeUnder,
  selectionNeedsDirPicker,
  CONFLICT_BUTTON_CHOICES,
  ConflictMemory,
  ConflictAction,
  planRemoteUpload,
  UploadSource,
} from '../logic/transferPlan';
import { buildDownloadUrl } from '../logic/dragOut';
import { DragOutServer } from '../dragOutServer';

/** True when an SFTP error is a NoSuchFile status (russh stringifies it as both forms). */
function isNoSuchFile(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return msg.includes('nosuchfile') || msg.includes('no such file');
}

/**
 * Local absolute path of a dropped OS file. Isolates the deprecated `File.path` dependency:
 * prefers `webUtils.getPathForFile` (Electron 30+, the supported API), falls back to `File.path`
 * (Electron <= 31; current Tabby = 28). Returns null when neither yields a path. Uses
 * `window.nodeRequire` to reach electron at runtime (webpack does not bundle it).
 */
function resolveDroppedPath(file: File): string | null {
  try {
    const nodeRequire = (window as unknown as { nodeRequire?: (id: string) => unknown }).nodeRequire;
    const electron = nodeRequire?.('electron') as
      | { webUtils?: { getPathForFile?: (f: File) => string } }
      | undefined;
    const p = electron?.webUtils?.getPathForFile?.(file);
    if (p) {
      return p;
    }
  } catch {
    // fall through to File.path
  }
  return (file as File & { path?: string }).path || null;
}

@Component({
  selector: 'sftp-file-list',
  template: `
    <div
      class="mobax-fl"
      [class.drag-over]="dragOver"
      tabindex="0"
      (mousedown)="onBackgroundMouseDown($event)"
      (click)="onBackgroundClick()"
      (keydown)="onListKeydown($event)"
      (contextmenu)="onBackgroundContextMenu($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <div #marquee class="mobax-fl-marquee" [hidden]="!marqueeActive"></div>
      <input
        *ngIf="showFilter"
        class="mobax-fl-filter"
        type="text"
        placeholder="필터…"
        [value]="filter"
        (click)="$event.stopPropagation()"
        (input)="onFilter($event)"
        (keydown)="onFilterKeydown($event)"
      />
      <div *ngIf="error" class="mobax-fl-hint">{{ error }}</div>
      <div
        *ngFor="let item of visibleEntries; trackBy: trackByName"
        class="mobax-fl-row"
        [class.selected]="isSelected(item)"
        [class.cut]="isCut(item)"
        [attr.data-name]="item.name"
        [draggable]="isSelected(item) && item.name !== '..' && renamingName !== item.name"
        [class.drop-target]="dropTargetName === item.name"
        (dragstart)="onRowDragStart($event, item)"
        (dragend)="onRowDragEnd()"
        role="button"
        tabindex="0"
        [title]="modeString(item) + '  ' + item.name"
        (click)="onRowClick($event, item)"
        (contextmenu)="onRowContextMenu($event, item)"
      >
        <i
          class="mobax-fl-icon fa-fw"
          [ngClass]="
            item.name === '..'
              ? 'fas fa-level-up-alt'
              : iconFor(item) + ' ' + iconColor(item)
          "
          aria-hidden="true"
        ></i>
        <ng-container *ngIf="renamingName === item.name; else nameText">
          <input
            class="mobax-fl-rename"
            #renameInput
            [value]="item.name"
            (click)="$event.stopPropagation()"
            (keydown.enter)="$event.stopPropagation(); commitRename(item, renameInput.value)"
            (keydown.escape)="$event.stopPropagation(); cancelRename()"
            (blur)="commitRename(item, renameInput.value)"
          />
        </ng-container>
        <ng-template #nameText>
          <span class="mobax-fl-name">{{ item.name }}</span>
          <span class="mobax-fl-size" *ngIf="!item.isDirectory">{{ humanSize(item.size) }}</span>
        </ng-template>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: auto;
      }
      .mobax-fl {
        position: relative;
        min-height: 100%;
        padding: 4px 6px;
        user-select: none;
      }
      .mobax-fl.drag-over {
        outline: 2px dashed var(--bs-primary, #3b82f6);
        outline-offset: -2px;
        background: color-mix(in srgb, var(--bs-primary, #3b82f6) 6%, transparent);
      }
      .mobax-fl-marquee {
        position: absolute;
        z-index: 5;
        pointer-events: none;
        border: 1px solid var(--bs-primary, #3b82f6);
        background: color-mix(in srgb, var(--bs-primary, #3b82f6) 18%, transparent);
        border-radius: 2px;
      }
      .mobax-fl-filter {
        width: 100%;
        box-sizing: border-box;
        margin-bottom: 4px;
        background: var(--bs-body-bg, #1e1e1e);
        color: inherit;
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 3px;
        padding: 2px 6px;
        font: inherit;
      }
      .mobax-fl-hint {
        padding: 8px;
        opacity: 0.6;
      }
      .mobax-fl-row {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
        outline: none;
      }
      .mobax-fl-row:hover {
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .mobax-fl-row.selected {
        /* Full-row accent fill (no left bar). This is also the keyboard "current row" indicator —
           selection follows arrow nav — so there's no separate :focus-visible style to linger.
           A selected row IS the move-drag handle (unselected rows start a marquee instead), so it
           shows a grab cursor as the affordance. */
        background: color-mix(in srgb, var(--bs-primary, #3b82f6) 26%, transparent);
        cursor: grab;
      }
      .mobax-fl-row.selected:active {
        cursor: grabbing;
      }
      .mobax-fl-row.drop-target {
        background: color-mix(in srgb, var(--bs-primary, #3b82f6) 22%, transparent);
        box-shadow: inset 0 0 0 1px var(--bs-primary, #3b82f6);
      }
      .mobax-fl-row.cut {
        opacity: 0.45;
      }
      .mobax-fl-icon {
        flex: 0 0 auto;
        width: 16px;
        text-align: center;
        opacity: 0.9;
        font-size: 13px;
      }
      /* Category colors — keyed off iconColor(); a generic file has no class and inherits the
         text color. Mid-saturation tones chosen to read on both dark and light Tabby themes. */
      .mobax-fl-icon.mobax-ic-folder {
        color: #e8b923;
      }
      .mobax-fl-icon.mobax-ic-link {
        color: #56b6c2;
      }
      .mobax-fl-icon.mobax-ic-archive {
        color: #b97ce6;
      }
      .mobax-fl-icon.mobax-ic-image {
        color: #6cbf5a;
      }
      .mobax-fl-icon.mobax-ic-pdf {
        color: #e05561;
      }
      .mobax-fl-icon.mobax-ic-code {
        color: #519aff;
      }
      .mobax-fl-icon.mobax-ic-text {
        color: #9aa0a6;
      }
      .mobax-fl-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mobax-fl-size {
        flex: 0 0 auto;
        font-size: 11px;
        opacity: 0.5;
        margin-left: 8px;
      }
      .mobax-fl-rename {
        flex: 1 1 auto;
        min-width: 0;
        background: var(--bs-body-bg, #1e1e1e);
        color: inherit;
        border: 1px solid var(--bs-primary, #3b82f6);
        border-radius: 3px;
        padding: 1px 4px;
        font: inherit;
      }
    `,
  ],
})
export class SftpFileListComponent implements OnChanges {
  @Input() sftp: SFTPSession | null = null;
  @Input() path = '/';
  // True when the current [path] came from automatic shell-cwd following (not an explicit user
  // action). A follow that can't be listed — the shell stepped outside the SFTP chroot, into /proc,
  // a no-permission dir, etc. — must fail silently (keep the old listing, no toast), mirroring the
  // old panel.navigate(fallbackOnError) behaviour. Explicit navigations (typed path, breadcrumb,
  // double-click) keep surfacing read failures so a user typo still gets feedback.
  @Input() silent = false;
  // Carries the resolved target plus the originating silent flag, so a cross-namespace re-navigation
  // (below) preserves whether the whole sequence started from a follow.
  @Output() navigate = new EventEmitter<{ path: string; silent: boolean }>();
  // Notifies the parent toolbar of the current selection so it can enable/disable selection-based
  // actions (download / rename / delete). fileCount = downloadable (non-folder) entries.
  @Output() selectionChange = new EventEmitter<{ count: number; fileCount: number }>();
  @ViewChild('marquee') marqueeEl?: ElementRef<HTMLDivElement>;

  showFilter = false;
  filter = '';
  error = '';
  entries: SFTPFile[] = [];
  marqueeActive = false;
  dropTargetName: string | null = null;
  // True while an OS file drag is hovering the list (drives the drop-zone highlight).
  dragOver = false;
  // Multi-select: a set of selected entry names (the ".." parent is never added). anchorName is the
  // pivot for Shift-range selection.
  selectedNames = new Set<string>();
  anchorName: string | null = null;
  // The keyboard-current row (drives arrow navigation, Enter/F2/Delete, and focus ring).
  focusedName: string | null = null;
  renamingName: string | null = null;

  private clickState: ClickState | null = null;
  // Marquee drag-select state. startX/Y are content coords relative to .mobax-fl. additive=true when
  // Ctrl was held at gesture start (marquee adds to the existing selection instead of replacing).
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeAdditive = false;
  private marqueeBaseline: Set<string> = new Set();
  private marqueeMoved = false;
  // Set when a marquee drag ends; swallows the trailing click so it doesn't override the marquee
  // selection. The click lands on the background or on the row the press started on, so both
  // onBackgroundClick and onRowClick honour it.
  private suppressClick = false;
  private readonly onMarqueeMoveBound = (e: MouseEvent) => this.onMarqueeMove(e);
  private readonly onMarqueeUpBound = (e: MouseEvent) => this.onMarqueeUp(e);
  private static readonly MARQUEE_THRESHOLD = 4;
  // Resolved drag payload (selection at drag start) and the last drop-target name shown highlighted.
  private draggingItems: SFTPFile[] = [];
  // Cut clipboard (move-only — there is no copy). Persists across directory changes so you can cut
  // here, navigate, and paste there. Entries hold absolute fullPaths.
  private clipboard: SFTPFile[] = [];
  // Learned shell->SFTP path rewrite for chrooted servers (e.g. Synology: shell `/volume3/web`
  // is the SFTP channel's `/web`). null until the first cross-namespace resolution; reset whenever
  // [sftp] changes (a different server has a different chroot).
  private namespaceMap: PrefixMapping | null = null;

  // Standing overwrite/skip decision for the current folder batch; reset at each batch start.
  private conflictMemory: ConflictMemory = 'none';
  // Korean labels for the conflict dialog — MUST stay in the same order as CONFLICT_BUTTON_CHOICES.
  private static readonly CONFLICT_BUTTON_LABELS = [
    '이 파일 덮어쓰기',
    '이 파일 건너뛰기',
    '모두 덮어쓰기',
    '모두 건너뛰기',
    '취소',
  ];

  // Template-exposed pure helpers.
  iconFor = iconFor;
  iconColor = iconColor;
  modeString = modeString;

  constructor(
    private platform: PlatformService,
    private notifications: NotificationsService,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>,
    private transfer: TransferService,
    private dragOut: DragOutServer,
  ) {
    // Bind the drag-out HTTP server eagerly: dragstart is synchronous (the browser captures
    // dataTransfer when the handler returns), so register()/urlFor()/setData must run without an
    // await. ensureStarted() is idempotent, so re-creating this component is a no-op.
    void this.dragOut.ensureStarted();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sftp']) {
      this.namespaceMap = null; // new server → forget the old namespace rewrite
    }
    if (changes['sftp'] || changes['path']) {
      void this.reload();
    }
  }

  get visibleEntries(): SFTPFile[] {
    const filtered = applyFilter(this.entries, this.filter);
    // Prepend a ".." shortcut to the parent dir whenever we're below root (MobaXterm-style).
    if (this.path && this.path !== '/') {
      return [this.parentEntry(), ...filtered];
    }
    return filtered;
  }

  // A synthetic ".." entry whose double-click navigates up: fullPath is the parent dir so
  // activate()'s navigate.emit lands there. mode/size are unused (rendered as a plain row).
  private parentEntry(): SFTPFile {
    return {
      name: '..',
      fullPath: this.path.replace(/\/+[^/]*\/*$/, '') || '/',
      isDirectory: true,
      isSymlink: false,
      mode: 0,
      size: 0,
      modified: new Date(0),
    };
  }

  trackByName(_index: number, item: SFTPFile): string {
    return item.name;
  }

  async reload(): Promise<void> {
    if (!this.sftp) {
      this.entries = [];
      this.cdr.detectChanges();
      this.emitSelection();
      return;
    }
    // Chrooted SFTP servers (e.g. Synology: the shell sees /volume3/web, the SFTP channel exposes
    // that same dir as /web) make a shell-namespace path fail to list. If we've already learned the
    // rewrite, apply it up front so the common case resolves in a single readdir. applyPrefixMapping
    // is idempotent, so a path already in the SFTP namespace passes through and never loops.
    if (this.namespaceMap) {
      const mapped = applyPrefixMapping(this.path, this.namespaceMap);
      if (mapped !== this.path) {
        // re-enters reload() via the parent's [path] binding; keep this.silent so a follow stays a follow
        this.navigate.emit({ path: mapped, silent: this.silent });
        return;
      }
    }
    try {
      this.applyListing(await this.sftp.readdir(this.path));
      this.error = '';
    } catch (err) {
      // A NoSuchFile on a directory the user knows exists means the path is in the shell's
      // namespace, not the SFTP server's. Probe progressively shorter trailing sub-paths; on the
      // first that lists, navigate there and remember the prefix rewrite for next time.
      if (isNoSuchFile(err)) {
        const resolved = await this.resolveCrossNamespace(this.path);
        if (resolved && resolved !== this.path) {
          this.navigate.emit({ path: resolved, silent: this.silent });
          return;
        }
      }
      // Keep the previous listing. Surface the failure ONLY for explicit navigations; a failed
      // shell-cwd follow (chroot boundary, /proc, no-permission dir) stays silent — the old
      // panel.navigate(fallbackOnError) behaviour the toast had inadvertently replaced.
      this.error = `읽기 실패: ${String((err as Error)?.message ?? err)}`;
      if (!this.silent) {
        this.notifications.error('SFTP 디렉토리 읽기 실패', this.error);
      }
    }
    this.cdr.detectChanges();
    this.emitSelection();
  }

  // Adopt a fresh directory listing, dropping selections/anchor for entries that vanished (deleted,
  // moved, or path changed).
  private applyListing(list: SFTPFile[]): void {
    this.entries = sortEntries(list);
    const names = new Set(this.entries.map((e) => e.name));
    this.selectedNames.forEach((n) => {
      if (!names.has(n)) {
        this.selectedNames.delete(n);
      }
    });
    if (this.anchorName && !names.has(this.anchorName)) {
      this.anchorName = null;
    }
  }

  // Try progressively shorter trailing sub-paths of a shell-namespace path until one lists over
  // SFTP ("probe-and-verify" — only an actually-listable path is accepted). On success, remember
  // the prefix rewrite so later same-namespace paths skip the probing. Returns null if none list.
  private async resolveCrossNamespace(input: string): Promise<string | null> {
    for (const candidate of pathCandidates(input)) {
      if (await this.canList(candidate)) {
        this.namespaceMap = derivePrefixMapping(input, candidate);
        return candidate;
      }
    }
    return null;
  }

  private async canList(p: string): Promise<boolean> {
    if (!this.sftp) {
      return false;
    }
    try {
      await this.sftp.readdir(p);
      return true;
    } catch {
      return false;
    }
  }

  humanSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
  }

  onFilter(event: Event): void {
    this.filter = (event.target as HTMLInputElement).value;
    this.cdr.detectChanges();
  }

  isSelected(item: SFTPFile): boolean {
    return this.selectedNames.has(item.name);
  }

  // Names eligible for selection (everything visible except the ".." parent shortcut).
  selectableNames(): string[] {
    return this.visibleEntries.map((e) => e.name).filter((n) => n !== '..');
  }

  // Currently-selected real entries (resolves names → SFTPFile, drops ".." and stale names).
  selectedEntries(): SFTPFile[] {
    return this.visibleEntries.filter((e) => e.name !== '..' && this.selectedNames.has(e.name));
  }

  private emitSelection(): void {
    const sel = this.selectedEntries();
    this.selectionChange.emit({
      count: sel.length,
      fileCount: sel.filter((e) => !e.isDirectory).length,
    });
  }

  clearSelection(): void {
    this.selectedNames.clear();
    this.anchorName = null;
    this.focusedName = null;
    this.cdr.detectChanges();
    this.emitSelection();
  }

  // Select every selectable row (Ctrl+A / empty-area menu).
  selectAll(): void {
    const names = this.selectableNames();
    this.selectedNames = new Set(names);
    this.anchorName = names[0] ?? null;
    this.focusedName = names[names.length - 1] ?? null;
    this.cdr.detectChanges();
    this.emitSelection();
  }

  // --- marquee (rectangular drag-select on the list background) ---

  // Start a marquee when the press lands on empty list space OR on an UNSELECTED row (including "..").
  // A press on a SELECTED row is left alone so CDK starts a move-drag instead — selected rows are the
  // drag handles. The filter / inline-rename inputs keep their own behaviour. Left button only.
  onBackgroundMouseDown(event: MouseEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.mobax-fl-filter') || target.closest('.mobax-fl-rename')) {
      return;
    }
    const row = target.closest<HTMLElement>('.mobax-fl-row');
    if (row) {
      const name = row.getAttribute('data-name');
      // Selected rows yield to CDK move-drag; unselected rows (and "..") fall through to begin a
      // marquee from this point.
      if (name && name !== '..' && this.selectedNames.has(name)) {
        return;
      }
    }
    const fl = this.flElement();
    if (!fl) {
      return;
    }
    const rect = fl.getBoundingClientRect();
    this.marqueeStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.marqueeAdditive = event.ctrlKey || event.metaKey;
    this.marqueeBaseline = this.marqueeAdditive ? new Set(this.selectedNames) : new Set();
    this.marqueeMoved = false;
    document.addEventListener('mousemove', this.onMarqueeMoveBound);
    document.addEventListener('mouseup', this.onMarqueeUpBound);
  }

  private onMarqueeMove(event: MouseEvent): void {
    if (!this.marqueeStart) {
      return;
    }
    const fl = this.flElement();
    const box = this.marqueeEl?.nativeElement;
    if (!fl || !box) {
      return;
    }
    const rect = fl.getBoundingClientRect();
    const curX = event.clientX - rect.left;
    const curY = event.clientY - rect.top;
    const dx = Math.abs(curX - this.marqueeStart.x);
    const dy = Math.abs(curY - this.marqueeStart.y);
    if (
      !this.marqueeMoved &&
      dx < SftpFileListComponent.MARQUEE_THRESHOLD &&
      dy < SftpFileListComponent.MARQUEE_THRESHOLD
    ) {
      return; // below threshold — still just a click
    }
    this.marqueeMoved = true;
    this.marqueeActive = true;

    const left = Math.min(this.marqueeStart.x, curX);
    const topPx = Math.min(this.marqueeStart.y, curY);
    const width = Math.abs(curX - this.marqueeStart.x);
    const height = Math.abs(curY - this.marqueeStart.y);
    // Position the box directly (avoids per-move binding churn outside the zone).
    box.style.left = `${left}px`;
    box.style.top = `${topPx}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

    // Convert each selectable row's viewport rect into .mobax-fl content coords for the pure test.
    const span: Span = { top: topPx, bottom: topPx + height };
    const rows: RowRect[] = [];
    fl.querySelectorAll<HTMLElement>('.mobax-fl-row[data-name]').forEach((el) => {
      const name = el.getAttribute('data-name');
      if (!name || name === '..') {
        return;
      }
      const r = el.getBoundingClientRect();
      rows.push({ name, top: r.top - rect.top, bottom: r.bottom - rect.top });
    });
    const hit = new Set(rowsInMarquee(rows, span));
    this.selectedNames = this.marqueeAdditive ? new Set([...this.marqueeBaseline, ...hit]) : hit;
    this.cdr.detectChanges();
  }

  private onMarqueeUp(_event: MouseEvent): void {
    document.removeEventListener('mousemove', this.onMarqueeMoveBound);
    document.removeEventListener('mouseup', this.onMarqueeUpBound);
    const dragged = this.marqueeMoved;
    this.marqueeStart = null;
    this.marqueeActive = false;
    this.marqueeMoved = false;
    if (dragged) {
      // Anchor at the last hit so a following Shift+click/arrow extends from the marquee result.
      const last = [...this.selectedNames].pop() ?? null;
      this.anchorName = last;
      this.focusedName = last;
      // A click event fires after mouseup — don't let it clear/override what we just selected.
      this.suppressClick = true;
    }
    this.cdr.detectChanges();
    this.emitSelection();
  }

  // Empty-area click clears the selection — unless it was the tail of a marquee drag.
  onBackgroundClick(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.clearSelection();
  }

  private flElement(): HTMLElement | null {
    return this.host.nativeElement.querySelector('.mobax-fl');
  }

  // --- Native HTML5 drag (one gesture, two destinations) ---
  // A selected row is draggable. Dropping it on a folder/".." INSIDE the list = internal move;
  // dropping it OUTSIDE the app (e.g. the Windows desktop) = export, via the DownloadURL the OS
  // fetches from our DragOutServer (streamed from SFTP at drop time). Which one happens is decided at
  // drop time, not at drag start. Replaces the former CDK cdkDrag/cdkDropList wiring.

  onRowDragStart(event: DragEvent, item: SFTPFile): void {
    // Lock in the payload: the whole selection if the grabbed row is part of it, else just this row.
    if (!this.selectedNames.has(item.name)) {
      this.selectedNames = new Set([item.name]);
      this.anchorName = item.name;
    }
    this.draggingItems = this.selectedEntries();
    if (!this.draggingItems.length) {
      this.draggingItems = [item];
    }
    const dt = event.dataTransfer;
    if (dt) {
      // Marker so onDragOver/onDrop recognise our internal move (vs an incoming OS file drop).
      dt.setData('application/x-mobax-move', '1');
      dt.effectAllowed = 'copyMove';
      // Export carries exactly one file (DownloadURL is single-file). Only set it for a lone, non-
      // directory file; multi-select / folders still move internally and keep the menu "다운로드".
      const only = this.draggingItems.length === 1 ? this.draggingItems[0] : null;
      if (only && !only.isDirectory && this.sftp && this.dragOut.ready) {
        const token = this.dragOut.register({
          sftp: this.sftp,
          path: only.fullPath,
          filename: only.name,
          size: only.size,
        });
        dt.setData('DownloadURL', buildDownloadUrl(only.name, this.dragOut.urlFor(token)));
      }
    }
    this.cdr.detectChanges();
    this.emitSelection();
  }

  onRowDragEnd(): void {
    this.draggingItems = [];
    this.dropTargetName = null;
    this.dragOver = false;
    this.cdr.detectChanges();
  }

  // Folder/".." under the pointer that is a valid internal-move target (a directory not being dragged).
  private moveTargetFromEvent(event: DragEvent): string | null {
    const name = this.dropTargetFromEvent(event);
    if (!name) {
      return null;
    }
    return this.draggingItems.some((d) => d.name === name) ? null : name;
  }

  // --- Native OS / internal drag-and-drop (upload + internal move) ---
  // onDragOver/onDrop serve two non-OS-file streams: an incoming OS file drop (upload, gated by
  // hasOsFiles) and our own internal move (gated by hasMoveMarker). They are disjoint by dataTransfer
  // type, so neither triggers the other.

  private hasOsFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return !!types && Array.prototype.includes.call(types, 'Files');
  }

  private hasMoveMarker(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return !!types && Array.prototype.includes.call(types, 'application/x-mobax-move');
  }

  // Folder row (or "..") under the pointer, for "drop into this folder"; null → current dir.
  private dropTargetFromEvent(event: DragEvent): string | null {
    const row = (event.target as HTMLElement | null)?.closest?.('.mobax-fl-row');
    const name = row?.getAttribute('data-name') ?? null;
    const target = name ? this.visibleEntries.find((e) => e.name === name) : undefined;
    return target && target.isDirectory ? target.name : null;
  }

  onDragOver(event: DragEvent): void {
    if (this.hasOsFiles(event)) {
      event.preventDefault(); // required to allow the drop
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      const next = this.dropTargetFromEvent(event);
      if (!this.dragOver || next !== this.dropTargetName) {
        this.dragOver = true;
        this.dropTargetName = next;
        this.cdr.detectChanges();
      }
      return;
    }
    if (this.hasMoveMarker(event)) {
      // Internal move: allow a drop only over a valid folder target; highlight just that row (no
      // whole-list drag-over outline, which is reserved for incoming OS uploads).
      const next = this.moveTargetFromEvent(event);
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = next ? 'move' : 'none';
      }
      if (next !== this.dropTargetName) {
        this.dropTargetName = next;
        this.cdr.detectChanges();
      }
    }
  }

  onDragLeave(event: DragEvent): void {
    if (!this.dragOver) {
      return;
    }
    const to = event.relatedTarget as Node | null;
    if (to && (event.currentTarget as HTMLElement).contains(to)) {
      return; // moved to a child row, still inside the list
    }
    this.dragOver = false;
    this.dropTargetName = null;
    this.cdr.detectChanges();
  }

  async onDrop(event: DragEvent): Promise<void> {
    // Internal move (a row dropped onto a folder/".." inside the list).
    if (this.hasMoveMarker(event) && !this.hasOsFiles(event)) {
      event.preventDefault();
      const moveTarget = this.dropTargetName;
      const items = this.draggingItems;
      this.draggingItems = [];
      this.dropTargetName = null;
      this.dragOver = false;
      this.cdr.detectChanges();
      if (!moveTarget || !items.length) {
        return; // dropped on empty space / a non-folder → no-op (export, if any, was handled by the OS)
      }
      const dest = this.visibleEntries.find((e) => e.name === moveTarget);
      if (dest && dest.isDirectory) {
        await this.performMove(items, dest.fullPath);
      }
      return;
    }
    if (!this.hasOsFiles(event)) {
      return;
    }
    event.preventDefault(); // stop the browser from opening the dropped file
    const targetName = this.dropTargetName;
    this.dragOver = false;
    this.dropTargetName = null;
    this.cdr.detectChanges();

    const files = event.dataTransfer?.files;
    if (!files || !files.length) {
      return;
    }
    let destDir = this.path;
    if (targetName) {
      const t = this.visibleEntries.find((e) => e.name === targetName);
      if (t && t.isDirectory) {
        destDir = t.fullPath;
      }
    }
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = resolveDroppedPath(files[i]);
      if (p) {
        paths.push(p);
      }
    }
    if (!paths.length) {
      this.notifications.notice('업로드할 파일을 찾지 못했습니다');
      return;
    }
    await this.uploadLocalPaths(paths, destDir);
  }

  // Read the target dir, plan the moves (skips collisions/self/same-dir), rename each, then reload.
  private async performMove(items: SFTPFile[], targetDir: string): Promise<void> {
    if (!this.sftp || !items.length) {
      return;
    }
    let existing: Set<string>;
    try {
      const list = await this.sftp.readdir(targetDir);
      existing = new Set(list.map((e) => e.name));
    } catch (err) {
      this.notifications.error('SFTP 이동 실패', String((err as Error)?.message ?? err));
      return;
    }
    const dragged: DraggedItem[] = items.map((it) => ({
      name: it.name,
      fullPath: it.fullPath,
      isDirectory: it.isDirectory,
    }));
    const plan = planMoves(dragged, targetDir, existing);
    let moved = 0;
    const failed: string[] = [];
    for (const m of plan.moves) {
      try {
        await moveEntry(this.sftp, m.from, m.to);
        moved++;
      } catch {
        failed.push(m.to.slice(m.to.lastIndexOf('/') + 1));
      }
    }
    await this.reload();
    this.clearSelection();
    this.reportMove(moved, plan.skipped.length, failed);
  }

  // One summary toast: how many moved, how many skipped (collision/self/same-dir), how many errored.
  private reportMove(moved: number, skipped: number, failed: string[]): void {
    if (failed.length) {
      this.notifications.error(
        'SFTP 이동 실패',
        `${failed.length}개 이동 실패: ${failed.join(', ')}`,
      );
    }
    const parts: string[] = [];
    if (moved) {
      parts.push(`${moved}개 이동`);
    }
    if (skipped) {
      parts.push(`${skipped}개 건너뜀`);
    }
    if (parts.length) {
      // This tabby-core exposes notice(message) + error(title, body) — there is no info(); the repo
      // already uses notice() (see sftpLocalEdit.ts / macroRunner.service.ts).
      this.notifications.notice(`SFTP 이동: ${parts.join(', ')}`);
    }
  }

  // --- click handling (MobaXterm: single=select, double=enter folder / editLocally file) ---

  onRowClick(event: MouseEvent, item: SFTPFile): void {
    event.stopPropagation();
    // A marquee that began on this (unselected) row ends with a trailing click here — swallow it so
    // it doesn't collapse the marquee selection down to this single row.
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const modified = event.shiftKey || event.ctrlKey || event.metaKey;

    // The ".." shortcut is never selectable; only its double-click (navigate up) matters.
    if (item.name === '..') {
      this.focusedName = item.name;
      const rr = classifyClick(this.clickState, item.name, event.timeStamp);
      this.clickState = rr.state;
      if (rr.type === 'double') {
        this.activate(item);
      }
      return;
    }

    if (event.shiftKey) {
      // Range from the anchor to this row, in visible order.
      this.selectedNames = new Set(rangeNames(this.selectableNames(), this.anchorName, item.name));
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle this row; it becomes the new anchor.
      if (this.selectedNames.has(item.name)) {
        this.selectedNames.delete(item.name);
      } else {
        this.selectedNames.add(item.name);
      }
      this.anchorName = item.name;
    } else {
      // Plain click: select only this row.
      this.selectedNames = new Set([item.name]);
      this.anchorName = item.name;
    }

    this.focusedName = item.name;
    const r = classifyClick(this.clickState, item.name, event.timeStamp);
    this.clickState = r.state;
    // Host view is attached to ApplicationRef outside app-root's zone — render the selection now.
    this.cdr.detectChanges();
    this.emitSelection();
    // A double-click activates only as a plain gesture (Ctrl/Shift double-clicks just (de)select).
    if (r.type === 'double' && !modified) {
      this.activate(item);
    }
  }

  private activate(item: SFTPFile): void {
    if (item.isDirectory) {
      this.navigate.emit({ path: item.fullPath, silent: false }); // explicit double-click open
    } else if (this.sftp) {
      void editLocally(item, this.sftp, this.platform, this.notifications, this.transfer);
    }
  }

  // Centralized keyboard handling for the list (events bubble here from focused rows or the
  // container itself). Inputs (filter / inline rename) are skipped so they keep their own keys.
  onListKeydown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement).tagName === 'INPUT' || this.renamingName) {
      return;
    }
    const names = this.selectableNames();
    const key = event.key;

    // --- navigation (Arrow/Page/Home/End): moves focusedName + selection ---
    let dest: string | null | undefined;
    if (key === 'ArrowDown') {
      dest = stepName(names, this.focusedName, 1);
    } else if (key === 'ArrowUp') {
      dest = stepName(names, this.focusedName, -1);
    } else if (key === 'PageDown') {
      dest = stepName(names, this.focusedName, this.pageSize());
    } else if (key === 'PageUp') {
      dest = stepName(names, this.focusedName, -this.pageSize());
    } else if (key === 'Home') {
      dest = names[0] ?? null;
    } else if (key === 'End') {
      dest = names[names.length - 1] ?? null;
    }
    if (dest !== undefined) {
      event.preventDefault();
      if (dest === null) {
        return;
      }
      if (event.shiftKey) {
        const anchor = this.anchorName ?? this.focusedName ?? dest;
        this.anchorName = anchor;
        this.selectedNames = new Set(rangeNames(names, anchor, dest));
      } else {
        this.selectedNames = new Set([dest]);
        this.anchorName = dest;
      }
      this.focusedName = dest;
      this.focusRow(dest);
      this.emitSelection();
      return;
    }

    // --- selection / dir actions ---
    if ((event.ctrlKey || event.metaKey) && (key === 'a' || key === 'A')) {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'f' || key === 'F')) {
      event.preventDefault();
      this.openFilter();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'x' || key === 'X')) {
      event.preventDefault();
      this.cut();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'v' || key === 'V')) {
      event.preventDefault();
      void this.paste();
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      this.clipboard = [];
      this.clearSelection();
      return;
    }
    if (key === 'F5') {
      event.preventDefault();
      void this.reload();
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      this.goUp();
      return;
    }

    // --- keys that act on the focused row ---
    const focused = this.focusedName
      ? this.visibleEntries.find((e) => e.name === this.focusedName)
      : undefined;
    if (key === 'Enter' && focused) {
      event.preventDefault();
      this.activate(focused);
    } else if (key === 'F2' && focused && focused.name !== '..') {
      event.preventDefault();
      this.startRename(focused);
    } else if (key === 'Delete') {
      event.preventDefault();
      // If the focused row isn't part of the current selection, act on just it.
      if (this.focusedName && this.focusedName !== '..' && !this.selectedNames.has(this.focusedName)) {
        this.selectedNames = new Set([this.focusedName]);
        this.anchorName = this.focusedName;
      }
      void this.confirmDeleteSelected();
    }
  }

  // --- cut / paste (move-only) ---

  isCut(item: SFTPFile): boolean {
    return this.clipboard.some((c) => c.fullPath === item.fullPath);
  }

  // Ctrl+X: stage the current selection for a move. Dimmed via the .cut class until pasted.
  private cut(): void {
    const targets = this.selectedEntries();
    if (!targets.length) {
      return;
    }
    this.clipboard = targets;
    this.cdr.detectChanges();
  }

  // Ctrl+V: move the staged entries into the current directory (reuses the drag-move pipeline:
  // skips same-dir/self/collision, reloads, summary toast). Clears the clipboard afterward.
  private async paste(): Promise<void> {
    if (!this.clipboard.length) {
      return;
    }
    const items = this.clipboard;
    this.clipboard = [];
    await this.performMove(items, this.path);
  }

  // Navigate up one level (Backspace), mirroring the ".." shortcut.
  private goUp(): void {
    if (this.path && this.path !== '/') {
      this.navigate.emit({ path: this.parentEntry().fullPath, silent: false }); // explicit Backspace-up
    }
  }

  // Rows that fit one screenful, for PageUp/PageDown stepping.
  private pageSize(): number {
    const fl = this.flElement();
    const row = fl?.querySelector('.mobax-fl-row') as HTMLElement | null;
    const rowH = row?.offsetHeight || 26;
    const viewH = this.host.nativeElement.clientHeight || 300;
    return Math.max(1, Math.floor(viewH / rowH) - 1);
  }

  // Move DOM focus to a row (keeps the focus ring on it and keeps keydown flowing) + reveal it.
  private focusRow(name: string): void {
    this.cdr.detectChanges();
    this.host.nativeElement.querySelectorAll('.mobax-fl-row[data-name]').forEach((el) => {
      if (el.getAttribute('data-name') === name) {
        (el as HTMLElement).focus();
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  // --- context menu ---

  onRowContextMenu(event: MouseEvent, item: SFTPFile): void {
    event.preventDefault();
    if (item.name === '..') {
      return; // the parent shortcut has no file operations
    }
    // Right-clicking a row outside the current selection narrows the selection to it; right-clicking
    // inside a multi-selection keeps it (so "삭제" can act on all selected rows).
    if (!this.selectedNames.has(item.name)) {
      this.selectedNames = new Set([item.name]);
      this.anchorName = item.name;
    }
    this.cdr.detectChanges();
    this.platform.popupContextMenu(this.buildMenu(item), event);
  }

  // Right-click on empty list space → directory-level menu (create / paste / select-all / refresh).
  onBackgroundContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('.mobax-fl-row')) {
      return; // a row was right-clicked → onRowContextMenu handles it
    }
    event.preventDefault();
    const items: MenuItemOptions[] = [
      { label: '새 폴더', click: () => void this.createDirectory() },
      { label: '업로드', click: () => void this.uploadHere() },
      { label: '폴더 업로드', click: () => void this.uploadFolderHere() },
      { type: 'separator' },
      { label: '붙여넣기', enabled: this.clipboard.length > 0, click: () => void this.paste() },
      { type: 'separator' },
      {
        label: '전체 선택',
        enabled: this.selectableNames().length > 0,
        click: () => this.selectAll(),
      },
      { label: '새로고침', click: () => void this.reload() },
    ];
    this.platform.popupContextMenu(items, event);
  }

  private buildMenu(item: SFTPFile): MenuItemOptions[] {
    const selected = this.selectedEntries();
    const items: MenuItemOptions[] = [];

    // Multi-selection: only the actions that make sense for many entries at once.
    if (selected.length > 1) {
      items.push({
        label: '다운로드',
        enabled: selected.length > 0,
        click: () => void this.downloadSelected(),
      });
      items.push({ type: 'separator' });
      items.push({ label: '잘라내기', click: () => this.cut() });
      items.push({ type: 'separator' });
      items.push({ label: '삭제', click: () => void this.confirmDeleteSelected() });
      return items;
    }

    // Single entry: open first (primary), delete last (destructive). Folders are downloadable too
    // (recursive) — doDownload dispatches to the folder path for them.
    items.push({ label: '열기', click: () => this.activate(item) });
    items.push({ label: '다운로드', click: () => void this.doDownload(item) });
    items.push({ type: 'separator' });
    items.push({ label: '잘라내기', click: () => this.cut() });
    items.push({ label: '이름 변경', click: () => this.startRename(item) });
    items.push({
      label: '경로 복사',
      click: () => this.platform.setClipboard({ text: item.fullPath }),
    });
    items.push({ type: 'separator' });
    items.push({ label: '삭제', click: () => void this.confirmDeleteSelected() });
    return items;
  }

  private async doDownload(item: SFTPFile): Promise<void> {
    await this.downloadEntries([item]);
  }

  // --- rename (inline input, mirrors sessionsTab) ---

  startRename(item: SFTPFile): void {
    this.renamingName = item.name;
    // Rename is single-target: narrow the selection to just this row.
    this.selectedNames = new Set([item.name]);
    this.anchorName = item.name;
    this.cdr.detectChanges();
    this.emitSelection();
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.mobax-fl-rename',
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  cancelRename(): void {
    this.renamingName = null;
    this.cdr.detectChanges();
  }

  async commitRename(item: SFTPFile, rawValue: string): Promise<void> {
    if (this.renamingName !== item.name) {
      return;
    }
    this.renamingName = null;
    const name = rawValue.trim();
    if (!name || name === item.name || !this.sftp) {
      this.cdr.detectChanges();
      return;
    }
    await this.runOp(() => renameEntry(this.sftp!, this.path, item.name, name));
  }

  // Delete every selected entry after one confirm. Used by both the Delete key and the menu.
  private async confirmDeleteSelected(): Promise<void> {
    const targets = this.selectedEntries();
    if (!targets.length || !this.sftp) {
      return;
    }
    const message =
      targets.length === 1
        ? `'${targets[0].name}'을(를) 삭제할까요?`
        : `선택한 ${targets.length}개 항목을 삭제할까요?`;
    const result = await this.platform.showMessageBox({
      type: 'warning',
      message,
      buttons: ['삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0 || !this.sftp) {
      return;
    }
    await this.runOp(async () => {
      for (const t of targets) {
        await removeEntry(this.sftp!, t);
      }
    });
    this.clearSelection();
  }

  // Run a mutating op, reload the listing on success, toast on failure.
  private async runOp(op: () => Promise<void>): Promise<void> {
    try {
      await op();
      await this.reload();
    } catch (err) {
      this.notifications.error('SFTP 작업 실패', String((err as Error)?.message ?? err));
    }
  }

  // --- toolbar selection actions (called by the parent sftpTab) ---

  // Download the current selection. A selection containing any folder is a recursive download into
  // one chosen destination dir; a files-only selection keeps the per-file Save-As dialog.
  async downloadSelected(): Promise<void> {
    await this.downloadEntries(this.selectedEntries());
  }

  // Entry point for "다운로드" actions: branch between the recursive folder path (needs one chosen
  // destination dir) and the existing files-only per-file Save-As path.
  private async downloadEntries(entries: SFTPFile[]): Promise<void> {
    if (selectionNeedsDirPicker(entries)) {
      await this.runFolderDownload(entries);
    } else {
      await this.runDownloadBatch(entries.filter((e) => !e.isDirectory));
    }
  }

  // Run a set of downloads as one progress batch (a single file is a batch of 1). Sets the current
  // file + size per item, lets the wrapped transfer report bytes and honour cancel, and summarises.
  private async runDownloadBatch(files: SFTPFile[]): Promise<void> {
    const sftp = this.sftp;
    if (!sftp || !files.length) {
      return;
    }
    if (this.transfer.state.active) {
      this.notifications.notice('이미 전송이 진행 중입니다');
      return;
    }
    this.transfer.start('download', files.length);
    let done = 0;
    let cancelled = false;
    const failed: string[] = [];
    try {
      for (const file of files) {
        this.transfer.setCurrent(file.name, file.size);
        let outcome: DownloadOutcome;
        try {
          outcome = await downloadFile(this.platform, sftp, file, this.transfer);
        } catch {
          failed.push(file.name);
          continue;
        }
        if (outcome === 'done') {
          this.transfer.completeFile();
          done++;
        } else if (outcome === 'cancelled') {
          cancelled = true;
          break;
        }
        // 'skipped' (save dialog dismissed): just move to the next file.
      }
    } finally {
      this.transfer.finish();
    }
    this.reportDownload(done, failed, cancelled);
  }

  private reportDownload(done: number, failed: string[], cancelled: boolean): void {
    if (failed.length) {
      this.notifications.error('다운로드 실패', `${failed.length}개 실패: ${failed.join(', ')}`);
    }
    if (cancelled) {
      this.notifications.notice(`다운로드 취소됨 (${done}개 완료)`);
    } else if (done) {
      this.notifications.notice(`다운로드 ${done}개 완료`);
    }
  }

  // Resolve one name collision: consult standing memory first, else ask with the 5-button dialog and
  // remember any "모두…" choice for the rest of the batch.
  private async resolveConflictFor(name: string): Promise<ConflictAction> {
    const auto = memoryAction(this.conflictMemory);
    if (auto) {
      return auto;
    }
    const r = await this.platform.showMessageBox({
      type: 'warning',
      message: `이미 존재합니다: ${name}`,
      detail: '대상 위치에 같은 이름의 파일이 있습니다.',
      buttons: [...SftpFileListComponent.CONFLICT_BUTTON_LABELS],
      defaultId: 0,
      cancelId: 4,
    });
    const { action, memory } = resolveConflict(CONFLICT_BUTTON_CHOICES[r.response] ?? 'cancel');
    this.conflictMemory = memory;
    return action;
  }

  // Summary toast for a folder batch: failures (error), then a single notice with the done count and
  // trailing notes for files the user skipped on conflict and symlinks excluded from the walk.
  private reportFolderTransfer(
    verb: string,
    done: number,
    failed: string[],
    cancelled: boolean,
    excluded: number,
    skipped: number,
  ): void {
    if (failed.length) {
      this.notifications.error(`${verb} 실패`, `${failed.length}개 실패: ${failed.join(', ')}`);
    }
    const notes: string[] = [];
    if (skipped > 0) {
      notes.push(`${skipped}개 건너뜀`);
    }
    if (excluded > 0) {
      notes.push(`심볼릭 링크 ${excluded}개 제외`);
    }
    const tail = notes.length ? ` (${notes.join(', ')})` : '';
    if (cancelled) {
      this.notifications.notice(`${verb} 취소됨 (${done}개 완료)${tail}`);
    } else if (done || skipped || excluded) {
      this.notifications.notice(`${verb} ${done}개 완료${tail}`);
    }
  }

  // Recursively download a selection (folders + any loose files) into one chosen local directory. The
  // remote subtree is mirrored under `dest` (each entry placed at its path relative to the listing
  // dir). Reuses the bottom progress strip / N·M / cancel; per-file conflicts use the 5-button dialog.
  private async runFolderDownload(entries: SFTPFile[]): Promise<void> {
    const sftp = this.sftp;
    if (!sftp || !entries.length) {
      return;
    }
    if (this.transfer.state.active) {
      this.notifications.notice('이미 전송이 진행 중입니다');
      return;
    }
    const dest = await this.platform.pickDirectory();
    if (!dest) {
      return; // picker dismissed
    }

    // Phase 1 — enumerate the remote tree (skip symlinks).
    this.notifications.notice('폴더 목록 확인 중…');
    const allDirs: SFTPFile[] = [];
    const allFiles: SFTPFile[] = [];
    let excluded = 0;
    try {
      for (const e of entries) {
        if (e.isSymlink) {
          excluded++;
        } else if (e.isDirectory) {
          const w = await walkRemoteDir(sftp, e);
          allDirs.push(...w.dirs);
          allFiles.push(...w.files);
          excluded += w.skippedSymlinks;
        } else {
          allFiles.push(e);
        }
      }
    } catch (err) {
      this.notifications.error('폴더 목록 확인 실패', String((err as Error)?.message ?? err));
      return;
    }

    // Phase 2 — recreate the directory tree locally (mkdir -p; order-independent).
    try {
      for (const d of allDirs) {
        mkdirSync(joinLocal(dest, ...relativeUnder(this.path, d.fullPath).split('/')), {
          recursive: true,
        });
      }
    } catch (err) {
      this.notifications.error('로컬 폴더 생성 실패', String((err as Error)?.message ?? err));
      return;
    }

    // Phase 3 — download files through the progress strip.
    this.conflictMemory = 'none';
    this.transfer.start('download', allFiles.length);
    let done = 0;
    let skipped = 0;
    let cancelled = false;
    const failed: string[] = [];
    try {
      for (const file of allFiles) {
        const localPath = joinLocal(dest, ...relativeUnder(this.path, file.fullPath).split('/'));
        if (existsSync(localPath)) {
          const action = await this.resolveConflictFor(file.name);
          if (action === 'cancel') {
            cancelled = true;
            break;
          }
          if (action === 'skip') {
            // Advance the N/M counter for skipped files so the strip keeps moving to the total.
            this.transfer.setCurrent(file.name, file.size);
            this.transfer.completeFile();
            skipped++;
            continue;
          }
        }
        this.transfer.setCurrent(file.name, file.size);
        const dl = new FsFileDownload(file.name, file.mode, file.size, localPath, this.transfer);
        try {
          await sftp.download(file.fullPath, dl as unknown as FileDownload);
          await dl.whenClosed();
        } catch (err) {
          rmSync(localPath, { force: true }); // drop the partial local file
          if (err instanceof CancelledError) {
            cancelled = true;
            break;
          }
          failed.push(file.name);
          continue;
        }
        this.transfer.completeFile();
        done++;
      }
    } finally {
      this.transfer.finish();
    }
    this.reportFolderTransfer('다운로드', done, failed, cancelled, excluded, skipped);
  }

  // POSIX remote-relative path of a local absolute path under `src` (converts OS separators to '/').
  private toRemoteRel(src: string, full: string): string {
    return relLocal(src, full).split(sepLocal).join('/');
  }

  // Pick a local directory and upload it (recursively) into the current remote dir as a sub-folder
  // named after the local dir. Recreates the tree with sftp.mkdir, then uploads each file through the
  // progress strip (per-file conflict dialog, cancel). Permissions follow the server umask — no chmod
  // (matches single-file upload; avoids applying Windows synthetic modes to the remote).
  async uploadFolderHere(): Promise<void> {
    if (!this.sftp) {
      return;
    }
    const src = await this.platform.pickDirectory();
    if (!src) {
      return; // picker dismissed
    }
    await this.uploadLocalPaths([src], this.path);
  }

  // Enumerate dropped/picked local paths into UploadSource[] for the pure planner. Directories are
  // walked recursively (nested symlinks skipped + counted); top-level symlinks are skipped + counted;
  // unreadable entries are silently dropped. POSIX-relative paths come from toRemoteRel.
  private buildUploadSources(srcPaths: string[]): { sources: UploadSource[]; excluded: number } {
    const sources: UploadSource[] = [];
    let excluded = 0;
    for (const src of srcPaths) {
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(src);
      } catch {
        continue; // unreadable / vanished
      }
      if (st.isSymbolicLink()) {
        excluded++;
        continue;
      }
      if (st.isDirectory()) {
        const walk = walkLocalDir(src);
        excluded += walk.skippedSymlinks;
        sources.push({
          baseName: baseLocal(src),
          isDirectory: true,
          dirRels: walk.dirs.map((d) => this.toRemoteRel(src, d)),
          files: walk.files.map((f) => ({
            rel: this.toRemoteRel(src, f.path),
            localPath: f.path,
            size: f.size,
          })),
        });
      } else if (st.isFile()) {
        sources.push({
          baseName: baseLocal(src),
          isDirectory: false,
          dirRels: [],
          files: [{ rel: '', localPath: src, size: st.size }],
        });
      }
    }
    return { sources, excluded };
  }

  // Shared upload core: enumerate local sources, recreate the remote dir tree (parents first), then
  // upload each file through the progress strip with per-file conflict resolution. Permissions follow
  // the server umask (0o644, no chmod) — matches single/folder upload.
  private async uploadLocalPaths(srcPaths: string[], destDir: string): Promise<void> {
    const sftp = this.sftp;
    if (!sftp || !srcPaths.length) {
      return;
    }
    if (this.transfer.state.active) {
      this.notifications.notice('이미 전송이 진행 중입니다');
      return;
    }

    // Phase 1 — enumerate the local tree(s) and plan remote paths.
    this.notifications.notice('폴더 목록 확인 중…');
    let built: { sources: UploadSource[]; excluded: number };
    try {
      built = this.buildUploadSources(srcPaths);
    } catch (err) {
      this.notifications.error('폴더 읽기 실패', String((err as Error)?.message ?? err));
      return;
    }
    const plan = planRemoteUpload(built.sources, destDir);
    if (!plan.dirs.length && !plan.files.length) {
      return; // nothing uploadable
    }

    // Phase 2 — recreate the remote directory tree (parents first; mkdir is non-recursive). Ignore
    // "already exists" so uploading into an existing folder merges; real failures surface per-file.
    for (const d of plan.dirs) {
      try {
        await sftp.mkdir(d);
      } catch {
        // exists / race — the file uploads below will report any genuine problem.
      }
    }

    // Phase 3 — upload files through the progress strip.
    this.conflictMemory = 'none';
    this.transfer.start('upload', plan.files.length);
    let done = 0;
    let skipped = 0;
    let cancelled = false;
    const failed: string[] = [];
    try {
      for (const f of plan.files) {
        // Conflict: does the remote file already exist?
        let exists = false;
        try {
          await sftp.stat(f.remotePath);
          exists = true;
        } catch {
          exists = false;
        }
        if (exists) {
          const action = await this.resolveConflictFor(f.name);
          if (action === 'cancel') {
            cancelled = true;
            break;
          }
          if (action === 'skip') {
            // Advance the N/M counter for skipped files so the strip keeps moving to the total.
            this.transfer.setCurrent(f.name, f.size);
            this.transfer.completeFile();
            skipped++;
            continue;
          }
        }

        this.transfer.setCurrent(f.name, f.size);
        const up = new FsFileUpload(f.name, 0o644, f.localPath);
        const wrapped = wrapUpload(up as unknown as FileUpload, this.transfer);
        try {
          await sftp.upload(f.remotePath, wrapped);
        } catch (err) {
          if (err instanceof CancelledError) {
            cancelled = true;
            break;
          }
          failed.push(f.name);
          continue;
        }
        this.transfer.completeFile();
        done++;
      }
    } finally {
      this.transfer.finish();
      await this.reload();
    }
    this.reportFolderTransfer('업로드', done, failed, cancelled, built.excluded, skipped);
  }

  // Rename the selection when exactly one entry is selected (rename is single-target).
  renameSelected(): void {
    const sel = this.selectedEntries();
    if (sel.length === 1) {
      this.startRename(sel[0]);
    }
  }

  // Delete the current selection (shared confirm flow with the Delete key / context menu).
  deleteSelected(): void {
    void this.confirmDeleteSelected();
  }

  // Open the filter input and focus it (Ctrl+F).
  openFilter(): void {
    this.showFilter = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.mobax-fl-filter',
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  // Close the filter input, clearing any active query (Esc), and return focus to the list.
  closeFilter(): void {
    this.showFilter = false;
    this.filter = '';
    this.cdr.detectChanges();
    this.flElement()?.focus();
  }

  // Esc closes the filter (clearing the query); other keys keep the input's native behaviour.
  onFilterKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeFilter();
    }
  }

  // --- toolbar-driven actions (called by the parent sftpTab) ---

  async uploadHere(): Promise<void> {
    if (!this.sftp) {
      return;
    }
    const transfers = await this.platform.startUpload({ multiple: true });
    await this.runUploadBatch(transfers);
  }

  // Upload picked local files into the current directory as one progress batch: per-file/byte
  // progress, cancel support, then reload. On cancel the SFTP layer removes its .tabby-upload temp
  // and the original is untouched.
  private async runUploadBatch(transfers: FileUpload[]): Promise<void> {
    const sftp = this.sftp;
    if (!sftp || !transfers.length) {
      return;
    }
    if (this.transfer.state.active) {
      this.notifications.notice('이미 전송이 진행 중입니다');
      return;
    }
    this.transfer.start('upload', transfers.length);
    let done = 0;
    let cancelled = false;
    const failed: string[] = [];
    try {
      for (const t of transfers) {
        this.transfer.setCurrent(t.getName(), t.getSize());
        const wrapped = wrapUpload(t, this.transfer);
        try {
          await sftp.upload(joinPath(this.path, t.getName()), wrapped);
        } catch (err) {
          if (err instanceof CancelledError) {
            cancelled = true;
            break;
          }
          failed.push(t.getName());
          continue;
        }
        this.transfer.completeFile();
        done++;
      }
    } finally {
      this.transfer.finish();
      await this.reload();
    }
    this.reportUpload(done, failed, cancelled);
  }

  private reportUpload(done: number, failed: string[], cancelled: boolean): void {
    if (failed.length) {
      this.notifications.error('업로드 실패', `${failed.length}개 실패: ${failed.join(', ')}`);
    }
    if (cancelled) {
      this.notifications.notice(`업로드 취소됨 (${done}개 완료)`);
    } else if (done) {
      this.notifications.notice(`업로드 ${done}개 완료`);
    }
  }

  async createDirectory(): Promise<void> {
    await this.createThenRename('새 폴더', (n) => makeDir(this.sftp!, this.path, n));
  }

  // Create with a default name, reload, then drop the new row straight into inline rename — same
  // UX as sessionsTab.createGroup. Avoids a non-working window.prompt under Electron.
  private async createThenRename(
    defaultName: string,
    make: (name: string) => Promise<void>,
  ): Promise<void> {
    if (!this.sftp) {
      return;
    }
    const name = this.uniqueName(defaultName);
    try {
      await make(name);
      await this.reload();
    } catch (err) {
      this.notifications.error('SFTP 작업 실패', String((err as Error)?.message ?? err));
      return;
    }
    const created = this.entries.find((e) => e.name === name);
    if (created) {
      this.startRename(created);
    }
  }

  // Avoid colliding with an existing entry: append " (n)" until free.
  private uniqueName(base: string): string {
    if (!this.entries.some((e) => e.name === base)) {
      return base;
    }
    let i = 2;
    while (this.entries.some((e) => e.name === `${base} (${i})`)) {
      i++;
    }
    return `${base} (${i})`;
  }
}
