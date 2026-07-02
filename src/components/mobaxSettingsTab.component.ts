import { existsSync } from 'fs';
import { Component } from '@angular/core';
import { ConfigService } from 'tabby-core';
import { getRemoteDialog } from '../electronDialog';
import { matchPreset, resolvePresets, PresetId } from '../logic/editorPresets';

type TabKey = 'sessions' | 'sftp' | 'macros' | 'tmux' | 'reload';

@Component({
  selector: 'mobax-settings-tab',
  template: `
    <div class="content-box">
      <h3>사이드바 탭</h3>
      <p class="hint">
        레일에 표시할 항목을 선택합니다. 끄면 아이콘이 숨겨지고, 해당 기능의 서버 프로브/폴링도
        전송되지 않습니다.
      </p>
      <div class="form-row">
        <toggle [ngModel]="tabs.sessions" (ngModelChange)="setTab('sessions', $event)"></toggle>
        Sessions
      </div>
      <div class="form-row">
        <toggle [ngModel]="tabs.sftp" (ngModelChange)="setTab('sftp', $event)"></toggle>
        SFTP
      </div>
      <div class="form-row">
        <toggle [ngModel]="tabs.macros" (ngModelChange)="setTab('macros', $event)"></toggle>
        매크로
      </div>
      <div class="form-row">
        <toggle [ngModel]="tabs.tmux" (ngModelChange)="setTab('tmux', $event)"></toggle>
        tmux 버튼
      </div>
      <p class="hint text-warning" *ngIf="!anyTab">탭을 모두 끄면 사이드바가 완전히 숨겨집니다.</p>

      <div class="form-row">
        <toggle [ngModel]="tabs.reload" (ngModelChange)="setTab('reload', $event)"></toggle>
        새로고침 버튼 (Tabby 리로드)
      </div>
      <p class="hint">
        레일 맨 아래에 Tabby 창을 새로고침하는 버튼을 추가합니다. 누르면 바로 리로드되어, 빌드된
        플러그인이 다시 적용됩니다. 접속 중인 SSH 세션은 끊겼다가 재연결됩니다. (기본 꺼짐)
      </p>

      <h3 class="section">상태바</h3>
      <div class="form-row">
        <toggle [ngModel]="statusBarEnabled" (ngModelChange)="setStatusBarEnabled($event)"></toggle>
        하단 서버 통계바 표시
      </div>
      <div class="form-row" [class.disabled]="!statusBarEnabled">
        <span>폴링 주기(초)</span>
        <input
          type="number"
          min="1"
          class="form-control interval"
          [disabled]="!statusBarEnabled"
          [ngModel]="intervalSeconds"
          (ngModelChange)="setInterval($event)"
        />
      </div>

      <h3 class="section">SFTP</h3>
      <div class="form-row">
        <span>기본 에디터</span>
        <select
          class="form-control preset-select"
          [ngModel]="selectedPreset"
          (ngModelChange)="applyPreset($event)"
        >
          <option value="notepad">메모장 (기본)</option>
          <option value="notepadpp" [disabled]="presetMissing('notepadpp')">
            Notepad++{{ presetMissing('notepadpp') ? ' (설치 안됨)' : '' }}
          </option>
          <option value="vscode" [disabled]="presetMissing('vscode')">
            VS Code{{ presetMissing('vscode') ? ' (설치 안됨)' : '' }}
          </option>
          <option value="custom" disabled>직접 지정</option>
        </select>
      </div>
      <div class="form-row">
        <input
          type="text"
          class="form-control editor-path"
          placeholder="비워두면 메모장(notepad)"
          [ngModel]="editorPath"
          (ngModelChange)="setEditorPath($event)"
        />
        <button class="btn btn-secondary" (click)="browseEditor()">찾아보기</button>
      </div>
      <p class="hint">
        SFTP 목록에서 파일을 열 때 사용할 프로그램입니다(.exe 실행 파일만 지원). 이미지·압축
        파일 등 바이너리 확장자는 OS 기본 프로그램으로 열립니다.
      </p>

      <h3 class="section">자동 잠금 해제</h3>
      <auto-unlock-settings-tab></auto-unlock-settings-tab>
    </div>
  `,
  styles: [
    `
      .content-box {
        padding: 16px;
        max-width: 640px;
      }
      h3.section {
        margin-top: 24px;
      }
      .hint {
        opacity: 0.7;
        font-size: 12px;
        margin: 4px 0 12px;
      }
      .form-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0;
      }
      .form-row.disabled {
        opacity: 0.5;
      }
      /* Tabby's <toggle> floats its switch inside a block .form-check, which collapses to zero
         height and drops the switch below the row's centre; it also keeps ~0.5em of empty space and
         a 10px host right-padding before the label. Re-lay .form-check as a centered flex row (no
         float, no padding) and drop the host right-padding so only the row gap spaces the label. */
      .form-row ::ng-deep toggle {
        padding-right: 0;
      }
      .form-row ::ng-deep .form-check {
        display: flex;
        align-items: center;
        margin: 0;
        min-height: 0;
        padding: 0;
      }
      .form-row ::ng-deep .form-check-input {
        float: none;
        margin: 0;
      }
      .interval {
        width: 80px;
      }
      .editor-path {
        flex: 1;
      }
      .preset-select {
        flex: 1;
      }
      .text-warning {
        color: var(--mobax-warning);
      }
      /* The embedded auto-unlock component renders its own .content-box with padding; strip the
         duplicated outer padding so the section aligns with the others. */
      auto-unlock-settings-tab ::ng-deep .content-box {
        padding: 0;
      }
    `,
  ],
})
export class MobaxSettingsTabComponent {
  constructor(private config: ConfigService) {}

  get tabs(): {
    sessions: boolean;
    sftp: boolean;
    macros: boolean;
    tmux: boolean;
    reload: boolean;
  } {
    return (
      this.config.store.mobaxSidebar?.tabs ?? {
        sessions: true,
        sftp: true,
        macros: true,
        tmux: true,
        reload: false,
      }
    );
  }

  get anyTab(): boolean {
    const t = this.tabs;
    return t.sessions || t.sftp || t.macros || t.tmux;
  }

  setTab(key: TabKey, val: boolean): void {
    // tabs is a nested object on the ConfigProxy; its boolean leaves are writable in place.
    Object.assign(this.config.store.mobaxSidebar.tabs, { [key]: val });
    this.config.save();
  }

  get statusBarEnabled(): boolean {
    return this.config.store.mobaxStatusBar?.enabled !== false;
  }

  setStatusBarEnabled(val: boolean): void {
    Object.assign(this.config.store.mobaxStatusBar, { enabled: val });
    this.config.save();
  }

  get intervalSeconds(): number {
    return this.config.store.mobaxStatusBar?.intervalSeconds ?? 3;
  }

  setInterval(val: number | string): void {
    const n = Math.max(1, Math.round(Number(val) || 3));
    Object.assign(this.config.store.mobaxStatusBar, { intervalSeconds: n });
    this.config.save();
  }

  // Resolved once at construction: settings-tab lifetime is short and an install mid-session is
  // an edge case not worth polling the filesystem for on every change-detection pass.
  private resolvedPresets = resolvePresets(
    process.env as Record<string, string | undefined>,
    existsSync,
  );

  get selectedPreset(): PresetId | 'custom' {
    return matchPreset(this.editorPath, this.resolvedPresets);
  }

  presetMissing(id: PresetId): boolean {
    return this.resolvedPresets[id] === null;
  }

  applyPreset(id: string): void {
    if (id === 'custom') {
      return; // display-only state, not an action
    }
    const path = this.resolvedPresets[id as PresetId];
    if (path === null || path === undefined) {
      return; // not installed (option is disabled anyway)
    }
    this.setEditorPath(path);
  }

  get editorPath(): string {
    return this.config.store.mobaxSftp?.editorPath ?? '';
  }

  setEditorPath(val: string): void {
    Object.assign(this.config.store.mobaxSftp, { editorPath: val });
    this.config.save();
  }

  async browseEditor(): Promise<void> {
    const dialog = getRemoteDialog();
    if (!dialog) {
      return;
    }
    const res = await dialog.showOpenDialog({
      title: '기본 에디터 선택',
      filters: [
        { name: '실행 파일', extensions: ['exe'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (!res.canceled && res.filePaths?.length) {
      this.setEditorPath(res.filePaths[0]);
    }
  }
}
