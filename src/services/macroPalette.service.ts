import {
  Injectable,
  ComponentFactoryResolver,
  ApplicationRef,
  Injector,
  EmbeddedViewRef,
  ComponentRef,
} from '@angular/core';
import { MacroPaletteComponent } from '../components/macroPalette.component';

/**
 * Mounts a single MacroPaletteComponent overlay into <app-root> (mirrors
 * SidebarService's injection approach) and proxies open/close/toggle to it.
 */
@Injectable({ providedIn: 'root' })
export class MacroPaletteService {
  private ref: ComponentRef<MacroPaletteComponent> | null = null;

  constructor(
    private cfr: ComponentFactoryResolver,
    private appRef: ApplicationRef,
    private injector: Injector,
  ) {}

  mount(): void {
    if (this.ref) {
      return;
    }
    const factory = this.cfr.resolveComponentFactory(MacroPaletteComponent);
    this.ref = factory.create(this.injector);
    this.appRef.attachView(this.ref.hostView);
    const dom = (this.ref.hostView as EmbeddedViewRef<unknown>).rootNodes[0] as HTMLElement;
    const appRoot = document.querySelector('app-root');
    if (!appRoot) {
      console.error('[mobax-macros] app-root not found');
      return;
    }
    appRoot.appendChild(dom);
  }

  open(): void {
    this.ref?.instance.open();
  }

  close(): void {
    this.ref?.instance.close();
  }

  toggle(): void {
    this.ref?.instance.toggle();
  }
}
