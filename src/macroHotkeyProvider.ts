import { Injectable } from '@angular/core';
import { HotkeyProvider, HotkeyDescription } from 'tabby-core';

@Injectable()
export class MacroHotkeyProvider extends HotkeyProvider {
  async provide(): Promise<HotkeyDescription[]> {
    return [{ id: 'mobax-macros:open', name: '매크로 팔레트 열기' }];
  }
}
