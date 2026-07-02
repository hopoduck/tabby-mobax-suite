import { Component } from '@angular/core';
import { VaultService, NotificationsService } from 'tabby-core';
import {
  isAvailable,
  hasStoredPassphrase,
  savePassphrase,
  clearPassphrase,
} from '../autoUnlockStore';
import { resetFailureState } from '../services/vaultAutoUnlock';

@Component({
  selector: 'auto-unlock-settings-tab',
  template: `
    <div class="content-box">
      <h3>마스터 비번 자동 잠금 해제</h3>

      <p *ngIf="!vaultEnabled" class="text-warning">
        설정 암호화(Vault)가 켜져 있지 않습니다. 이 기능은 마스터 비번이 설정된 경우에만 동작합니다.
      </p>
      <p *ngIf="vaultEnabled && !available" class="text-warning">
        이 환경에서는 안전한 저장(safeStorage)을 사용할 수 없어 자동 잠금 해제를 쓸 수 없습니다.
      </p>
      <p *ngIf="vaultEnabled && available">
        상태: <strong>{{ stored ? '저장됨 — 시작 시 자동 잠금 해제' : '미설정' }}</strong>
      </p>

      <div class="warn-box" *ngIf="vaultEnabled && available">
        ⚠ 보안 주의: 자동 잠금 해제를 켜면 시작할 때 마스터 비번을 묻지 않고 Vault가 열립니다. 비번은
        이 PC의 Windows 계정으로만 복호화되도록 암호화 저장되지만, 잠금하지 않은 공용 PC에서는 다른
        사람이 저장된 SSH 접속 정보를 그대로 쓸 수 있습니다.
        <strong>개인 PC에서만 사용하세요.</strong>
      </div>

      <div class="form-line" *ngIf="vaultEnabled && available">
        <div class="header">
          <div class="title">마스터 비번</div>
          <div class="description">
            저장 전에 검증합니다. 이 PC의 Windows 계정으로만 복호화됩니다.
          </div>
        </div>
        <input
          type="password"
          class="form-control"
          [(ngModel)]="passphrase"
          placeholder="마스터 비번 입력"
        />
      </div>

      <div class="buttons" *ngIf="vaultEnabled && available">
        <button class="btn btn-primary" [disabled]="!passphrase" (click)="save()">저장</button>
        <button class="btn btn-secondary" [disabled]="!stored" (click)="clear()">초기화</button>
      </div>
    </div>
  `,
  styles: [
    `
      .content-box {
        padding: 16px;
        max-width: 640px;
      }
      .form-line {
        margin: 12px 0;
      }
      .form-line .description {
        opacity: 0.7;
        font-size: 12px;
      }
      .buttons {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      .text-warning {
        color: var(--mobax-warning);
      }
      .warn-box {
        margin: 12px 0;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--mobax-danger) 50%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--mobax-danger) 8%, transparent);
        color: var(--mobax-danger);
        font-size: 12px;
        line-height: 1.5;
      }
    `,
  ],
})
export class AutoUnlockSettingsTabComponent {
  passphrase = '';

  constructor(
    private vault: VaultService,
    private notifications: NotificationsService,
  ) {}

  get available(): boolean {
    return isAvailable();
  }

  get vaultEnabled(): boolean {
    return this.vault.isEnabled();
  }

  get stored(): boolean {
    return hasStoredPassphrase();
  }

  async save(): Promise<void> {
    if (!this.vault.isEnabled() || !this.vault.store) {
      this.notifications.error('설정 암호화(Vault)가 켜져 있지 않아 저장할 수 없습니다.');
      return;
    }
    if (!isAvailable()) {
      this.notifications.error('이 환경에서는 안전한 저장(safeStorage)을 쓸 수 없습니다.');
      return;
    }
    try {
      await this.vault.decrypt(this.vault.store, this.passphrase);
    } catch {
      this.notifications.error('마스터 비번이 맞지 않습니다.');
      return;
    }
    try {
      savePassphrase(this.passphrase);
    } catch {
      this.notifications.error('비번 저장에 실패했습니다.');
      return;
    }
    resetFailureState();
    this.passphrase = '';
    this.notifications.notice('자동 잠금 해제 비번을 저장했습니다.');
  }

  clear(): void {
    clearPassphrase();
    resetFailureState();
    this.notifications.notice('저장된 자동 잠금 해제 비번을 삭제했습니다.');
  }
}
