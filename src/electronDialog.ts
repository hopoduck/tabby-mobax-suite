// Minimal structural type for the Electron `dialog` main module reached via @electron/remote,
// so we avoid an electron type dependency (electron is an external).
export interface RemoteDialog {
  showSaveDialog(opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(opts: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

/** Reach Electron's main-process `dialog` via @electron/remote's getBuiltin (NOT require('electron')). */
export function getRemoteDialog(): RemoteDialog | null {
  try {
    const nodeRequire = (window as unknown as { nodeRequire?: (id: string) => unknown })
      .nodeRequire;
    if (!nodeRequire) {
      return null;
    }
    const remote = nodeRequire('@electron/remote') as
      | { getBuiltin?: (name: string) => unknown }
      | undefined;
    return (remote?.getBuiltin?.('dialog') as RemoteDialog | undefined) ?? null;
  } catch {
    return null;
  }
}
