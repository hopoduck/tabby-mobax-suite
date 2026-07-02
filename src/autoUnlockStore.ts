// DPAPI-encrypted master-passphrase store for vault auto-unlock.
// The ciphertext lives in localStorage (outside the encrypted config.yaml);
// Electron safeStorage (Windows DPAPI) protects it, keyed to the OS user.

const STORAGE_KEY = 'mobaxAutoUnlock';

interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

// safeStorage is a main-process module — reach it from the renderer via @electron/remote.
// Use getBuiltin('safeStorage'), NOT require('electron'): in this Tabby the remote
// `require` path throws "process.mainModule.require is not a function" (bundled main),
// while getBuiltin uses a separate IPC path that works.
function getSafeStorage(): SafeStorage | null {
  try {
    const nodeRequire = (window as unknown as { nodeRequire?: (id: string) => unknown })
      .nodeRequire;
    if (!nodeRequire) {
      return null;
    }
    const remote = nodeRequire('@electron/remote') as
      | { getBuiltin?: (name: string) => unknown }
      | undefined;
    return (remote?.getBuiltin?.('safeStorage') as SafeStorage | undefined) ?? null;
  } catch {
    return null;
  }
}

/** True only when secrets can be encrypted at rest on this platform. */
export function isAvailable(): boolean {
  const ss = getSafeStorage();
  try {
    return !!ss && ss.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Presence of a stored passphrase == feature enabled. */
export function hasStoredPassphrase(): boolean {
  try {
    return !!window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Encrypt + persist. Throws if safeStorage is unavailable (never store plaintext). */
export function savePassphrase(passphrase: string): void {
  const ss = getSafeStorage();
  if (!ss || !ss.isEncryptionAvailable()) {
    throw new Error('safeStorage unavailable');
  }
  const encrypted = ss.encryptString(passphrase);
  window.localStorage.setItem(STORAGE_KEY, Buffer.from(encrypted).toString('base64'));
}

/** Decrypt the stored passphrase, or null if missing/undecryptable. */
export function loadPassphrase(): string | null {
  let b64: string | null;
  try {
    b64 = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!b64) {
    return null;
  }
  const ss = getSafeStorage();
  if (!ss) {
    return null;
  }
  try {
    return ss.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

export function clearPassphrase(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
