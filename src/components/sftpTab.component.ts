import {
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { takeUntil, auditTime } from 'rxjs/operators';
import { AppService, PlatformService, MenuItemOptions } from 'tabby-core';
import { SFTPSession } from 'tabby-ssh';
import {
  focusedLeaf,
  resolveSSHBinding,
  tmuxTopmostTab,
  sidebarTabContext,
  SSHLeafLike,
} from '../logic/activeSession';
import { nextSftpPath } from '../logic/follow';
import { SftpProcFollower, SftpLike, ShellLike } from '../sftpProcFollower';
import { SftpFileListComponent } from './sftpFileList.component';
import { SidebarService } from '../services/sidebar.service';
import { TransferService } from '../services/transfer.service';
import { TransferProgressState, idleState, progressFraction } from '../logic/transferProgress';

interface OscShellSession {
  open?: boolean;
  reportedCWD?: string;
  oscProcessor?: { cwdReported$: Observable<string> };
  getWorkingDirectory?: () => Promise<string | null>;
  output$?: Observable<string>;
}

interface Crumb {
  name: string;
  path: string;
}

@Component({
  selector: 'sftp-tab',
  template: `
    <div class="mobax-sftp">
      <!-- Row 1: breadcrumb path. Always rendered so the opaque header bar keeps its height and
           stays aligned with Tabby's tab strip even with no SSH session — with a session it's the
           editable breadcrumb; without one it shows a static "SFTP" label. -->
      <div class="mobax-sftp-path" [class.is-empty]="!hasSSH" (click)="startEdit()">
        <ng-container *ngIf="hasSSH; else emptyHeader">
          <ng-container *ngIf="!editing">
            <a class="mobax-crumb" (click)="navigate('/'); $event.stopPropagation()">SFTP</a>
            <ng-container *ngFor="let seg of segments">
              <span class="mobax-crumb-sep">/</span>
              <a class="mobax-crumb" (click)="navigate(seg.path); $event.stopPropagation()">{{
                seg.name
              }}</a>
            </ng-container>
          </ng-container>
          <input
            *ngIf="editing"
            #pathInput
            class="mobax-path-input"
            type="text"
            [value]="editValue"
            (click)="$event.stopPropagation()"
            (keydown.enter)="commitEdit(pathInput.value)"
            (keydown.escape)="cancelEdit()"
            (blur)="cancelEdit()"
          />
        </ng-container>
        <ng-template #emptyHeader>
          <span class="mobax-crumb-static">SFTP</span>
        </ng-template>
      </div>

      <!-- Row 2: toolbar — only meaningful with a live session, so hidden when none. -->
      <div class="mobax-sftp-tools" *ngIf="hasSSH">
        <button class="mobax-tool" (click)="goUp()" title="위로">
          <i class="fas fa-level-up-alt"></i>
        </button>
        <button class="mobax-tool" (click)="refresh()" title="새로고침">
          <i class="fas fa-sync-alt"></i>
        </button>
        <span class="mobax-tool-sep" aria-hidden="true"></span>
        <button class="mobax-tool" (click)="newDirectory()" title="새 폴더">
          <i class="fas fa-folder-plus"></i>
        </button>
        <button class="mobax-tool" (click)="upload()" title="파일 업로드">
          <i class="fas fa-upload"></i>
        </button>
        <button
          class="mobax-tool"
          (click)="download()"
          [disabled]="selectionCount === 0"
          title="선택 항목 다운로드"
        >
          <i class="fas fa-download"></i>
        </button>
        <span class="mobax-tool-sep" aria-hidden="true"></span>
        <button class="mobax-tool" (click)="openMoreMenu($event)" title="더보기">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>

      <div class="mobax-sftp-host" [hidden]="!hasSSH">
        <sftp-file-list
          [sftp]="sftp"
          [path]="currentPath"
          [silent]="pathSilent"
          (navigate)="onListNavigate($event)"
          (selectionChange)="onSelectionChange($event)"
        ></sftp-file-list>
      </div>

      <div class="mobax-hint" *ngIf="!hasSSH">연결된 SSH 세션이 없습니다.</div>

      <!-- Transfer progress strip: visible only during an active transfer. -->
      <div class="mobax-xfer" *ngIf="xfer.active">
        <i
          class="mobax-xfer-dir fas"
          [ngClass]="xfer.direction === 'upload' ? 'fa-arrow-up' : 'fa-arrow-down'"
          aria-hidden="true"
        ></i>
        <div class="mobax-xfer-body">
          <div class="mobax-xfer-top">
            <span class="mobax-xfer-name">{{ xfer.currentName }}</span>
            <span class="mobax-xfer-pct">{{ xferPercent }}%</span>
          </div>
          <div class="mobax-xfer-bar">
            <div class="mobax-xfer-fill" [style.width.%]="xferPercent"></div>
          </div>
          <div class="mobax-xfer-sub">
            <span class="mobax-xfer-bytes">{{ xferBytes }}</span>
            <span class="mobax-xfer-count" *ngIf="xfer.totalFiles > 1"
              >{{ xfer.doneFiles }} / {{ xfer.totalFiles }}</span
            >
          </div>
        </div>
        <button class="mobax-xfer-cancel" (click)="cancelTransfer()" title="전송 취소">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Bottom: follow toggle (Tabby's own <toggle> switch). The row is clickable; the toggle
           stops propagation so its own click isn't double-counted by the row handler. -->
      <div class="mobax-follow" *ngIf="hasSSH" (click)="toggleFollowing()">
        <toggle
          [ngModel]="!pinned"
          (ngModelChange)="setFollowing($event)"
          (click)="$event.stopPropagation()"
        ></toggle>
        <div class="mobax-follow-label">터미널 폴더 따라가기</div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .mobax-sftp {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .mobax-sftp-path {
        flex: 0 0 auto;
        box-sizing: border-box;
        /* Match Tabby's tab strip height (--tabs-height, inherited from app-root) for the top
           header; grows past it only when the path wraps to multiple lines. */
        min-height: var(--tabs-height, 38px);
        padding: 8px;
        /* Opaque chrome bg so tabby-background doesn't bleed through the header; the file list
           below stays transparent and keeps showing the backdrop. */
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        border-bottom: 1px solid var(--bs-border-color, #333);
        font-size: 12px;
        line-height: 1.6;
        /* Inline flow (NOT flex) so the whole path reads as one continuous, wrapping string;
           break long, space-less segment names anywhere instead of overflowing the rail. */
        overflow-wrap: anywhere;
        /* Hints the empty area is clickable to edit the path directly. */
        cursor: text;
      }
      .mobax-path-input {
        width: 100%;
        box-sizing: border-box;
        background: var(--bs-body-bg, #1e1e1e);
        color: inherit;
        border: 1px solid var(--bs-primary, #3b82f6);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
      }
      .mobax-crumb {
        cursor: pointer;
        opacity: 0.85;
        color: inherit;
        text-decoration: none;
      }
      .mobax-crumb:hover {
        opacity: 1;
        color: var(--bs-primary, #3b82f6);
      }
      .mobax-crumb:first-of-type {
        font-weight: 600;
      }
      .mobax-crumb-sep {
        opacity: 0.4;
        /* Replaces the old flex gap now that the row uses inline flow. */
        margin: 0 3px;
      }
      /* Static "SFTP" label shown in the header bar when there's no SSH session — same weight/tone
         as the first breadcrumb crumb, but inert (no hover/pointer). */
      .mobax-crumb-static {
        font-weight: 600;
        opacity: 0.85;
        cursor: default;
      }
      /* No session → the header isn't an editable path, so drop the text cursor. */
      .mobax-sftp-path.is-empty {
        cursor: default;
      }
      .mobax-sftp-tools {
        flex: 0 0 auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        /* Transparent so tabby-background shows through this toolbar row; only the breadcrumb
           header above it stays opaque chrome. */
        border-bottom: 1px solid var(--bs-border-color, #333);
      }
      .mobax-tool {
        background: transparent;
        border: none;
        color: inherit;
        opacity: 0.7;
        cursor: pointer;
        padding: 3px 7px;
        border-radius: 4px;
        font-size: 13px;
      }
      .mobax-tool:hover {
        opacity: 1;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.08));
      }
      .mobax-tool:disabled {
        opacity: 0.3;
        cursor: default;
      }
      .mobax-tool:disabled:hover {
        background: transparent;
      }
      .mobax-tool-sep {
        flex: 0 0 auto;
        align-self: stretch;
        width: 1px;
        margin: 2px;
        background: var(--bs-border-color, #333);
        opacity: 0.6;
      }
      .mobax-sftp-host {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .mobax-hint {
        flex: 1 1 auto;
        padding: 12px;
        opacity: 0.6;
      }
      .mobax-follow {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin: 0;
        box-sizing: border-box;
        /* Match the server stats status bar height (28px in serverStatsBar.component) so the two
           bottom bars line up. Keep them in sync if that value changes. */
        height: 28px;
        padding: 0 8px;
        /* Opaque chrome bg so this bottom control bar stays solid like the headers (no
           tabby-background bleed-through). */
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        border-top: 1px solid var(--bs-border-color, #333);
        font-size: 12px;
        cursor: pointer;
        user-select: none;
      }
      /* Tabby's <toggle> floats its switch inside a block .form-check, which collapses to zero
         height and drops the switch below the row's centre; it also keeps ~0.5em trailing space and
         a 10px host right-padding before the label. Re-lay .form-check as a centered flex row (no
         float, no padding) and drop the host right-padding so only the row gap spaces the label. */
      .mobax-follow ::ng-deep toggle {
        padding-right: 0;
      }
      .mobax-follow ::ng-deep .form-check {
        display: flex;
        align-items: center;
        margin: 0;
        min-height: 0;
        padding: 0;
      }
      .mobax-follow ::ng-deep .form-check-input {
        float: none;
        margin: 0;
      }
      .mobax-follow-label {
        display: flex;
        align-items: center;
        height: 16px;
        line-height: 1;
      }
      .mobax-xfer {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        padding: 4px 8px;
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        border-top: 1px solid var(--bs-border-color, #333);
        font-size: 11px;
      }
      .mobax-xfer-dir {
        flex: 0 0 auto;
        width: 12px;
        text-align: center;
        opacity: 0.7;
      }
      .mobax-xfer-body {
        flex: 1 1 auto;
        min-width: 0;
      }
      .mobax-xfer-top {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .mobax-xfer-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.85;
      }
      .mobax-xfer-count {
        flex: 0 0 auto;
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
      }
      .mobax-xfer-bar {
        height: 8px;
        margin-top: 4px;
        border-radius: 4px;
        background: var(--bs-border-color, #333);
        overflow: hidden;
      }
      .mobax-xfer-fill {
        height: 100%;
        background: var(--bs-primary, #3b82f6);
        transition: width 0.1s linear;
      }
      .mobax-xfer-pct {
        flex: 0 0 auto;
        opacity: 0.8;
        font-variant-numeric: tabular-nums;
      }
      .mobax-xfer-sub {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 3px;
        font-size: 10px;
        opacity: 0.55;
      }
      .mobax-xfer-bytes {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .mobax-xfer-cancel {
        flex: 0 0 auto;
        background: transparent;
        border: none;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
      }
      .mobax-xfer-cancel:hover {
        opacity: 1;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.08));
      }
    `,
  ],
})
export class SftpTabComponent implements OnInit, OnDestroy {
  @ViewChild(SftpFileListComponent) fileList?: SftpFileListComponent;
  @ViewChild('pathInput') pathInput?: ElementRef<HTMLInputElement>;

  hasSSH = false;
  pinned = false;
  // Snapshot of the transfer-progress state for the bottom strip (throttled render — see ngOnInit).
  xfer: TransferProgressState = idleState();
  xferPercent = 0;
  xferBytes = '';
  selectionCount = 0;
  selectionFileCount = 0;
  segments: Crumb[] = [];
  // Editable-path-bar state: when true, Row 1 shows a text input instead of the breadcrumb.
  editing = false;
  editValue = '';

  // The active SFTP engine + the directory the child list is showing. currentPath is bound to the
  // child's [path] @Input, so assigning it drives the child's readdir via ngOnChanges.
  sftp: SFTPSession | null = null;
  currentPath = '/';
  // Whether the current currentPath came from automatic shell-cwd following (vs an explicit user
  // action). Bound to the child's [silent] so a follow that can't be listed fails quietly instead
  // of raising a "읽기 실패" toast on every cd outside the SFTP-visible tree.
  pathSilent = false;

  private destroyed$ = new Subject<void>();
  private boundSshSession: unknown = null;
  // Whether the current binding follows the shell's cwd. Bound directly to an SSH tab → true;
  // bound through a tmux control-mode tab → false (tmux swallows the shell output). Part of the
  // rebind identity so an SSH↔tmux switch on the *same* session still rebinds to drop/add follow.
  private boundFollow = true;
  private boundShell: OscShellSession | null = null;
  private cwdSub: Subscription | null = null;
  // Watches a still-connecting SSH leaf's shell output so we can re-bind the moment the shell
  // opens (session.start() resolves) — no active-tab/focus event fires on that transition.
  private pendingOpenSub: Subscription | null = null;
  private splitFocusSub: Subscription | null = null;
  private follower: SftpProcFollower | null = null;
  private lastOscReportAt = 0;
  // The current tab's identity key (SSH leaf, shared with the inner-tab memory). pinned is
  // remembered per-key in SidebarService so it survives this component's *ngIf re-create.
  private followKey: object | null = null;

  constructor(
    private app: AppService,
    private cdr: ChangeDetectorRef,
    private platform: PlatformService,
    private sidebar: SidebarService,
    private transfer: TransferService,
  ) {}

  ngOnInit(): void {
    this.app.activeTabChange$
      .pipe(takeUntil(this.destroyed$))
      .subscribe((tab) => this.onActiveTab(tab));
    this.onActiveTab(this.app.activeTab);

    // Render the strip from the service. auditTime throttles the per-chunk byte updates so we don't
    // detectChanges() on every chunk; the host view is outside app-root's zone, so render manually.
    this.transfer.changes$
      .pipe(auditTime(80), takeUntil(this.destroyed$))
      .subscribe((s) => {
        this.xfer = s;
        this.xferPercent = Math.round(progressFraction(s) * 100);
        this.xferBytes = this.formatBytes(s);
        this.cdr.detectChanges();
      });
  }

  // "45.2 / 200 MB" for the strip's sub-line; just the done size if the total is unknown (0).
  private formatBytes(s: TransferProgressState): string {
    return s.totalBytes > 0
      ? `${this.humanSize(s.doneBytes)} / ${this.humanSize(s.totalBytes)}`
      : this.humanSize(s.doneBytes);
  }

  // Compact byte size for the strip (e.g. "45.2 MB"). Mirrors the file list's humanSize.
  private humanSize(bytes: number): string {
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

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.unbind();
  }

  // --- toolbar / breadcrumb actions (delegate to the child list) ---

  // Breadcrumb / "go to root" clicks: explicit user navigation, so read failures surface.
  navigate(path: string): void {
    this.go(path);
  }

  // The child list's navigate output: double-click open and "위로" are explicit (silent=false);
  // a cross-namespace re-navigation carries through the originating silent flag (a follow stays a
  // follow), so a chroot probe that fails mid-follow still doesn't raise a toast.
  onListNavigate(e: { path: string; silent: boolean }): void {
    this.go(e.path, e.silent);
  }

  // --- editable path bar (click the breadcrumb's empty area to type a path) ---

  // Swap the breadcrumb for a text input prefilled with the current path, then focus + select it.
  startEdit(): void {
    if (this.editing || !this.hasSSH || !this.sftp) {
      return;
    }
    this.editValue = this.currentPath || '/';
    this.editing = true;
    this.cdr.detectChanges();
    const el = this.pathInput?.nativeElement;
    if (el) {
      el.focus();
      el.select();
    }
  }

  // Enter: navigate to the typed path. Empty input is ignored (no surprise jump to root).
  // Follow state is intentionally left untouched — same as a breadcrumb click.
  commitEdit(value: string): void {
    this.editing = false;
    this.cdr.detectChanges();
    const target = value.trim();
    if (target) {
      this.go(target);
    }
  }

  // Esc / blur: leave edit mode without navigating.
  cancelEdit(): void {
    if (!this.editing) {
      return;
    }
    this.editing = false;
    this.cdr.detectChanges();
  }

  goUp(): void {
    const cur = this.currentPath;
    if (!cur) {
      return;
    }
    // Strip the last segment to get the parent path.
    const parent = cur.replace(/\/+[^/]*\/*$/, '') || '/';
    this.go(parent);
  }

  refresh(): void {
    void this.fileList?.reload();
  }

  newDirectory(): void {
    void this.fileList?.createDirectory();
  }

  upload(): void {
    void this.fileList?.uploadHere();
  }

  toggleFilter(): void {
    if (this.fileList) {
      if (this.fileList.showFilter) {
        this.fileList.closeFilter();
      } else {
        this.fileList.openFilter();
      }
      this.cdr.detectChanges();
    }
  }

  onSelectionChange(info: { count: number; fileCount: number }): void {
    this.selectionCount = info.count;
    this.selectionFileCount = info.fileCount;
    this.cdr.detectChanges();
  }

  cancelTransfer(): void {
    this.transfer.requestCancel();
  }

  download(): void {
    void this.fileList?.downloadSelected();
  }

  rename(): void {
    this.fileList?.renameSelected();
  }

  remove(): void {
    this.fileList?.deleteSelected();
  }

  // "더보기" overflow menu for less-used actions (rename / delete / filter), keeping the toolbar to
  // one row. rename/delete reflect the current selection; filter toggles the list's filter input.
  openMoreMenu(event: MouseEvent): void {
    const items: MenuItemOptions[] = [
      { label: '이름 변경', enabled: this.selectionCount === 1, click: () => this.rename() },
      { label: '삭제', enabled: this.selectionCount > 0, click: () => this.remove() },
      { type: 'separator' },
      { label: '필터', click: () => this.toggleFilter() },
    ];
    this.platform.popupContextMenu(items, event);
  }

  // following = the toggle's on-state (the inverse of pinned). Called by the <toggle>'s
  // ngModelChange and by toggleFollowing() (row-label click).
  setFollowing(following: boolean): void {
    this.pinned = !following;
    // Remember the choice per-tab so an *ngIf re-create (inner-tab switch) restores it instead of
    // resetting to "follow on". In-memory only — never persisted to config.
    if (this.followKey) {
      this.sidebar.setFollowPin(this.followKey, this.pinned);
    }
    if (!this.pinned && this.sftp && this.boundShell) {
      // Resuming follow: re-sync to the latest reported cwd.
      const target = nextSftpPath({
        pinned: false,
        reportedCwd: this.boundShell.reportedCWD ?? null,
        currentPath: this.currentPath,
      });
      if (target) {
        this.go(target, true); // follow resume = automatic
      }
      this.follower?.syncNow();
    }
  }

  // Row-label click toggles follow: the new following state is the inverse of the current one
  // (current following = !pinned), i.e. `pinned`.
  toggleFollowing(): void {
    this.setFollowing(this.pinned);
  }

  // --- navigation ---

  // Navigate the list to an absolute path. Sets currentPath (bound to the child's [path] → its
  // ngOnChanges runs readdir) and rebuilds our breadcrumb. detectChanges propagates the new input
  // to the child since the host view is attached to ApplicationRef (no automatic tick). `silent`
  // (true only for automatic shell-cwd follows) rides along to the child's [silent] so a follow
  // that can't be listed fails quietly.
  private go(path: string, silent = false): void {
    if (!this.sftp) {
      return;
    }
    this.currentPath = path;
    this.pathSilent = silent;
    this.segments = this.buildSegments(path);
    this.cdr.detectChanges();
  }

  // --- active-session binding ---

  private onActiveTab(activeTab: unknown): void {
    // Re-subscribe to split focus changes so moving between split panes rebinds.
    this.splitFocusSub?.unsubscribe();
    this.splitFocusSub = null;
    const focusChanged$ = (activeTab as { focusChanged$?: Observable<unknown> })?.focusChanged$;
    if (focusChanged$) {
      this.splitFocusSub = focusChanged$
        .pipe(takeUntil(this.destroyed$))
        .subscribe(() => this.rebind(activeTab));
    }
    this.rebind(activeTab);
  }

  private rebind(activeTab: unknown): void {
    // SSHTabComponent is not a public tabby-ssh export, so we duck-type the leaf:
    // resolveSSHBinding only accepts a leaf exposing an SSH session whose shell is open.
    const leaf = focusedLeaf(activeTab) as SSHLeafLike | null;
    let binding = resolveSSHBinding(leaf);
    let follow = true;
    if (!binding) {
      // tabby-tmux control-mode tab: it's a SplitTab whose focused leaf is a tmux *pane*, not the
      // SSH tab — so the lookup above fails. The live SSH tab is hidden as the tmux context's
      // topmostTab; bind SFTP to it (SFTP rides its own channel). cwd following is off here since
      // the tmux interceptor swallows the shell's output.
      const topmost = tmuxTopmostTab(activeTab);
      if (topmost) {
        binding = resolveSSHBinding(focusedLeaf(topmost) as SSHLeafLike);
        follow = false;
      }
    }
    if (!binding) {
      this.unbind();
      this.hasSSH = false;
      this.followKey = null;
      // A just-launched SSH tab whose shell hasn't finished opening yet still resolves to no
      // binding: resolveSSHBinding requires session.open === true, which is set only when
      // session.start() resolves (after connect + auth). Neither activeTabChange$ nor focusChanged$
      // fires on that transition, so without this we'd stay unbound — stuck at root with no listing —
      // until the user clicks the terminal. Watch the shell's first output (open is true by the time
      // any output flows) and re-bind then; bind() seeds the reported cwd so follow lands on the
      // shell's directory immediately, no interaction needed.
      this.waitForSessionOpen(leaf, activeTab);
      return;
    }
    // Restore this tab's remembered follow-pin BEFORE binding so bind()'s cwd subscriptions read
    // the right pinned state. Keyed on the SSH leaf (same key as the inner-tab memory), so each
    // tab follows independently and the choice survives this component's *ngIf re-create. A tab
    // we've never seen defaults to following (pinned=false).
    const { key } = sidebarTabContext(activeTab);
    this.followKey = key;
    this.pinned = (key ? this.sidebar.getFollowPin(key) : undefined) ?? false;
    void this.bind(binding.sshSession, binding.shellSession as OscShellSession, follow);
  }

  // Re-attempt the bind once a still-connecting SSH leaf's shell session opens. resolveSSHBinding
  // requires session.open === true, set only when session.start() resolves (after connect + auth);
  // neither activeTabChange$ nor focusChanged$ fires on that transition. The shell's first output
  // means it has opened, so re-run rebind then — bind() subscribes cwdReported$ and seeds
  // getWorkingDirectory(), so follow catches the shell's cwd without the user clicking the terminal.
  private waitForSessionOpen(leaf: SSHLeafLike | null, activeTab: unknown): void {
    this.pendingOpenSub?.unsubscribe();
    this.pendingOpenSub = null;
    const session = leaf?.session as unknown as OscShellSession | null | undefined;
    if (!leaf?.sshSession || !session || session.open === true || !session.output$) {
      return;
    }
    this.pendingOpenSub = session.output$
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => {
        if (session.open !== true) {
          return; // pre-open output (rare) — keep waiting for the chunk that follows session.start()
        }
        this.pendingOpenSub?.unsubscribe();
        this.pendingOpenSub = null;
        this.rebind(activeTab);
      });
  }

  private async bind(sshSession: unknown, shell: OscShellSession, follow = true): Promise<void> {
    if (this.boundSshSession === sshSession && this.boundFollow === follow && this.sftp) {
      // Already bound to this session (e.g. switching between two tabs that share one reused
      // connection): rebind() may have just restored a different pinned value for the new tab, so
      // refresh the toggle's checkbox to match without re-opening the channel.
      this.cdr.detectChanges();
      return;
    }
    this.unbind();
    this.boundSshSession = sshSession;
    this.boundFollow = follow;
    this.boundShell = shell;
    this.hasSSH = true;

    // Open our own SFTP channel off the SSH session (exactly what the panel's ngOnInit did).
    let sftp: SFTPSession;
    try {
      sftp = await (sshSession as { openSFTP(): Promise<SFTPSession> }).openSFTP();
    } catch {
      // openSFTP failed; if we're still meant to be on this session, surface "no session".
      if (this.boundSshSession === sshSession) {
        this.unbind();
        this.hasSSH = false;
        this.cdr.detectChanges();
      }
      return;
    }
    // A newer rebind/unbind may have run while we awaited openSFTP — drop this stale channel.
    if (this.boundSshSession !== sshSession) {
      return;
    }
    this.sftp = sftp;
    this.currentPath = '/';
    this.cdr.detectChanges(); // child picks up [sftp]/[path] and runs its first readdir

    const cwd$ = follow ? shell.oscProcessor?.cwdReported$ : undefined;
    if (cwd$) {
      this.cwdSub = cwd$.pipe(takeUntil(this.destroyed$)).subscribe((cwd) => {
        this.lastOscReportAt = Date.now();
        const target = nextSftpPath({
          pinned: this.pinned,
          reportedCwd: cwd,
          currentPath: this.currentPath,
        });
        if (target) {
          this.go(target, true); // OSC cwd report = automatic follow
        }
      });
    }

    // Seed from the session's last-known cwd (the shell may already be inside a dir). When not
    // following (tmux path), force pinned so we don't navigate off a possibly-stale cwd.
    shell.getWorkingDirectory?.().then((cwd) => {
      const target = nextSftpPath({
        pinned: this.pinned || !follow,
        reportedCwd: cwd,
        currentPath: this.currentPath,
      });
      if (target) {
        this.go(target, true); // cwd seed = automatic follow
      }
    });

    // /proc fallback follower: drives cwd when OSC is silent. Reuses our SFTP session; defers to
    // OSC via oscFreshMs. Skipped when not following (tmux path) so it can't yank the list around
    // off /proc reads of the tmux-driven shell.
    if (follow && shell.output$) {
      this.follower = new SftpProcFollower({
        getSftp: () => (this.sftp as unknown as SftpLike) ?? null,
        shell: shell as ShellLike,
        onCwd: (path) => {
          const target = nextSftpPath({
            pinned: this.pinned,
            reportedCwd: path,
            currentPath: this.currentPath,
          });
          if (target) {
            this.go(target, true); // /proc follower = automatic follow
          }
        },
        isPinned: () => this.pinned,
        oscFreshMs: () => Date.now() - this.lastOscReportAt,
      });
      this.follower.start();
    }
  }

  private unbind(): void {
    this.follower?.stop();
    this.follower = null;
    this.lastOscReportAt = 0;
    this.cwdSub?.unsubscribe();
    this.cwdSub = null;
    this.pendingOpenSub?.unsubscribe();
    this.pendingOpenSub = null;
    this.sftp = null;
    this.currentPath = '/';
    this.boundSshSession = null;
    this.boundFollow = true;
    this.boundShell = null;
    this.segments = [];
  }

  private buildSegments(p: string): Crumb[] {
    const out: Crumb[] = [];
    let acc = '';
    for (const part of (p ?? '').split('/')) {
      if (!part) {
        continue;
      }
      acc += '/' + part;
      out.push({ name: part, path: acc });
    }
    return out;
  }
}
