# tabby-mobax-suite

English | [한국어](./README.ko.md)

**MobaX Suite** — a [Tabby](https://tabby.sh) plugin that adds a persistent, **MobaXterm-style left sidebar** plus a bottom **server-stats bar** to your terminal.

The sidebar is an always-mounted icon rail with three tabs and a tmux action:

- **Sessions** — saved SSH profiles (grouped); click to connect. Shows per-profile live-connection dots.
- **SFTP** — a self-built file browser bound to the active SSH tab that **live-follows** the shell's working dir (pin to freeze). Multi-select, drag-to-move, OS drag-out/drop upload, cut/paste move, inline rename, keyboard nav.
- **Macros** — saved keystroke/command macros, also a global **palette** (`Ctrl-Space`). Global or per-profile, with reusable **variables** (`${name}`) and JSON import/export.
- **tmux** (rail action) — enters tmux control-mode on the active SSH tab; shown only when `tabby-tmux` is installed.

Outside the rail: a **bottom status bar** (live CPU / memory / disk / uptime / sessions + OS logo for the active host) and a unified **settings tab** under Tabby's Settings.

## Compatibility

- Built against the `tabby-*` npm packages at **`1.0.231-nightly.0`** (Angular `15.2.6`, rxjs `7.5.7`). Tabby ships its plugin API to npm only as nightly builds, so this trails the desktop app's number — it runs fine on app `1.0.234`. These pins are build-time only; at runtime the host app supplies the real instances. If your Tabby is very different and the plugin won't load, rebuild against your versions (`pnpm build`).
- **Live cwd follow** needs the shell to report its dir via OSC 1337 `CurrentDir` (zsh example below); otherwise it falls back to `/proc/<pid>/cwd` over SFTP (Linux only).
  ```sh
  precmd () { echo -n "\x1b]1337;CurrentDir=$(pwd)\x07" }
  ```

## Security notes

- **Vault auto-unlock (opt-in).** Stores your vault master passphrase (encrypted via the OS keystore — Windows DPAPI / Electron `safeStorage`, never plaintext) to unlock the vault at startup. This **weakens** the master passphrase — anyone on your unlocked OS session can then read stored SSH secrets unprompted — so **don't enable it on a shared machine.** Clear the passphrase to disable.
- **Local drag-out helper.** "Drag a file to the desktop" runs a localhost-only HTTP server (`127.0.0.1`, random port) serving each file via a single-use token that expires after 60s.

## Install

Once published, install from Tabby's plugin manager (Settings → Plugins → search `tabby-mobax-suite`), then **restart Tabby** to load it.

## Build from source

```bash
pnpm install
pnpm build      # -> dist/index.js (webpack production)
pnpm watch      # rebuild on change
pnpm test       # pure-logic unit tests (vitest)
pnpm lint       # oxlint && eslint
```

### Dev install (link the local build)

Link the repo into Tabby's user plugins directory, then **restart Tabby**:

```powershell
New-Item -ItemType Junction -Path "$env:APPDATA\tabby\plugins\node_modules\tabby-mobax-suite" -Target "<path-to-this-repo>"
```

## Usage

- Click a rail icon to switch tabs; click the **active** icon to collapse the pane, again to expand. Width/collapsed state persist.
- **Sessions:** click a profile to connect; groups collapse/expand.
- **SFTP:** browses the active session and follows `cd` (toggle **터미널 폴더 따라가기** to freeze). Multi-select (Ctrl/Shift+click or marquee), move via drag-drop or `Ctrl+X`/`Ctrl+V`, rename `F2`, delete `Delete`. Drag a file out to export; drop OS files in to upload.
- **Macros:** create/edit/reorder, or press `Ctrl-Space` for the palette. Target a profile or all sessions; define variables in 변수 mode and use `${name}` in command steps; import/export as JSON.
- **Settings:** Settings → MobaX Suite — toggle rail items, the status bar + poll interval, and vault auto-unlock.

## License

[MIT](./LICENSE)
