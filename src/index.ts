import { NgModule, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import TabbyCoreModule, {
  ConfigProvider,
  ConfigService,
  AppService,
  HotkeyProvider,
  HotkeysService,
  NotificationsService,
} from 'tabby-core';
import { SidebarConfigProvider } from './config';
import { SidebarService } from './services/sidebar.service';
import { StatusBarService } from './services/statusBar.service';
import { TransferService } from './services/transfer.service';
import { SidebarHostComponent } from './components/sidebarHost.component';
import { SessionsTabComponent } from './components/sessionsTab.component';
import { SftpTabComponent } from './components/sftpTab.component';
import { SftpFileListComponent } from './components/sftpFileList.component';
import { ServerStatsBarComponent } from './components/serverStatsBar.component';
import { MacrosTabComponent } from './components/macrosTab.component';
import { MacroPaletteComponent } from './components/macroPalette.component';
import { MacroPaletteService } from './services/macroPalette.service';
import { MacroHotkeyProvider } from './macroHotkeyProvider';
import { SettingsTabProvider } from 'tabby-settings';
import { installVaultAutoUnlock, setNotifier } from './services/vaultAutoUnlock';
import { injectThemeTokens } from './themeTokens';
import { MobaxSettingsTabProvider } from './mobaxSettingsTabProvider';
import { MobaxSettingsTabComponent } from './components/mobaxSettingsTab.component';
import { AutoUnlockSettingsTabComponent } from './components/autoUnlockSettingsTab.component';
import { VariablesTabComponent } from './components/variablesTab.component';
import { FolderIconPickerComponent } from './components/folderIconPicker.component';

// Install the vault auto-unlock wrap at plugin require time — before Angular
// bootstraps and constructs VaultService (see services/vaultAutoUnlock.ts).
installVaultAutoUnlock();

// Define plugin-scoped semantic status color tokens (--mobax-success/warning/danger) at require
// time so they exist before any component mounts (see themeTokens.ts).
injectThemeTokens();

@Injectable()
export class SidebarBootstrap {
  constructor(
    private sidebar: SidebarService,
    private statusBar: StatusBarService,
    private app: AppService,
    private palette: MacroPaletteService,
    private hotkeys: HotkeysService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {
    setNotifier((msg) => this.notifications.error(msg));
    this.app.ready$.subscribe(() => {
      setTimeout(() => {
        this.sidebar.initialize();
        this.statusBar.initialize();
        this.palette.mount();
      }, 1000);
    });
    this.hotkeys.hotkey$.subscribe((id) => {
      if (id === 'mobax-macros:open') {
        if (this.config.store.mobaxSidebar?.tabs?.macros === false) {
          this.notifications.notice('매크로 탭이 꺼져 있습니다');
          return;
        }
        this.palette.toggle();
      }
    });
  }
}

@NgModule({
  // Import tabby-core's default-exported module so its exported components (<checkbox>, <toggle>,
  // …) resolve in our JIT-compiled inline templates — the same way first-party plugins
  // (tabby-settings) pull them in. AppModule declares no providers, so no duplication.
  imports: [CommonModule, FormsModule, DragDropModule, TabbyCoreModule],
  providers: [
    { provide: ConfigProvider, useClass: SidebarConfigProvider, multi: true },
    { provide: HotkeyProvider, useClass: MacroHotkeyProvider, multi: true },
    { provide: SettingsTabProvider, useClass: MobaxSettingsTabProvider, multi: true },
    SidebarService,
    StatusBarService,
    MacroPaletteService,
    TransferService,
    SidebarBootstrap,
  ],
  declarations: [
    SidebarHostComponent,
    SessionsTabComponent,
    SftpTabComponent,
    SftpFileListComponent,
    ServerStatsBarComponent,
    MacrosTabComponent,
    MacroPaletteComponent,
    AutoUnlockSettingsTabComponent,
    MobaxSettingsTabComponent,
    VariablesTabComponent,
    FolderIconPickerComponent,
  ],
})
export default class MobaxSidebarModule {
  constructor(_bootstrap: SidebarBootstrap) {}
}
