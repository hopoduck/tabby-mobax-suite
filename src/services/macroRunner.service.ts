import { Injectable } from '@angular/core';
import { AppService, ConfigService, NotificationsService } from 'tabby-core';
import { focusedLeaf } from '../logic/activeSession';
import { Macro, isTerminalLeaf, runMacro, TerminalLeafLike } from '../logic/macro';
import { buildVarMap, resolveMacroSteps } from '../logic/variables';

/**
 * Single entry point for executing a macro on whichever terminal tab is active.
 * Shared by the palette and the sidebar management tab. Global ${name} variables
 * are substituted into command steps here, just before the keystrokes are sent.
 */
@Injectable({ providedIn: 'root' })
export class MacroRunnerService {
  constructor(
    private app: AppService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  async run(macro: Macro): Promise<void> {
    const leaf = focusedLeaf(this.app.activeTab) as TerminalLeafLike | null;
    if (!isTerminalLeaf(leaf)) {
      this.notifications.notice('터미널 탭을 먼저 선택하세요');
      return;
    }
    const varMap = buildVarMap(this.config.store.mobaxVariables?.list ?? []);
    const steps = resolveMacroSteps(macro.steps, varMap);
    const send = (data: string): void => leaf!.sendInput!(data);
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    await runMacro(steps, { send, sleep });
  }
}
