import {
  Injectable,
  ComponentFactoryResolver,
  ApplicationRef,
  Injector,
  EmbeddedViewRef,
  ComponentRef,
} from '@angular/core';
import { ConfigService } from 'tabby-core';
import { SidebarHostComponent } from '../components/sidebarHost.component';
import { anyRailItemEnabled, enabledInnerTabs } from '../logic/tabsConfig';

const MIN_WIDTH = 180;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 280;

export type InnerTab = 'sessions' | 'sftp' | 'macros';

interface MobaxSidebarStore {
  collapsed: boolean;
  width: number;
  expandedGroups: string[];
}

/**
 * Owns the single fragile coupling to Tabby's layout: it inserts the sidebar
 * host component as the first child of <app-root> and flips app-root to a
 * horizontal flex container. All DOM manipulation lives here.
 */
@Injectable({ providedIn: 'root' })
export class SidebarService {
  private ref: ComponentRef<SidebarHostComponent> | null = null;
  private wrapper: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private _mounted = false;
  // Per-tab "follow pinned" memory, keyed on the same SSH-leaf identity object the inner-tab
  // memory uses (sidebarTabContext.key). In-memory only and never persisted — the entry drops
  // when the tab/leaf is GC'd. Held here (not in sftpTab) because the SFTP tab component is
  // *ngIf'd in/out and re-created on every inner-tab switch, which would otherwise reset pinned.
  private followPinMemory = new WeakMap<object, boolean>();

  constructor(
    private cfr: ComponentFactoryResolver,
    private appRef: ApplicationRef,
    private injector: Injector,
    private config: ConfigService,
  ) {}

  private get store(): MobaxSidebarStore {
    return this.config.store.mobaxSidebar;
  }

  get width(): number {
    return this.store?.width ?? DEFAULT_WIDTH;
  }

  /** The remembered "follow pinned" state for a tab key, or undefined if the tab is new. */
  getFollowPin(key: object): boolean | undefined {
    return this.followPinMemory.get(key);
  }

  /** Record a tab's "follow pinned" state so an *ngIf re-create of the SFTP tab can restore it. */
  setFollowPin(key: object, pinned: boolean): void {
    this.followPinMemory.set(key, pinned);
  }

  // The sidebar is mounted while any rail item is enabled; when all four toggles are off it is
  // removed entirely (terminal goes full-width). Re-evaluated live on every config change.
  initialize(): void {
    this.applyVisibility();
    this.config.changed$.subscribe(() => this.applyVisibility());
  }

  private applyVisibility(): void {
    const enabled = anyRailItemEnabled(this.config.store.mobaxSidebar?.tabs);
    if (enabled && !this._mounted) {
      this.show();
    } else if (!enabled && this._mounted) {
      this.hide();
    }
    // Staying mounted with no inner tab enabled (only the tmux action) must still render rail-only;
    // otherwise the empty content pane lingers at the expanded width with no inner-tab icon to
    // click to collapse it.
    if (this._mounted) {
      this.applyEffectiveWidth();
    }
  }

  hide(): void {
    if (!this._mounted) {
      return;
    }
    this.destroy();
    this._mounted = false;
  }

  show(): void {
    if (this._mounted) {
      return;
    }
    this.create();
    this._mounted = true;
  }

  setWidth(px: number): void {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
    if (this.wrapper) {
      this.wrapper.style.width = `${clamped}px`;
      this.wrapper.style.flex = `0 0 ${clamped}px`;
    }
    this.persist({ width: clamped });
  }

  // Collapsed: shrink the wrapper to the rail's intrinsic width (content is *ngIf'd out by
  // the host). Expanded: restore the stored width. The expanded width is left untouched.
  applyCollapsed(collapsed: boolean): void {
    if (this.wrapper) {
      this.applyWrapperWidth(this.wrapper, collapsed);
    }
    this.persist({ collapsed });
  }

  // Rail-only width when no inner tab is enabled (only the tmux action remains), otherwise the
  // user's collapsed preference. Width-only — never persists `collapsed`, so re-enabling an inner
  // tab restores the user's real expanded/collapsed choice.
  private applyEffectiveWidth(): void {
    if (!this.wrapper) {
      return;
    }
    const noInnerTab = enabledInnerTabs(this.config.store.mobaxSidebar?.tabs).length === 0;
    this.applyWrapperWidth(this.wrapper, (this.store?.collapsed ?? false) || noInnerTab);
  }

  private applyWrapperWidth(wrapper: HTMLElement, collapsed: boolean): void {
    if (collapsed) {
      wrapper.style.width = 'auto';
      wrapper.style.flex = '0 0 auto';
    } else {
      const w = this.width;
      wrapper.style.width = `${w}px`;
      wrapper.style.flex = `0 0 ${w}px`;
    }
  }

  private create(): void {
    const factory = this.cfr.resolveComponentFactory(SidebarHostComponent);
    this.ref = factory.create(this.injector);
    this.ref.instance.service = this;
    this.appRef.attachView(this.ref.hostView);
    const dom = (this.ref.hostView as EmbeddedViewRef<unknown>).rootNodes[0] as HTMLElement;

    const wrapper = document.createElement('div');
    wrapper.className = 'mobax-sidebar-wrapper';
    const w = this.width;
    wrapper.style.cssText = `
      width: ${w}px;
      flex: 0 0 ${w}px;
      display: flex;
      flex-direction: column;
      min-width: 0;
      position: relative;
      /* Stay transparent so tabby-background's fixed (position:fixed, z-index:-1/-2)
         backdrop — which already spans the whole viewport, sidebar included — shows
         through here exactly like it does in the main tab area. An opaque --bs-body-bg
         would mask it only over the sidebar. Inner widgets (inputs, drag previews) keep
         their own opaque fills. */
      background: transparent;
      border-right: 1px solid var(--bs-border-color, #333);
      z-index: 999;
    `;
    wrapper.appendChild(dom);

    const appRoot = document.querySelector('app-root');
    if (!appRoot) {
      console.error('[mobax-sidebar] app-root not found');
      return;
    }
    appRoot.insertBefore(wrapper, appRoot.firstChild);
    this.wrapper = wrapper;

    // Honour the persisted collapsed state on mount, and force rail-only when no inner tab is
    // enabled (host renders content via *ngIf to match).
    this.applyEffectiveWidth();

    this.injectLayoutCSS();
    this.fixContentWidth(appRoot);
  }

  private destroy(): void {
    const appRoot = document.querySelector('app-root');
    if (appRoot) {
      this.restoreContentWidth(appRoot);
    }
    this.removeLayoutCSS();
    if (this.ref) {
      this.appRef.detachView(this.ref.hostView);
      this.ref.destroy();
      this.ref = null;
    }
    if (this.wrapper) {
      this.wrapper.remove();
      this.wrapper = null;
    }
  }

  private injectLayoutCSS(): void {
    const style = document.createElement('style');
    style.id = 'mobax-sidebar-layout-css';
    style.textContent = `
      app-root {
        display: flex !important;
        flex-direction: row !important;
        width: 100vw !important;
        height: 100vh !important;
        overflow: hidden !important;
      }
      app-root > .content,
      app-root > div.content,
      app-root > [class*="content"] {
        flex: 1 1 auto !important;
        width: 0 !important;
        max-width: 100% !important;
        min-width: 0 !important;
      }
    `;
    document.head.appendChild(style);
    this.styleEl = style;
  }

  private removeLayoutCSS(): void {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  private fixContentWidth(appRoot: Element): void {
    const el = this.contentEl(appRoot);
    if (el) {
      el.style.width = 'auto';
      el.style.flex = '1 1 auto';
      el.style.minWidth = '0';
    }
  }

  private restoreContentWidth(appRoot: Element): void {
    const el = this.contentEl(appRoot);
    if (el) {
      el.style.removeProperty('width');
      el.style.removeProperty('flex');
      el.style.removeProperty('min-width');
    }
  }

  // Tabby nests two `.content` elements; the deeper one holds the tab area.
  private contentEl(appRoot: Element): HTMLElement | null {
    const els = appRoot.querySelectorAll('.content');
    if (els.length > 1) {
      return els[1] as HTMLElement;
    }
    if (els.length === 1) {
      return els[0] as HTMLElement;
    }
    return null;
  }

  private persist(patch: Partial<MobaxSidebarStore>): void {
    // Tabby's ConfigProxy exposes object-valued keys (mobaxSidebar) as getter-only and only
    // leaf keys (width/visible/...) as writable. So mutate the leaves in place instead of
    // reassigning the whole node (which throws "has only a getter").
    Object.assign(this.config.store.mobaxSidebar, patch);
    this.config.save();
  }
}
