import { VaultService } from 'tabby-core';
import { decideUnlock } from '../logic/autoUnlock';
import { hasStoredPassphrase, loadPassphrase, clearPassphrase } from '../autoUnlockStore';

type GetPassphrase = (...args: unknown[]) => Promise<string>;
type Decrypt = (...args: unknown[]) => Promise<unknown>;
type Patchable = { getPassphrase: GetPassphrase; decrypt: Decrypt };

let installed = false;
let originalGetPassphrase: GetPassphrase | null = null;
let originalDecrypt: Decrypt | null = null;

let cachedPassphrase: string | null = null;
let lastFailed = false;
let awaitingVerification = false;
let notifier: ((msg: string) => void) | null = null;

/** Wire a user-visible notifier (set once the Angular layer is up). */
export function setNotifier(fn: (msg: string) => void): void {
  notifier = fn;
}

/** Re-enable supplying after the settings UI stores a fresh passphrase. */
export function resetFailureState(): void {
  lastFailed = false;
  cachedPassphrase = null;
  awaitingVerification = false;
}

export function installVaultAutoUnlock(): void {
  if (installed) {
    return;
  }
  const proto = VaultService.prototype as unknown as Patchable;
  originalGetPassphrase = proto.getPassphrase;
  originalDecrypt = proto.decrypt;

  proto.getPassphrase = function (this: Patchable, ...args: unknown[]): Promise<string> {
    const decision = decideUnlock({ hasStored: hasStoredPassphrase(), lastFailed });
    if (decision === 'supply') {
      const pass = cachedPassphrase ?? loadPassphrase();
      if (pass != null) {
        cachedPassphrase = pass;
        awaitingVerification = true;
        return Promise.resolve(pass);
      }
    }
    // Fall back to Tabby's real modal.
    awaitingVerification = false;
    return originalGetPassphrase!.apply(this, args);
  };

  proto.decrypt = function (this: Patchable, ...args: unknown[]): Promise<unknown> {
    return Promise.resolve(originalDecrypt!.apply(this, args)).then(
      (value) => {
        if (awaitingVerification) {
          awaitingVerification = false;
          lastFailed = false;
        }
        return value;
      },
      (err) => {
        if (awaitingVerification) {
          // The passphrase WE supplied was wrong → self-disable, clear, notify.
          awaitingVerification = false;
          lastFailed = true;
          cachedPassphrase = null;
          clearPassphrase();
          notifier?.(
            '자동 잠금 해제 비번이 더 이상 맞지 않아 해제되었습니다. 설정에서 다시 저장하세요.',
          );
        }
        throw err;
      },
    );
  };

  installed = true;
}

export function uninstallVaultAutoUnlock(): void {
  if (!installed) {
    return;
  }
  const proto = VaultService.prototype as unknown as Patchable;
  if (originalGetPassphrase) {
    proto.getPassphrase = originalGetPassphrase;
  }
  if (originalDecrypt) {
    proto.decrypt = originalDecrypt;
  }
  installed = false;
  resetFailureState();
}
