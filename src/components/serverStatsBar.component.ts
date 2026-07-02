import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Observable, Subject, Subscription, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AppService, ConfigService } from 'tabby-core';
import { focusedLeaf, resolveSSHBinding, tmuxTopmostTab, SSHLeafLike } from '../logic/activeSession';
import {
  buildStatsCommand,
  parseStats,
  formatUptime,
  formatMemPair,
  memPercent,
  severityOf,
  ServerStats,
  CpuSample,
  Severity,
} from '../logic/serverStats';
import { runStatsCommand } from '../ssh/statsExec';
import { OS_ICONS } from '../logic/osIcons';
import { sparkPoints, smoothPath, areaPath, Point } from '../logic/sparkline';

interface SessionState {
  prevCpu: CpuSample | null;
  cpuHistory: number[];
  last: ServerStats | null;
}

interface WillDestroySession {
  willDestroy$?: Observable<void>;
}

const HISTORY_MAX = 30;
const SPARK_W = 56;
const SPARK_H = 18;
const SPARK_PAD = 2;

const EMPTY_UNAVAILABLE: ServerStats = {
  ok: false,
  host: null,
  cpuPct: null,
  cpuSample: null,
  mem: null,
  uptimeSec: null,
  user: null,
  sessions: null,
  disks: [],
  osId: null,
};

@Component({
  selector: 'server-stats-bar',
  template: `
    <div
      class="ssb"
      #ssbEl
      [class.fade-left]="fadeLeft"
      [class.fade-right]="fadeRight"
      (scroll)="updateFade()"
      *ngIf="hasSSH"
    >
      <ng-container *ngIf="stats?.ok; else unavailable">
        <span class="ssb-cell ssb-host" *ngIf="stats?.host">
          <span
            class="ssb-os-wrap"
            *ngIf="osIconHtml() as iconHtml; else serverIcon"
            [innerHTML]="iconHtml"
            aria-hidden="true"
          ></span>
          <ng-template #serverIcon><i class="fas fa-server"></i></ng-template>
          {{ stats?.host }}
        </span>
        <span class="ssb-sep"></span>
        <span
          class="ssb-cell"
          [class.warn]="cpuClass() === 'warn'"
          [class.danger]="cpuClass() === 'danger'"
        >
          <i class="fas fa-microchip"></i>
          CPU {{ stats?.cpuPct == null ? '–' : stats?.cpuPct + '%' }}
          <svg class="ssb-spark" viewBox="0 0 56 18" *ngIf="cpuHistory.length >= 1">
            <defs>
              <linearGradient id="mobaxCpuSpark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="currentColor" stop-opacity="0.42" />
                <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path [attr.d]="sparkArea()" fill="url(#mobaxCpuSpark)" />
            <path
              [attr.d]="sparkLine()"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle [attr.cx]="sparkDotX()" [attr.cy]="sparkDotY()" r="1.6" fill="currentColor" />
          </svg>
        </span>
        <span class="ssb-sep"></span>
        <span
          class="ssb-cell"
          [class.warn]="memClass() === 'warn'"
          [class.danger]="memClass() === 'danger'"
        >
          <i class="fas fa-memory"></i> MEM {{ mem() }}
        </span>
        <span class="ssb-sep"></span>
        <span class="ssb-cell"><i class="fas fa-clock"></i> {{ uptime() }}</span>
        <span class="ssb-sep"></span>
        <span class="ssb-cell" *ngIf="stats?.user">
          <i class="fas fa-user"></i> {{ stats?.user
          }}<ng-container *ngIf="stats?.sessions"> (x{{ stats?.sessions }})</ng-container>
        </span>
        <span class="ssb-sep"></span>
        <span class="ssb-cell ssb-disk-icon" *ngIf="stats?.disks?.length">
          <i class="fas fa-hdd"></i>
        </span>
        <span
          class="ssb-cell ssb-disk"
          *ngFor="let d of stats?.disks"
          [class.warn]="diskClass(d.usePct) === 'warn'"
          [class.danger]="diskClass(d.usePct) === 'danger'"
        >
          {{ d.mount }} {{ d.usePct }}%
        </span>
      </ng-container>
      <ng-template #unavailable>
        <span class="ssb-cell ssb-muted">stats unavailable</span>
      </ng-template>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        flex: 0 0 auto;
      }
      .ssb {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
        overflow-x: auto;
        /* Hide the scrollbar (it eats vertical space in the 28px bar) while keeping
           wheel/drag scrolling. */
        scrollbar-width: none;
        height: 28px;
        padding: 0 10px;
        font-size: 13px;
        line-height: 1;
        white-space: nowrap;
        border-top: 1px solid var(--bs-border-color, #333);
        background: var(--bs-tertiary-bg, rgba(0, 0, 0, 0.2));
        color: var(--bs-body-color, #ccc);
      }
      .ssb::-webkit-scrollbar {
        display: none;
      }
      /* Fade an edge only while content overflows past it (toggled in JS / updateFade, so a
         bar that already fits is never dimmed). Combined selector handles both at once;
         its higher specificity wins over the single-edge rules. */
      .ssb.fade-right {
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
        mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
      }
      .ssb.fade-left {
        -webkit-mask-image: linear-gradient(to right, transparent, #000 20px);
        mask-image: linear-gradient(to right, transparent, #000 20px);
      }
      .ssb.fade-left.fade-right {
        -webkit-mask-image: linear-gradient(
          to right,
          transparent,
          #000 20px,
          #000 calc(100% - 20px),
          transparent
        );
        mask-image: linear-gradient(
          to right,
          transparent,
          #000 20px,
          #000 calc(100% - 20px),
          transparent
        );
      }
      .ssb-cell {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        opacity: 0.9;
      }
      .ssb-cell i {
        opacity: 0.7;
      }
      .ssb-host {
        font-weight: 600;
      }
      .ssb-os-wrap {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
      }
      .ssb-sep {
        flex: 0 0 auto;
        width: 1px;
        height: 16px;
        background: var(--bs-border-color, #444);
        opacity: 0.6;
      }
      .ssb-spark {
        width: 56px;
        height: 18px;
        margin-left: 4px;
        opacity: 0.9;
        color: var(--mobax-info);
      }
      .ssb-cell.warn .ssb-spark {
        color: var(--mobax-warning);
      }
      .ssb-cell.danger .ssb-spark {
        color: var(--mobax-danger);
      }
      .ssb-muted {
        opacity: 0.5;
        font-style: italic;
      }
      .ssb-cell.warn,
      .ssb-cell.warn i {
        color: var(--mobax-warning);
      }
      .ssb-cell.danger,
      .ssb-cell.danger i {
        color: var(--mobax-danger);
      }
    `,
  ],
})
export class ServerStatsBarComponent implements OnInit, OnDestroy {
  hasSSH = false;
  stats: ServerStats | null = null;
  cpuHistory: number[] = [];
  fadeLeft = false;
  fadeRight = false;

  private ssbRef?: ElementRef<HTMLElement>;
  private resizeObs?: ResizeObserver;

  @ViewChild('ssbEl')
  set ssbEl(ref: ElementRef<HTMLElement> | undefined) {
    this.ssbRef = ref;
    this.resizeObs?.disconnect();
    this.resizeObs = undefined;
    const el = ref?.nativeElement;
    if (el && typeof ResizeObserver !== 'undefined') {
      // Column/sidebar resize changes clientWidth (flipping the overflow state) without a
      // scroll or content event, so observe the element itself to recompute the fade.
      this.resizeObs = new ResizeObserver(() => this.updateFade());
      this.resizeObs.observe(el);
    }
  }

  private destroyed$ = new Subject<void>();
  private states = new Map<unknown, SessionState>();
  private destroySubs = new Map<unknown, Subscription>();
  private activeSession: unknown = null;
  private currentTab: unknown = null;
  private splitFocusSub: Subscription | null = null;
  private busy = false;
  private alive = true;
  private intervalMs = 3000;
  // SafeHtml per OS slug; built once per icon (inner SVG injected via [innerHTML]).
  private iconHtmlCache = new Map<string, SafeHtml>();

  constructor(
    private app: AppService,
    private config: ConfigService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    const cfgSec = this.config.store.mobaxStatusBar?.intervalSeconds;
    this.intervalMs = Math.max(1, Number(cfgSec) || 3) * 1000;

    this.app.activeTabChange$
      .pipe(takeUntil(this.destroyed$))
      .subscribe((tab) => this.onActiveTab(tab));
    this.onActiveTab(this.app.activeTab);

    interval(this.intervalMs)
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => {
        // A freshly opened SSH session isn't `open` yet when its tab activates, so the initial
        // bind misses it and nothing re-fires until the user clicks (focus change). Re-attempt
        // the bind here while unbound so the bar appears on its own within one interval.
        if (!this.activeSession) {
          this.rebind(this.currentTab);
        }
        void this.poll();
      });
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.resizeObs?.disconnect();
    this.resizeObs = undefined;
    this.destroyed$.next();
    this.destroyed$.complete();
    this.splitFocusSub?.unsubscribe();
    for (const sub of this.destroySubs.values()) {
      sub.unsubscribe();
    }
    this.destroySubs.clear();
    this.states.clear();
  }

  // --- active-session binding (mirrors sftpTab) ---

  private onActiveTab(activeTab: unknown): void {
    this.currentTab = activeTab;
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
    const leaf = focusedLeaf(activeTab) as SSHLeafLike | null;
    let binding = resolveSSHBinding(leaf);
    if (!binding) {
      // tabby-tmux control-mode tab: the focused leaf is a tmux *pane*, not the SSH tab, so the
      // lookup above fails. The live SSH tab survives hidden as the tmux context's topmostTab;
      // bind stats to it (mirrors sftpTab). Stats run on the SSH session's own exec channel
      // (openSessionChannel), independent of the tmux-driven shell, so polling works exactly as
      // in direct SSH mode.
      const topmost = tmuxTopmostTab(activeTab);
      if (topmost) {
        binding = resolveSSHBinding(focusedLeaf(topmost) as SSHLeafLike);
      }
    }
    if (!binding) {
      this.activeSession = null;
      this.hasSSH = false;
      this.stats = null;
      this.cpuHistory = [];
      this.detect();
      return;
    }
    const session = binding.sshSession;
    this.activeSession = session;
    this.hasSSH = true;
    this.trackDestroy(session);
    const state = this.ensureState(session);
    // Render this session's preserved snapshot instantly (no blank flash on tab switch).
    this.stats = state.last;
    this.cpuHistory = state.cpuHistory;
    this.detect();
  }

  private ensureState(session: unknown): SessionState {
    let st = this.states.get(session);
    if (!st) {
      st = { prevCpu: null, cpuHistory: [], last: null };
      this.states.set(session, st);
    }
    return st;
  }

  private trackDestroy(session: unknown): void {
    if (this.destroySubs.has(session)) {
      return;
    }
    const willDestroy$ = (session as WillDestroySession).willDestroy$;
    if (!willDestroy$) {
      return;
    }
    const sub = willDestroy$.pipe(takeUntil(this.destroyed$)).subscribe(() => {
      this.states.delete(session);
      this.destroySubs.get(session)?.unsubscribe();
      this.destroySubs.delete(session);
      if (this.activeSession === session) {
        this.activeSession = null;
        this.hasSSH = false;
        this.stats = null;
        this.cpuHistory = [];
        this.detect();
      }
    });
    this.destroySubs.set(session, sub);
  }

  // --- polling (active session only) ---

  private async poll(): Promise<void> {
    const session = this.activeSession;
    if (!session || this.busy) {
      return;
    }
    this.busy = true;
    try {
      const raw = await runStatsCommand(session, buildStatsCommand(), this.intervalMs - 200);
      // The active session may have changed while awaiting; discard stale results.
      if (!this.alive || this.activeSession !== session) {
        return;
      }
      const state = this.ensureState(session);
      if (raw == null) {
        // Keep last values; show "unavailable" only if we never got data for this session.
        if (!state.last) {
          this.stats = { ...EMPTY_UNAVAILABLE };
          this.detect();
        }
        return;
      }
      const parsed = parseStats(raw, state.prevCpu);
      if (parsed.cpuSample) {
        state.prevCpu = parsed.cpuSample;
      }
      if (parsed.cpuPct != null) {
        state.cpuHistory = [...state.cpuHistory, parsed.cpuPct].slice(-HISTORY_MAX);
      }
      state.last = parsed;
      this.stats = parsed;
      this.cpuHistory = state.cpuHistory;
      this.detect();
    } finally {
      this.busy = false;
    }
  }

  // --- view helpers ---

  // Trusted inner-SVG for the detected OS rendered height-14/width-auto (so wide wordmark
  // logos stay legible), or null so the template shows the fa-server fallback. Cached per slug.
  osIconHtml(): SafeHtml | null {
    const id = this.stats?.osId;
    if (!id) {
      return null;
    }
    const ic = OS_ICONS[id];
    if (!ic) {
      return null;
    }
    let html = this.iconHtmlCache.get(id);
    if (!html) {
      const color = ic.color ? `color:${ic.color};` : '';
      const svg = `<svg viewBox="${ic.viewBox}" style="height:14px;width:auto;display:block;${color}" aria-hidden="true">${ic.inner}</svg>`;
      html = this.sanitizer.bypassSecurityTrustHtml(svg);
      this.iconHtmlCache.set(id, html);
    }
    return html;
  }

  uptime(): string {
    const sec = this.stats?.uptimeSec;
    return sec == null ? '–' : formatUptime(sec);
  }

  mem(): string {
    return this.stats?.mem ? formatMemPair(this.stats.mem) : '–';
  }

  cpuClass(): Severity {
    return severityOf(this.stats?.cpuPct ?? null);
  }

  memClass(): Severity {
    return this.stats?.mem ? severityOf(memPercent(this.stats.mem)) : 'normal';
  }

  diskClass(pct: number): Severity {
    return severityOf(pct);
  }

  // CPU sparkline geometry (pure math in logic/sparkline.ts). Cached per cpuHistory array
  // reference so the four template bindings recompute it at most once per change-detection pass
  // (cpuHistory is reassigned with a fresh array on every poll). A single sample renders as a flat
  // line so the chart appears on the first reading (CPU% needs two /proc/stat samples to exist).
  private sparkCache?: { src: number[]; line: string; area: string; dot: Point };

  private spark(): { line: string; area: string; dot: Point } {
    if (!this.sparkCache || this.sparkCache.src !== this.cpuHistory) {
      const pts = sparkPoints(this.cpuHistory, SPARK_W, SPARK_H, SPARK_PAD, HISTORY_MAX);
      const line = smoothPath(pts);
      const dot = pts[pts.length - 1] ?? { x: 0, y: SPARK_H };
      this.sparkCache = { src: this.cpuHistory, line, area: areaPath(line, pts, SPARK_H), dot };
    }
    return this.sparkCache;
  }

  sparkLine(): string {
    return this.spark().line;
  }

  sparkArea(): string {
    return this.spark().area;
  }

  sparkDotX(): number {
    return this.spark().dot.x;
  }

  sparkDotY(): number {
    return this.spark().dot.y;
  }

  // Fade an edge only while content overflows and we are not pinned to it: left fade once
  // scrolled off the start, right fade until scrolled to the end. Layout-only reads, toggling
  // a class that changes the mask (never the box size) so this can't loop.
  updateFade(): void {
    const el = this.ssbRef?.nativeElement;
    let left = false;
    let right = false;
    if (el && el.scrollWidth - el.clientWidth > 1) {
      left = el.scrollLeft > 1;
      right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    }
    if (left !== this.fadeLeft || right !== this.fadeRight) {
      this.fadeLeft = left;
      this.fadeRight = right;
      if (this.alive) {
        this.cdr.detectChanges();
      }
    }
  }

  private detect(): void {
    if (this.alive) {
      this.cdr.detectChanges();
      // Recompute after content changes (e.g. disks appearing) grow/shrink scrollWidth.
      this.updateFade();
    }
  }
}
