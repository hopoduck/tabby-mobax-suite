import {
  ChangeDetectorRef,
  Component,
  Inject,
  NgZone,
  OnInit,
  OnDestroy,
  Optional,
} from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AppService,
  ConfigService,
  HostWindowService,
  TabContextMenuItemProvider,
} from 'tabby-core';
import { SidebarService, InnerTab } from '../services/sidebar.service';
import {
  focusedLeaf,
  isSSHLeaf,
  resolveSSHBinding,
  sidebarTabContext,
  SSHLeafLike,
  SidebarTabContext,
} from '../logic/activeSession';
import { probeServerTmux } from '../ssh/tmuxProbe';
import { resolveActiveInnerTab } from '../logic/tabsConfig';

// Minimal shapes of the bits of tabby-core's TabContextMenuItemProvider / MenuItemOptions we use,
// so we can invoke tabby-tmux's "Enter Tmux Mode" item without importing its un-exported service.
interface MenuItemLike {
  label?: string;
  click?: () => void;
}
interface ContextMenuProviderLike {
  getItems(tab: unknown, tabHeader?: unknown): MenuItemLike[] | Promise<MenuItemLike[]>;
}

@Component({
  selector: 'mobax-sidebar-host',
  template: `
    <div class="mobax-rail">
      <button
        *ngIf="tabEnabled('sessions')"
        class="mobax-rail-btn"
        [class.active]="!collapsed && activeInnerTab === 'sessions'"
        (click)="select('sessions')"
        title="Sessions"
      >
        <svg class="mobax-rail-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v2A1.5 1.5 0 0 1 12.5 6h-9A1.5 1.5 0 0 1 2 4.5v-2zm1.5-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-9zM2 9.5A1.5 1.5 0 0 1 3.5 8h9A1.5 1.5 0 0 1 14 9.5v2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-2zm1.5-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-9z"
          />
          <path d="M4.5 3a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 7a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z" />
        </svg>
      </button>
      <button
        *ngIf="tabEnabled('sftp')"
        class="mobax-rail-btn"
        [class.active]="!collapsed && activeInnerTab === 'sftp'"
        (click)="select('sftp')"
        title="SFTP"
      >
        <svg class="mobax-rail-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 11.828 3H13.5a2 2 0 0 1 2 2H2.19c-.24 0-.47.083-.66.235zM2.19 5.5h11.62a1 1 0 0 1 .98 1.193l-.83 4A1 1 0 0 1 13 11.5H3a1 1 0 0 1-.98-.807l-.83-4A1 1 0 0 1 2.19 5.5z"
          />
        </svg>
      </button>
      <button
        *ngIf="tabEnabled('macros')"
        class="mobax-rail-btn"
        [class.active]="!collapsed && activeInnerTab === 'macros'"
        (click)="select('macros')"
        title="매크로"
      >
        <svg class="mobax-rail-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8.5 1 2 9h4l-1.5 6L13 7H9l1.5-6z" />
        </svg>
      </button>

      <!-- Spacer: fills the middle so the bottom actions (tmux / reload) sit at the rail's bottom.
           Kept draggable like the rest of the rail's empty space. -->
      <div class="mobax-rail-spacer"></div>

      <!-- Action (not a tab): enter tmux control mode on the active SSH tab. Shown (*ngIf) only when
           the tabby-tmux plugin is loaded AND the target server has tmux — both probed + cached in
           evaluateActiveLeaf; hidden in every other case. -->
      <button
        *ngIf="showTmuxButton"
        class="mobax-rail-btn mobax-rail-action"
        (click)="enterTmux()"
        title="tmux 모드 진입"
      >
        <svg class="mobax-rail-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
          <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
          <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
          <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
        </svg>
      </button>

      <!-- Action (not a tab): reload the Tabby window — re-requires a rebuilt plugin. Off by default
           (mobaxSidebar.tabs.reload === false); rendered only when explicitly enabled in settings.
           Live SSH sessions drop and reconnect; intentionally no confirmation (quick dev reload). -->
      <button
        *ngIf="reloadEnabled"
        class="mobax-rail-btn mobax-rail-action"
        (click)="reloadWindow()"
        title="새로고침 (Tabby 리로드)"
      >
        <svg class="mobax-rail-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"
          />
          <path
            d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"
          />
        </svg>
      </button>
    </div>

    <div class="mobax-content" *ngIf="!collapsed && activeInnerTab">
      <sessions-tab *ngIf="activeInnerTab === 'sessions'" class="mobax-pane"></sessions-tab>
      <sftp-tab *ngIf="activeInnerTab === 'sftp'" class="mobax-pane"></sftp-tab>
      <macros-tab *ngIf="activeInnerTab === 'macros'" class="mobax-pane"></macros-tab>
    </div>

    <div
      class="mobax-resize-handle"
      *ngIf="!collapsed && activeInnerTab"
      (mousedown)="startResize($event)"
    ></div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: row;
        height: 100%;
        width: 100%;
        color: var(--bs-body-color, #ddd);
        font-size: 13px;
      }
      .mobax-rail {
        flex: 0 0 auto;
        width: 44px;
        display: flex;
        flex-direction: column;
        padding-top: 4px;
        border-right: 1px solid var(--bs-border-color, #333);
        /* Opaque chrome fill matching Tabby's title/tab bar (--theme-bg-more-2 is derived from
           the terminal background by ThemesService and set on documentElement, so it inherits
           here). This keeps tabby-background's backdrop from bleeding through the rail — it reads
           as solid chrome like Tabby's own tab strip. The content pane stays transparent so the
           backdrop still shows through the session/file lists. */
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        /* Grab the rail's empty space to drag the OS window (frameless mode). */
        -webkit-app-region: drag;
      }
      .mobax-rail-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 11px 2px;
        background: transparent;
        border: none;
        border-left: 2px solid transparent;
        color: inherit;
        opacity: 0.55;
        cursor: pointer;
        /* Exclude buttons from the drag region so clicks still register. */
        -webkit-app-region: no-drag;
      }
      .mobax-rail-btn:hover {
        opacity: 0.85;
      }
      .mobax-rail-btn.active {
        opacity: 1;
        color: var(--bs-primary, #3b82f6);
        border-left-color: var(--bs-primary, #3b82f6);
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      /* Fills the gap between the top tab icons and the bottom actions, pushing the latter to the
         rail's bottom. (A single flex spacer, not per-button margin-top:auto — two auto top margins
         would split the free space and float both actions to the middle instead of the bottom.) */
      .mobax-rail-spacer {
        flex: 1 1 auto;
        /* Keep the rail's mid section draggable like its other empty space. */
        -webkit-app-region: drag;
      }
      /* Bottom rail actions (tmux / reload): a small gap below; the spacer above pins them down. */
      .mobax-rail-action {
        margin-bottom: 4px;
      }
      .mobax-rail-btn:disabled {
        opacity: 0.2;
        cursor: default;
      }
      .mobax-rail-btn:disabled:hover {
        opacity: 0.2;
      }
      .mobax-rail-icon {
        width: 20px;
        height: 20px;
        display: block;
      }
      .mobax-content {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .mobax-pane {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        padding: 0;
      }
      .mobax-resize-handle {
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 1000;
      }
    `,
  ],
})
export class SidebarHostComponent implements OnInit, OnDestroy {
  service!: SidebarService;
  activeInnerTab: InnerTab | null;
  collapsed: boolean;
  // Click-eligibility for "Enter Tmux Mode": true only on a connected SSH tab not already in tmux.
  // Recomputed in evaluateActiveLeaf on every active-tab / focus / session change. Visibility is a
  // stricter, async gate (showTmuxButton) layered on top of this.
  canEnterTmux = false;
  // Whether the rail's tmux action is *rendered* (*ngIf): requires canEnterTmux AND the tabby-tmux
  // plugin loaded AND the server having tmux. Both extra facts are probed asynchronously and
  // cached (below); until both confirm, this stays false so the button never flashes prematurely.
  showTmuxButton = false;

  // tabby-tmux plugin presence — global + static (plugins load at startup). null until first
  // probed via the shared context-menu providers; then cached permanently.
  private tmuxPluginAvailable: boolean | null = null;
  // Per-SSH-session "server has tmux" result. Only definitive answers are stored; a probe that
  // times out / errors (null) is left out so it retries on the next evaluation instead of hiding
  // the button forever.
  private serverTmuxCache = new WeakMap<object, boolean>();
  // In-flight server probes, deduped per session so overlapping evaluations share one exec channel.
  private serverTmuxInflight = new WeakMap<object, Promise<boolean | null>>();
  // Bumped on every visibility evaluation; an async result only applies if it still matches (i.e.
  // the active tab/leaf hasn't changed under it).
  private tmuxEvalSeq = 0;
  // Cleared in ngOnDestroy so a late async probe doesn't touch a torn-down view.
  private alive = true;

  private destroyed$ = new Subject<void>();
  // Watchers scoped to the current top-level tab (split focus + the focused leaf's session
  // lifecycle). Rebuilt on every active-tab change so a freshly launched SSH tab is caught.
  private activeTabSubs = new Subscription();
  private watchedLeaf: unknown = null;
  // Per-tab "last inner tab" memory, keyed on the focused leaf (or, in tmux mode, the hidden
  // topmost SSH leaf). In-memory only and never persisted — the WeakMap entry drops when the
  // tab/leaf is GC'd, so a tab is remembered only for its lifetime. A tab with no entry (first
  // activation) falls back to the default (SFTP for SSH, Sessions otherwise); manual switches are
  // recorded in select() and restored on that tab's next activation.
  private innerTabMemory = new WeakMap<object, InnerTab>();

  constructor(
    private config: ConfigService,
    private zone: NgZone,
    private app: AppService,
    private cdr: ChangeDetectorRef,
    private hostWindow: HostWindowService,
    @Optional()
    @Inject(TabContextMenuItemProvider)
    private contextMenuProviders: ContextMenuProviderLike[] | null,
  ) {
    // The active inner tab is no longer persisted; per-tab memory (innerTabMemory) drives it at
    // runtime. Start on Sessions; the first active-tab evaluation applies the per-tab rule.
    this.activeInnerTab = 'sessions';
    this.collapsed = this.config.store.mobaxSidebar?.collapsed ?? false;
  }

  ngOnInit(): void {
    // Drive the inner tab from the active terminal tab: each tab restores its remembered inner
    // tab, or defaults to SFTP (SSH) / Sessions (otherwise) on first activation. We only switch
    // the inner tab — never auto-expand a collapsed pane. activeTabChange$ is a plain Subject
    // (no replay), so this reacts to real tab moves only.
    this.app.activeTabChange$
      .pipe(takeUntil(this.destroyed$))
      .subscribe((tab) => this.onActiveTab(tab));
    // Evaluate the already-active tab once on mount (activeTabChange$ has no replay) so both the
    // inner tab and the rail's tmux action reflect the startup tab immediately.
    this.onActiveTab(this.app.activeTab);
    // React to settings changes (rail toggles) live.
    this.config.changed$
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => this.applyTabsConfig());
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.destroyed$.next();
    this.destroyed$.complete();
    this.activeTabSubs.unsubscribe();
  }

  select(tab: InnerTab): void {
    if (this.collapsed) {
      // Collapsed → any icon click expands and shows that tab.
      this.switchInnerTab(tab);
      this.setCollapsed(false);
      this.rememberInnerTab(tab);
    } else if (this.activeInnerTab === tab) {
      // Expanded + the active icon re-clicked → collapse the content pane (no tab change).
      this.setCollapsed(true);
    } else {
      // Expanded + a different icon → just switch tabs.
      this.switchInnerTab(tab);
      this.rememberInnerTab(tab);
    }
    // The host view is attached to ApplicationRef and the rail click can fire outside Angular's
    // zone, so render the switch now instead of waiting for the next incidental tick. select() only
    // runs from a real click (never re-entrant), so this never collides with an in-progress pass.
    try {
      this.cdr.detectChanges();
    } catch {
      /* view torn down */
    }
  }

  tabEnabled(id: 'sessions' | 'sftp' | 'macros'): boolean {
    return this.config.store.mobaxSidebar?.tabs?.[id] !== false;
  }

  // Whether the rail's reload action is rendered. Unlike the inner-tab toggles (default ON, so
  // `!== false`), reload defaults OFF — only an explicit `true` shows it.
  get reloadEnabled(): boolean {
    return this.config.store.mobaxSidebar?.tabs?.reload === true;
  }

  // Reload the Tabby renderer window (Ctrl-R equivalent), so a rebuilt plugin's dist is re-required.
  // Live SSH sessions drop and reconnect; no confirmation by design (a quick dev-reload affordance).
  reloadWindow(): void {
    this.hostWindow.reload();
  }

  private tmuxEnabled(): boolean {
    return this.config.store.mobaxSidebar?.tabs?.tmux !== false;
  }

  // Re-evaluate after a settings change: correct the active inner tab if it was just disabled,
  // and re-run the tmux gate (toggling tmux off must drop the button AND stop probing).
  private applyTabsConfig(): void {
    const next = resolveActiveInnerTab(this.config.store.mobaxSidebar?.tabs, this.activeInnerTab);
    if (next !== this.activeInnerTab) {
      this.activeInnerTab = next;
    }
    this.updateTmuxButtonVisibility(focusedLeaf(this.app.activeTab) as SSHLeafLike | null);
    try {
      this.cdr.detectChanges();
    } catch {
      /* view torn down */
    }
  }

  // Enter tmux control mode on the active SSH tab — same effect as right-click → "Enter Tmux Mode"
  // (tabby-tmux). Its TmuxService isn't exported, so we drive the menu item it registers via the
  // shared TabContextMenuItemProvider token: find the item by label and invoke its handler.
  async enterTmux(): Promise<void> {
    if (!this.canEnterTmux) {
      return;
    }
    const leaf = focusedLeaf(this.app.activeTab);
    if (!leaf) {
      return;
    }
    for (const provider of this.contextMenuProviders ?? []) {
      let items: MenuItemLike[];
      try {
        items = await provider.getItems(leaf);
      } catch {
        // A provider unrelated to tmux may not handle this tab shape — skip it, keep looking.
        continue;
      }
      const enter = items?.find((item) => item?.label === 'Enter Tmux Mode');
      if (enter?.click) {
        enter.click();
        return;
      }
    }
  }

  // Decide whether the tmux action is rendered. Synchronous when both facts are already known (no
  // flicker re-activating a known tab); otherwise hides now and resolves asynchronously. Bumping
  // tmuxEvalSeq first invalidates any in-flight resolution from a previous tab.
  private updateTmuxButtonVisibility(leaf: SSHLeafLike | null): void {
    const seq = ++this.tmuxEvalSeq;
    if (!this.tmuxEnabled()) {
      // tmux button disabled in settings → never probe the server for tmux.
      this.showTmuxButton = false;
      return;
    }
    if (!isSSHLeaf(leaf)) {
      this.showTmuxButton = false;
      return;
    }
    const binding = resolveSSHBinding(leaf);
    if (!binding) {
      // SSH tab whose connection isn't open yet — can't probe. Hide for now; sessionChanged$
      // re-evaluates once the shell opens.
      this.showTmuxButton = false;
      return;
    }
    const session = binding.sshSession as object;
    const cachedServer = this.serverTmuxCache.get(session);
    if (this.tmuxPluginAvailable !== null && cachedServer !== undefined) {
      this.showTmuxButton = this.tmuxPluginAvailable && cachedServer;
      return;
    }
    // Strict: hidden until both probes confirm.
    this.showTmuxButton = false;
    void this.resolveTmuxButton(seq, leaf, session);
  }

  private async resolveTmuxButton(seq: number, leaf: SSHLeafLike, session: object): Promise<void> {
    // tabby-tmux presence is global + static — probe the shared context-menu providers once.
    if (this.tmuxPluginAvailable === null) {
      this.tmuxPluginAvailable = await this.probeTmuxPlugin(leaf);
    }
    if (!this.tmuxPluginAvailable) {
      this.applyTmuxVisibility(seq, false);
      return;
    }
    // Server tmux presence — per session. Cache only definitive answers; a null (timeout/error)
    // stays hidden but is retried on the next evaluation.
    let serverHasTmux = this.serverTmuxCache.get(session);
    if (serverHasTmux === undefined) {
      const probed = await this.probeServerTmuxShared(session);
      if (probed === null) {
        this.applyTmuxVisibility(seq, false);
        return;
      }
      serverHasTmux = probed;
      this.serverTmuxCache.set(session, serverHasTmux);
    }
    this.applyTmuxVisibility(seq, serverHasTmux);
  }

  // Probe the shared context-menu providers for tabby-tmux's "Enter Tmux Mode" item — its presence
  // means the plugin is installed (same providers enterTmux drives).
  private async probeTmuxPlugin(leaf: SSHLeafLike): Promise<boolean> {
    for (const provider of this.contextMenuProviders ?? []) {
      let items: MenuItemLike[];
      try {
        items = await provider.getItems(leaf);
      } catch {
        // A provider unrelated to tmux may not handle this tab shape — skip it, keep looking.
        continue;
      }
      if (items?.some((item) => item?.label === 'Enter Tmux Mode')) {
        return true;
      }
    }
    return false;
  }

  // Dedupe overlapping server probes for one session onto a single exec channel; the entry is
  // dropped on settle so a null result can be retried later.
  private probeServerTmuxShared(session: object): Promise<boolean | null> {
    const existing = this.serverTmuxInflight.get(session);
    if (existing) {
      return existing;
    }
    const probe = probeServerTmux(session)
      .catch(() => null)
      .finally(() => this.serverTmuxInflight.delete(session));
    this.serverTmuxInflight.set(session, probe);
    return probe;
  }

  // Apply an async visibility result only if it's still the latest evaluation and the view is
  // alive. Force change detection since russh callbacks may resolve outside Angular's zone.
  private applyTmuxVisibility(seq: number, show: boolean): void {
    if (seq !== this.tmuxEvalSeq || !this.alive || this.showTmuxButton === show) {
      return;
    }
    this.showTmuxButton = show;
    try {
      this.cdr.detectChanges();
    } catch {
      /* view already torn down */
    }
  }

  private onActiveTab(activeTab: unknown): void {
    // Rebuild per-tab watchers. A just-launched SSH tab is a SplitTabComponent whose focused
    // leaf — and that leaf's sshSession — may not exist yet when this fires, so switching to it
    // here alone misses new sessions. We additionally watch focusChanged$ (leaf gets focused)
    // and the focused leaf's sessionChanged$ (session established) and re-evaluate; switching to
    // an already-open SSH tab still resolves on the first pass.
    this.activeTabSubs.unsubscribe();
    this.activeTabSubs = new Subscription();
    this.watchedLeaf = null;

    const focusChanged$ = (activeTab as { focusChanged$?: Observable<unknown> })?.focusChanged$;
    if (focusChanged$) {
      this.activeTabSubs.add(
        focusChanged$
          .pipe(takeUntil(this.destroyed$))
          .subscribe(() => this.evaluateActiveLeaf(activeTab)),
      );
    }
    this.evaluateActiveLeaf(activeTab);
  }

  private evaluateActiveLeaf(activeTab: unknown): void {
    const leaf = focusedLeaf(activeTab) as SSHLeafLike | null;
    // "Enter Tmux Mode" is offered only on a real, connected SSH tab. In tmux mode the focused
    // leaf is a tmux pane (no sshSession) → false, which is correct (already inside tmux).
    this.canEnterTmux = isSSHLeaf(leaf);
    // Recompute whether the button is even rendered (plugin + server tmux gate).
    this.updateTmuxButtonVisibility(leaf);
    if (!leaf) {
      // Split isn't laid out yet; focusChanged$ will deliver the leaf shortly.
      return;
    }
    // SSH tab (direct) or tmux control-mode tab over SSH → SSH context; sidebarTabContext keys it
    // on the SSH leaf (shared between the SSH tab and its tmux mode) and reports isSSH.
    const ctx = sidebarTabContext(activeTab);
    if (ctx.isSSH) {
      this.showInnerTab(this.targetInnerTab(ctx));
      return;
    }
    // Not (yet) SSH. A genuine non-SSH tab has a live shell `session`, so decide now. A
    // just-launched SSH tab momentarily has neither sshSession nor a live session → wait for
    // sessionChanged$ and re-evaluate (the SSH session is set before the shell opens) so we don't
    // flicker through Sessions on the way to SFTP.
    if (leaf.session) {
      this.showInnerTab(this.targetInnerTab(ctx));
      return;
    }
    if (leaf !== this.watchedLeaf) {
      this.watchedLeaf = leaf;
      const sessionChanged$ = (leaf as { sessionChanged$?: Observable<unknown> }).sessionChanged$;
      if (sessionChanged$) {
        this.activeTabSubs.add(
          sessionChanged$
            .pipe(takeUntil(this.destroyed$))
            .subscribe(() => this.evaluateActiveLeaf(activeTab)),
        );
      } else {
        // No session lifecycle to wait on (not a terminal tab) → treat as non-SSH.
        this.showInnerTab(this.targetInnerTab(ctx));
      }
    }
  }

  // The inner tab to show for a tab on activation: its remembered tab if any, else the first-time
  // default (SFTP for an SSH context, Sessions otherwise). Reads memory only — never writes it.
  private targetInnerTab(ctx: SidebarTabContext): InnerTab | null {
    const remembered = ctx.key ? this.innerTabMemory.get(ctx.key) : undefined;
    const desired = remembered ?? (ctx.isSSH ? 'sftp' : 'sessions');
    // Skip disabled tabs: keep `desired` if enabled, else first enabled, else null.
    return resolveActiveInnerTab(this.config.store.mobaxSidebar?.tabs, desired);
  }

  // Record the user's manual inner-tab choice against the active tab's memory key. Only user
  // actions (select) call this; auto-switches read memory but never write it, so the entry always
  // reflects the last tab the user actually chose for that tab.
  private rememberInnerTab(tab: InnerTab): void {
    const { key } = sidebarTabContext(this.app.activeTab);
    if (key) {
      this.innerTabMemory.set(key, tab);
    }
  }

  private showInnerTab(tab: InnerTab | null): void {
    if (this.activeInnerTab !== tab) {
      this.switchInnerTab(tab);
      // Auto-switch (active-tab / focus / session change) arrives via RxJS, often outside Angular's
      // zone, so render now rather than waiting for the next incidental tick — this is what makes
      // the SFTP tab appear promptly when a freshly launched SSH session connects. Guarded because
      // the first call comes synchronously from ngOnInit (inside the host's own CD pass); there the
      // re-entrant detectChanges throws and is harmlessly swallowed (that pass renders it anyway).
      try {
        this.cdr.detectChanges();
      } catch {
        /* re-entrant initial pass or torn-down view — the ongoing pass will render it */
      }
    }
  }

  private switchInnerTab(tab: InnerTab | null): void {
    this.activeInnerTab = tab;
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.service?.applyCollapsed(collapsed);
  }

  startResize(event: MouseEvent): void {
    event.preventDefault();
    const wrapper = (event.target as HTMLElement).closest(
      '.mobax-sidebar-wrapper',
    ) as HTMLElement | null;
    const left = wrapper ? wrapper.getBoundingClientRect().left : 0;
    const onMove = (e: MouseEvent) => this.service?.setWidth(e.clientX - left);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // Resize fires outside Angular to avoid CD churn on every mousemove.
    this.zone.runOutsideAngular(() => {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
