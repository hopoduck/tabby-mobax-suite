import { ConfigProvider } from 'tabby-core';

export class SidebarConfigProvider extends ConfigProvider {
  defaults = {
    mobaxSidebar: {
      collapsed: false,
      width: 280,
      expandedGroups: [],
      // Per-rail-item visibility toggles (settings tab). The four tab/action items default on; the
      // rail is hidden entirely only when all four are off. `reload` is an extra rail action (reload
      // the Tabby window) that defaults OFF and does not count toward the rail's mount decision.
      tabs: { sessions: true, sftp: true, macros: true, tmux: true, reload: false },
    },
    mobaxStatusBar: {
      enabled: true,
      intervalSeconds: 3,
    },
    // SFTP list behaviour. `editorPath` = program used to open text files from the list
    // ('' = notepad on Windows); known-binary extensions always use the OS association.
    mobaxSftp: {
      editorPath: '',
    },
    mobaxMacros: {
      list: [],
    },
    // Global, plain-text variables; ${name} tokens are substituted into macro command
    // steps at run time. Object-valued key → mutate the `list` leaf (ConfigProxy rule).
    mobaxVariables: {
      list: [],
    },
    // Single global hotkey to open the macro palette. Deep-merged into Tabby's
    // own hotkeys defaults by the config system.
    hotkeys: {
      'mobax-macros:open': ['Ctrl-Space'],
    },
  };
}

/** Wait this long after the last shell output before re-reading /proc cwd. */
export const PROC_FOLLOW_DEBOUNCE_MS = 120;
/** Safety-net poll interval for cwd changes that produce no terminal output. */
export const PROC_FOLLOW_SAFETY_POLL_MS = 4000;
/** If OSC reported a cwd within this window, defer to it and skip /proc. */
export const OSC_DEFER_WINDOW_MS = 1500;
