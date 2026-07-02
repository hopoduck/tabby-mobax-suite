import { Injectable } from '@angular/core';
import { SettingsTabProvider } from 'tabby-settings';
import { AutoUnlockSettingsTabComponent } from './components/autoUnlockSettingsTab.component';

@Injectable()
export class AutoUnlockSettingsTabProvider extends SettingsTabProvider {
  id = 'mobax-auto-unlock';
  icon = 'unlock';
  title = '자동 잠금 해제';
  weight = 10;
  prioritized = false;

  getComponentType(): typeof AutoUnlockSettingsTabComponent {
    return AutoUnlockSettingsTabComponent;
  }
}
