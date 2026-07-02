import { Injectable } from '@angular/core';
import { SettingsTabProvider } from 'tabby-settings';
import { MobaxSettingsTabComponent } from './components/mobaxSettingsTab.component';

@Injectable()
export class MobaxSettingsTabProvider extends SettingsTabProvider {
  id = 'mobax-sidebar';
  icon = 'columns';
  title = 'MobaX Suite';
  weight = 10;
  prioritized = false;

  getComponentType(): typeof MobaxSettingsTabComponent {
    return MobaxSettingsTabComponent;
  }
}
