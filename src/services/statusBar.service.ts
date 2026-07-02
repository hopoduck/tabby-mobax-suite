import {
  Injectable,
  ComponentFactoryResolver,
  ApplicationRef,
  Injector,
  EmbeddedViewRef,
  ComponentRef,
} from '@angular/core';
import { ConfigService } from 'tabby-core';
import { ServerStatsBarComponent } from '../components/serverStatsBar.component';
import { findContentColumn } from '../dom/contentColumn';

/**
 * Injects the server-stats bar at the bottom of Tabby's terminal content column,
 * reflowing the column to a vertical flex so the tab area shrinks and the bar
 * pins to the bottom (terminal width, not full window). This is the only DOM
 * coupling for the status bar (mirrors SidebarService's approach).
 *
 * The reflow is done with an injected stylesheet + a marker class rather than
 * inline styles on each child, so tab-body elements Tabby adds later (new tabs /
 * splits) are covered automatically — otherwise a freshly created tab-body keeps
 * its full height and pushes the bar off-screen.
 */
@Injectable({ providedIn: 'root' })
export class StatusBarService {
  private ref: ComponentRef<ServerStatsBarComponent> | null = null;
  private barEl: HTMLElement | null = null;
  private column: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private _visible = false;
  private mountedIntervalSec: number | null = null;

  constructor(
    private cfr: ComponentFactoryResolver,
    private appRef: ApplicationRef,
    private injector: Injector,
    private config: ConfigService,
  ) {}

  initialize(): void {
    this.applyState();
    this.config.changed$.subscribe(() => this.applyState());
  }

  // Show/hide the bar to match `enabled`, and recreate it when the poll interval changes
  // (ServerStatsBarComponent samples intervalSeconds once in ngOnInit, so a live change needs a
  // fresh component). Disabling the bar destroys the component, which stops all stats exec polling.
  private applyState(): void {
    const enabled = this.config.store.mobaxStatusBar?.enabled !== false;
    const intervalSec = Math.max(1, Number(this.config.store.mobaxStatusBar?.intervalSeconds) || 3);
    if (!enabled) {
      if (this._visible) {
        this.hide();
      }
      this.mountedIntervalSec = null;
      return;
    }
    if (!this._visible) {
      this.show();
      this.mountedIntervalSec = intervalSec;
      return;
    }
    if (this.mountedIntervalSec !== intervalSec) {
      this.hide();
      this.show();
      this.mountedIntervalSec = intervalSec;
    }
  }

  show(): void {
    if (this._visible) {
      return;
    }
    const appRoot = document.querySelector('app-root');
    const column = appRoot ? findContentColumn(appRoot) : null;
    if (!column) {
      console.error('[mobax-statusbar] content column not found');
      return;
    }

    this.ref = this.cfr.resolveComponentFactory(ServerStatsBarComponent).create(this.injector);
    this.appRef.attachView(this.ref.hostView);
    const bar = (this.ref.hostView as EmbeddedViewRef<unknown>).rootNodes[0] as HTMLElement;

    // Mark the column and inject the reflow CSS: the tab-body area shrinks to make
    // room, our fixed-height bar pins to the bottom. The class survives tab-body churn.
    this.column = column;
    column.classList.add('mobax-statusbar-host');
    this.injectCSS();

    column.appendChild(bar);
    this.barEl = bar;
    this._visible = true;
  }

  hide(): void {
    if (!this._visible) {
      return;
    }
    this.column?.classList.remove('mobax-statusbar-host');
    this.styleEl?.remove();
    this.styleEl = null;
    if (this.ref) {
      this.appRef.detachView(this.ref.hostView);
      this.ref.destroy();
      this.ref = null;
    }
    this.barEl?.remove();
    this.barEl = null;
    this.column = null;
    this._visible = false;
  }

  private injectCSS(): void {
    const style = document.createElement('style');
    style.id = 'mobax-statusbar-css';
    // Tabby's tab-body panes are position:absolute filling the (position:relative) column,
    // so flex can't push our bar below them. Instead, shrink the panes' height by the bar's
    // 24px and absolutely-pin the bar to the bottom of the same column. The rules cover any
    // tab-body Tabby adds later (new tabs / splits).
    style.textContent = `
      .mobax-statusbar-host {
        position: relative !important;
      }
      .mobax-statusbar-host > *:not(server-stats-bar) {
        height: calc(100% - 28px) !important;
      }
      .mobax-statusbar-host > server-stats-bar {
        position: absolute !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        height: 28px !important;
        z-index: 10 !important;
      }
    `;
    document.head.appendChild(style);
    this.styleEl = style;
  }
}
