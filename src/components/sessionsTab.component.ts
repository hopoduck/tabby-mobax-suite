import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ElementRef,
  ChangeDetectorRef,
} from '@angular/core';
import {
  ProfilesService,
  ConfigService,
  PartialProfile,
  Profile,
  PlatformService,
  MenuItemOptions,
  AppService,
} from 'tabby-core';
import { SettingsTabComponent } from 'tabby-settings';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Observable, Subject, Subscription, merge } from 'rxjs';
import { takeUntil, debounceTime, take } from 'rxjs/operators';
import { isExpanded, toggleExpanded } from '../logic/groupCollapse';
import { countLiveByProfile, dotCount, leavesOf } from '../logic/sessionStatus';
import { CdkDragDrop, transferArrayItem } from '@angular/cdk/drag-drop';

// Duck-typed shapes of the runtime bits we watch to keep the live-connection dots in sync. A
// terminal leaf re-emits sessionChanged$ on connect/disconnect/reconnect; the session itself
// signals teardown via closed$/destroyed$ and "now live" via its first output$.
interface WatchableSession {
  open?: boolean;
  closed$?: Observable<unknown>;
  destroyed$?: Observable<unknown>;
  output$?: Observable<unknown>;
}
interface WatchableLeaf {
  sessionChanged$?: Observable<unknown>;
  session?: WatchableSession | null;
}

const UNGROUPED_KEY = '__ungrouped__';
// Last-resort fallback icon, used only if a profile (and its group/provider defaults) resolve to
// no icon at all. Each provider normally supplies its own default (e.g. ssh → fas fa-desktop).
const DEFAULT_PROFILE_ICON = 'fas fa-desktop';

// How long a row's amber "connecting…" dot stays up if no live connection ever appears (the
// connection failed, was cancelled, or the profile never opens a session). The dot normally clears
// once the launched profile's live-connection count rises (see refreshConnections); this timeout is
// only the backstop so a row's connecting dot never lingers forever.
const LAUNCH_INDICATOR_TIMEOUT_MS = 30000;

// Minimum time the amber dot stays visible even if the session connects almost instantly (e.g. a
// reused/multiplexed connection just opening a new channel). Without this floor a fast connect flips
// the dot amber→green within a frame or two and reads as "instantly green" — no perceptible feedback.
const MIN_CONNECTING_VISIBLE_MS = 600;

interface ProfileNode {
  profile: PartialProfile<Profile>;
  name: string;
  subtitle: string;
  id: string;
  // Resolved icon (Font Awesome class string or raw SVG/HTML) and optional color, mirroring
  // Tabby's own ProfileIconComponent rendering.
  icon: string;
  color?: string;
}

interface FolderNode {
  key: string;
  name: string;
  icon?: string; // custom group icon (same semantics as a profile icon: FA class or raw HTML)
  profiles: ProfileNode[];
}

@Component({
  selector: 'sessions-tab',
  template: `
    <div class="mobax-sessions">
      <div class="mobax-toolbar">
        <button class="mobax-tool-btn" (click)="createGroup()" title="새 폴더">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M9.828 4a3 3 0 0 1-2.12-.879l-.83-.828A1 1 0 0 0 6.173 2H2.5a1 1 0 0 0-1 .981L1.546 4h-1L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3v1z"
            />
            <path
              d="M13.81 4H2.19a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4zM8.5 7a.5.5 0 0 0-1 0v1.5H6a.5.5 0 0 0 0 1h1.5V11a.5.5 0 0 0 1 0V9.5H10a.5.5 0 0 0 0-1H8.5V7z"
            />
          </svg>
        </button>
        <button
          class="mobax-tool-btn"
          (click)="renameSelected()"
          [disabled]="!canModifySelection"
          title="이름 수정"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"
            />
          </svg>
        </button>
        <button
          class="mobax-tool-btn"
          (click)="deleteSelected()"
          [disabled]="!canModifySelection"
          title="삭제"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"
            />
            <path
              d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3h11V2h-11v1z"
            />
          </svg>
        </button>
        <span class="mobax-toolbar-spacer"></span>
        <button
          class="mobax-tool-btn"
          (click)="openProfileSettings()"
          title="세션 관리 (Tabby 설정)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"
            />
          </svg>
        </button>
      </div>
      <div *ngIf="loading" class="mobax-hint">프로필 불러오는 중…</div>
      <div *ngIf="!loading && folders.length === 0" class="mobax-hint">
        저장된 SSH 프로필이 없습니다.
      </div>

      <div
        *ngFor="let folder of folders"
        class="mobax-folder"
        cdkDropList
        [id]="'mobax-folder-' + folder.key"
        [cdkDropListData]="folder"
        [cdkDropListConnectedTo]="dropListIds"
        [cdkDropListSortingDisabled]="true"
        (cdkDropListDropped)="onProfileDrop($event)"
      >
        <div
          class="mobax-folder-header"
          role="button"
          tabindex="0"
          [class.selected]="selectedFolderKey === folder.key"
          [attr.aria-expanded]="isExpanded(folder.key)"
          (click)="selectFolder(folder)"
          (dblclick)="toggleFolder(folder.key)"
          (keydown)="onFolderKeydown($event, folder)"
          (contextmenu)="onFolderContextMenu($event, folder)"
        >
          <span class="mobax-chevron-hit" (click)="toggleFromChevron($event, folder)">
            <svg
              class="mobax-chevron"
              [class.expanded]="isExpanded(folder.key)"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                d="M6 3.5 10.5 8 6 12.5"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <i
            *ngIf="folder.icon && !isSvgIcon(folder.icon)"
            class="mobax-folder-icon mobax-folder-icon-fa fa-fw"
            [ngClass]="folder.icon"
            aria-hidden="true"
          ></i>
          <span
            *ngIf="folder.icon && isSvgIcon(folder.icon)"
            class="mobax-folder-icon mobax-folder-icon-svg"
            [innerHTML]="iconHtml(folder.icon)"
            aria-hidden="true"
          ></span>
          <svg
            *ngIf="!folder.icon"
            class="mobax-folder-icon mobax-folder-icon-default"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              *ngIf="!isExpanded(folder.key)"
              d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3z"
            />
            <path
              *ngIf="isExpanded(folder.key)"
              d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v.64c.57.265.94.876.856 1.546l-.64 5.124A2.5 2.5 0 0 1 12.733 15H3.266a2.5 2.5 0 0 1-2.481-2.19l-.64-5.124A1.5 1.5 0 0 1 1 6.14V3.5zM2 6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.882 5.82 3.5 5.264 3.5H2.5a.5.5 0 0 0-.5.5V6z"
            />
          </svg>
          <ng-container *ngIf="renamingFolderKey === folder.key; else folderNameText">
            <input
              class="mobax-rename-input"
              #folderRenameInput
              [value]="folder.name"
              (click)="$event.stopPropagation()"
              (dblclick)="$event.stopPropagation()"
              (keydown.enter)="$event.stopPropagation(); commitFolderRename(folder, folderRenameInput.value)"
              (keydown.escape)="$event.stopPropagation(); cancelRename()"
              (blur)="commitFolderRename(folder, folderRenameInput.value)"
            />
          </ng-container>
          <ng-template #folderNameText>
            <span class="mobax-folder-name">{{ folder.name }}</span>
          </ng-template>
          <span class="mobax-folder-count">{{ folder.profiles.length }}</span>
        </div>

        <div *ngIf="isExpanded(folder.key)" class="mobax-folder-body">
          <div
            *ngFor="let node of folder.profiles"
            class="mobax-profile"
            cdkDrag
            [cdkDragData]="node"
            [cdkDragDisabled]="!node.id || renamingId === node.id"
            role="button"
            tabindex="0"
            [class.selected]="node.id !== '' && node.id === selectedId"
            [title]="node.subtitle"
            (click)="select(node)"
            (dblclick)="launch(node)"
            (keydown)="onProfileKeydown($event, node)"
            (contextmenu)="onProfileContextMenu($event, node)"
          >
            <i
              *ngIf="!isSvgIcon(node.icon); else svgIcon"
              class="mobax-profile-icon mobax-profile-icon-fa fa-fw"
              [ngClass]="node.icon"
              [class.has-color]="!!node.color"
              [style.color]="node.color || null"
              aria-hidden="true"
            ></i>
            <ng-template #svgIcon>
              <span
                class="mobax-profile-icon mobax-profile-icon-svg"
                [class.has-color]="!!node.color"
                [style.color]="node.color || null"
                [innerHTML]="iconHtml(node.icon)"
                aria-hidden="true"
              ></span>
            </ng-template>
            <ng-container *ngIf="renamingId !== null && node.id === renamingId; else nameText">
              <input
                class="mobax-rename-input"
                #renameInput
                [value]="node.name"
                (click)="$event.stopPropagation()"
                (dblclick)="$event.stopPropagation()"
                (keydown.enter)="$event.stopPropagation(); commitRename(node, renameInput.value)"
                (keydown.escape)="$event.stopPropagation(); cancelRename()"
                (blur)="commitRename(node, renameInput.value)"
              />
            </ng-container>
            <ng-template #nameText>
              <span class="mobax-profile-text">
                <span class="mobax-profile-name">{{ node.name }}</span>
                <span class="mobax-profile-host">{{ node.subtitle }}</span>
              </span>
            </ng-template>
            <span
              *ngIf="dots(node.id).length || isLaunching(node.id)"
              class="mobax-profile-dots"
              [title]="dotTitle(node.id)"
            >
              <span class="mobax-profile-dot" *ngFor="let d of dots(node.id)"></span>
              <span
                *ngIf="isLaunching(node.id)"
                class="mobax-profile-dot mobax-profile-dot-connecting"
              ></span>
            </span>
          </div>
        </div>
      </div>

      <folder-icon-picker
        *ngIf="iconPickerFolder"
        [folderName]="iconPickerFolder.name"
        [currentIcon]="iconPickerFolder.icon"
        (chosen)="onIconChosen($event)"
        (closed)="closeIconPicker()"
      ></folder-icon-picker>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .mobax-sessions {
        height: 100%;
        overflow: auto;
        /* No top padding so the opaque toolbar header sits flush at the top, aligning with
           Tabby's tab strip. */
        padding: 0 0 4px;
        user-select: none;
      }
      .mobax-hint {
        padding: 12px;
        opacity: 0.6;
      }
      .mobax-folder-header {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 8px;
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        text-align: left;
        outline: none;
      }
      .mobax-folder-header:hover {
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .mobax-folder-header:focus-visible {
        box-shadow: inset 2px 0 0 var(--bs-primary, #3b82f6);
      }
      .mobax-chevron-hit {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        padding: 3px;
        margin: -3px;
        cursor: pointer;
      }
      .mobax-chevron {
        width: 12px;
        height: 12px;
        flex: 0 0 auto;
        opacity: 0.7;
        transition: transform 0.12s ease;
      }
      .mobax-chevron.expanded {
        transform: rotate(90deg);
      }
      .mobax-folder-icon {
        width: 22px;
        height: 22px;
        flex: 0 0 auto;
        opacity: 0.8;
      }
      /* The default folder SVG fills its viewBox edge-to-edge, so at the full box size it reads
         one step larger than FA glyphs / images — inset it to ~16px drawn size inside the same
         20px box (padding keeps all three variants' boxes equal, so folder names stay aligned). */
      .mobax-folder-icon-default {
        padding: 3px;
        box-sizing: border-box;
      }
      .mobax-folder-icon-fa {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        line-height: 1;
      }
      .mobax-folder-icon-svg {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .mobax-folder-icon-svg ::ng-deep svg,
      .mobax-folder-icon-svg ::ng-deep img {
        height: 20px;
        width: auto;
        max-width: 22px;
        display: block;
      }
      .mobax-folder-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .mobax-folder-count {
        flex: 0 0 auto;
        font-size: 11px;
        opacity: 0.5;
        padding: 0 4px;
      }
      .mobax-folder-body {
        padding-bottom: 2px;
      }
      .mobax-profile {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        padding: 5px 10px 5px 42px;
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        text-align: left;
        outline: none;
      }
      .mobax-profile:hover {
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .mobax-profile.selected,
      .mobax-folder-header.selected {
        background: rgba(127, 127, 127, 0.26);
        background: color-mix(in srgb, currentColor 16%, transparent);
        box-shadow: inset 2px 0 0 var(--bs-primary, #3b82f6);
      }
      .mobax-profile:focus-visible {
        box-shadow: inset 2px 0 0 var(--bs-primary, #3b82f6);
      }
      .mobax-profile-icon {
        flex: 0 0 auto;
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: inherit;
        opacity: 0.7;
      }
      .mobax-profile-icon.has-color {
        opacity: 1;
      }
      .mobax-profile-icon-fa {
        font-size: 13px;
        line-height: 1;
      }
      .mobax-profile-icon-svg ::ng-deep svg,
      .mobax-profile-icon-svg ::ng-deep img {
        height: 14px;
        width: auto;
        max-width: 16px;
        display: block;
      }
      .mobax-profile-text {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-width: 0;
      }
      /* Live-connection dots, pushed to the row's trailing edge and overlapping like stacked
         coins (up to 3). Each is a glossy radial-gradient bead (top-left highlight) with a soft
         glow, reading as a lit LED; a thin 1px chrome-bg ring separates the overlaps. The 9px size
         with the unchanged -3px overlap leaves ~6px of each bead visible, so the stack stays legible
         without smudging together. Green = connected. */
      .mobax-profile-dots {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        margin-left: auto;
        padding-left: 6px;
      }
      .mobax-profile-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: radial-gradient(
          circle at 33% 28%,
          var(--mobax-success-hi),
          var(--mobax-success) 48%,
          var(--mobax-success-lo)
        );
        box-shadow:
          0 0 0 1px var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e)),
          0 0 5px color-mix(in srgb, var(--mobax-success) 50%, transparent);
      }
      .mobax-profile-dot + .mobax-profile-dot {
        margin-left: -3px;
      }
      /* Connecting: a pulsing amber bead in the same lane as the green connection dots, so a
         launched profile reads as "coming up" and turns green once its session connects. Cleared
         the moment the live-count rises (see refreshConnections) or after the backstop timeout.
         Colour is the fixed --mobax-warning token, not var(--bs-warning): the host theme can remap
         the Bootstrap token to a non-amber value (seen in the wild as #47ebb4, a mint green), which
         made the dot read as "connected" while still connecting. The plugin token keeps it distinct
         from the green connected dot regardless of theme. The compound selector also lifts
         specificity above the base dot, so it must restate the box-shadow in amber (otherwise the
         base rule's green glow bleeds through). Same 9px size as the connected bead; only opacity
         breathes via the pulse. */
      .mobax-profile-dot.mobax-profile-dot-connecting {
        background: radial-gradient(
          circle at 33% 28%,
          var(--mobax-warning-hi),
          var(--mobax-warning) 48%,
          var(--mobax-warning-lo)
        );
        box-shadow:
          0 0 0 1px var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e)),
          0 0 5px color-mix(in srgb, var(--mobax-warning) 50%, transparent);
        animation: mobax-dot-pulse 1.8s ease-in-out infinite;
      }
      @keyframes mobax-dot-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }
      .mobax-profile-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mobax-profile-host {
        font-size: 11px;
        opacity: 0.6;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mobax-rename-input {
        flex: 1 1 auto;
        min-width: 0;
        background: var(--bs-body-bg, #1e1e1e);
        color: inherit;
        border: 1px solid var(--bs-primary, #3b82f6);
        border-radius: 3px;
        padding: 1px 4px;
        font: inherit;
      }
      .mobax-toolbar {
        display: flex;
        align-items: center;
        gap: 2px;
        box-sizing: border-box;
        /* Match Tabby's tab strip height (--tabs-height = 38px * spaciness, inherited from
           app-root) so this panel header lines up with the main tab bar. */
        height: var(--tabs-height, 38px);
        padding: 0 6px;
        /* Pin the toolbar to the top of the scrolling .mobax-sessions container so it stays put
           while the folder list scrolls under it. The opaque chrome bg covers the rows passing
           behind it; no margin-bottom so no transparent gap lets a row peek through. */
        position: sticky;
        top: 0;
        z-index: 2;
        /* Opaque chrome bg (Tabby title/tab bar color) so tabby-background doesn't show through
           the header; the list below stays transparent and keeps showing the backdrop. */
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        border-bottom: 1px solid var(--bs-border-color, #333);
        /* Empty toolbar space acts as a window-drag handle, like the app title bar. Buttons opt
           back out with no-drag below, so they stay clickable. */
        -webkit-app-region: drag;
      }
      .mobax-tool-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 26px;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: inherit;
        opacity: 0.75;
        cursor: pointer;
        /* Opt out of the toolbar's window-drag region so clicks reach the button. */
        -webkit-app-region: no-drag;
      }
      .mobax-tool-btn:hover:not(:disabled) {
        opacity: 1;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .mobax-tool-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }
      .mobax-tool-btn svg {
        width: 15px;
        height: 15px;
      }
      .mobax-toolbar-spacer {
        flex: 1 1 auto;
      }
      .mobax-profile.cdk-drag {
        touch-action: none;
      }
      .cdk-drag-preview {
        display: flex;
        align-items: center;
        gap: 7px;
        box-sizing: border-box;
        padding: 5px 10px;
        border-radius: 4px;
        background: var(--bs-body-bg, #1e1e1e);
        color: var(--bs-body-color, #ddd);
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5);
        font-size: 13px;
        opacity: 0.95;
      }
      .cdk-drag-placeholder {
        opacity: 0.25;
      }
      .cdk-drag-animating {
        transition: transform 180ms cubic-bezier(0, 0, 0.2, 1);
      }
      .mobax-folder.cdk-drop-list-receiving .mobax-folder-header,
      .mobax-folder.cdk-drop-list-dragging .mobax-folder-header {
        background: color-mix(in srgb, var(--bs-primary, #3b82f6) 16%, transparent);
      }
    `,
  ],
})
export class SessionsTabComponent implements OnInit, OnDestroy {
  loading = true;
  folders: FolderNode[] = [];
  expandedKeys: string[] = [];
  selectedId: string | null = null;
  selectedFolderKey: string | null = null;
  renamingId: string | null = null;
  renamingFolderKey: string | null = null;
  iconPickerFolder: FolderNode | null = null;

  // Cache trusted SafeHtml per raw-SVG icon string (only built for custom SVG icons).
  private iconHtmlCache = new Map<string, SafeHtml>();

  // Live (connected) pane count per profile id, recomputed from app.tabs whenever tabs or their
  // sessions change. Drives the connection dots on each row.
  private liveCounts = new Map<string, number>();
  // Stable empty/0..3 arrays so dots() returns a referentially-stable array per count (keeps
  // *ngFor from rebuilding the dot nodes every change-detection pass).
  private readonly dotArrays: number[][] = [[], [0], [0, 1], [0, 1, 2]];

  // Profile ids currently being launched — drives the per-row amber "connecting" dot.
  // launchBaseline records each id's live-connection count at launch time, so refreshConnections can
  // detect "a new connection for this profile appeared" and clear the dot; launchTimers holds the
  // per-id backstop timeout so a failed/cancelled connect can't leave a connecting dot forever.
  private launchingIds = new Set<string>();
  private launchBaseline = new Map<string, number>();
  private launchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // When each launch's amber dot first appeared (Date.now), so a fast connect can be held to
  // MIN_CONNECTING_VISIBLE_MS; launchConnected marks ids whose connect was already observed, so the
  // hold is scheduled once and refreshConnections doesn't re-handle it on every later event.
  private launchStartedAt = new Map<string, number>();
  private launchConnected = new Set<string>();
  // detectChanges() after this view is destroyed throws; the backstop timeout can fire post-destroy.
  private viewDestroyed = false;

  private destroyed$ = new Subject<void>();
  // Coalesces the many session/tab signals into a single debounced refresh.
  private refresh$ = new Subject<void>();
  // Per-refresh watchers on the current leaves/sessions; torn down and rebuilt on every refresh.
  private tabWatchers = new Subscription();

  constructor(
    private profilesService: ProfilesService,
    private config: ConfigService,
    private platform: PlatformService,
    private zone: NgZone,
    private host: ElementRef<HTMLElement>,
    private app: AppService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
  ) {}

  // Tabby's ProfileIconComponent treats an icon starting with '<' as raw HTML/SVG; otherwise it's
  // a Font Awesome class string.
  isSvgIcon(icon: string | undefined): boolean {
    return !!icon && icon.trimStart().startsWith('<');
  }

  iconHtml(icon: string): SafeHtml {
    let html = this.iconHtmlCache.get(icon);
    if (!html) {
      html = this.sanitizer.bypassSecurityTrustHtml(icon);
      this.iconHtmlCache.set(icon, html);
    }
    return html;
  }

  // Resolve the effective icon/color the same way Tabby does for display: merge provider + group
  // defaults via the config proxy, fall back to the raw profile, then to the SSH default icon.
  private resolveIconColor(p: PartialProfile<Profile>): { icon: string; color?: string } {
    let icon: string | undefined;
    let color: string | undefined;
    try {
      const full = this.profilesService.getConfigProxyForProfile(p);
      icon = full.icon;
      color = full.color;
    } catch {
      // getConfigProxyForProfile can throw for malformed/cloned profiles — fall back to raw values.
    }
    return {
      icon: icon || p.icon || DEFAULT_PROFILE_ICON,
      color: color || p.color || undefined,
    };
  }

  async ngOnInit(): Promise<void> {
    await this.reload();

    // Live-connection dots: coalesce bursts of tab/session events, then rebuild watchers and
    // recount. activeTabChange$ is included as a cheap safety net to catch the "open" flip after a
    // connection completes (no dedicated event exists for that moment).
    this.refresh$
      .pipe(debounceTime(50), takeUntil(this.destroyed$))
      .subscribe(() => this.refreshConnections());
    merge(
      this.app.tabsChanged$,
      this.app.tabOpened$,
      this.app.tabRemoved$,
      this.app.tabClosed$,
      this.app.activeTabChange$,
    )
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => this.refresh$.next());
    // Initial pass synchronously so dots render on first paint without waiting for an event.
    this.refreshConnections();
  }

  ngOnDestroy(): void {
    this.viewDestroyed = true;
    this.destroyed$.next();
    this.destroyed$.complete();
    this.tabWatchers.unsubscribe();
    for (const t of this.launchTimers.values()) {
      clearTimeout(t);
    }
    this.launchTimers.clear();
  }

  // Rebuild per-session watchers for the current tabs, recount live connections, and repaint.
  private refreshConnections(): void {
    this.tabWatchers.unsubscribe();
    this.tabWatchers = new Subscription();
    for (const tab of this.app.tabs) {
      for (const raw of leavesOf(tab)) {
        this.watchLeaf(raw as WatchableLeaf);
      }
    }
    this.liveCounts = countLiveByProfile(this.app.tabs);
    // A launched profile finished connecting once its live count rises above the baseline captured
    // at launch — clear that row's connecting dot (subject to the min-visible hold). Failed connects
    // never rise; they fall to the backstop timeout instead.
    if (this.launchingIds.size) {
      // Safe to delete the current id mid-iteration: a Set's iterator only skips not-yet-visited
      // elements, and onLaunchConnected only ever removes the id being visited.
      for (const id of this.launchingIds) {
        if (this.launchConnected.has(id)) {
          continue;
        }
        if ((this.liveCounts.get(id) ?? 0) > (this.launchBaseline.get(id) ?? 0)) {
          this.onLaunchConnected(id);
        }
      }
    }
    // The sidebar host view is attached to ApplicationRef and isn't reliably ticked by these
    // out-of-template updates (same reason the SFTP tab calls detectChanges) — repaint explicitly.
    this.safeDetect();
  }

  // detectChanges() guarded against this ApplicationRef-attached view having been destroyed (the
  // launch backstop timeout can fire after the Sessions tab is *ngIf'd out).
  private safeDetect(): void {
    if (!this.viewDestroyed) {
      this.cdr.detectChanges();
    }
  }

  // Subscribe to the lifecycle signals of a single leaf's session so connect/disconnect flips the
  // dots immediately. All subs land in tabWatchers, replaced wholesale on the next refresh.
  private watchLeaf(leaf: WatchableLeaf): void {
    const bump = () => this.refresh$.next();
    if (leaf?.sessionChanged$ instanceof Observable) {
      this.tabWatchers.add(leaf.sessionChanged$.pipe(takeUntil(this.destroyed$)).subscribe(bump));
    }
    const session = leaf?.session;
    if (!session) {
      return;
    }
    if (session.closed$ instanceof Observable) {
      this.tabWatchers.add(session.closed$.pipe(takeUntil(this.destroyed$)).subscribe(bump));
    }
    if (session.destroyed$ instanceof Observable) {
      this.tabWatchers.add(session.destroyed$.pipe(takeUntil(this.destroyed$)).subscribe(bump));
    }
    // Still connecting: the first byte of output means the shell is live (open flips true) — a
    // one-shot trigger, so an established session's steady output doesn't churn the refresh.
    if (session.open !== true && session.output$ instanceof Observable) {
      this.tabWatchers.add(
        session.output$.pipe(take(1), takeUntil(this.destroyed$)).subscribe(bump),
      );
    }
  }

  // Number of dots to render for a profile row (0..3), as a stable array for *ngFor.
  dots(id: string): number[] {
    return this.dotArrays[dotCount(this.liveCounts.get(id) ?? 0)];
  }

  // Tooltip showing the true live count (may exceed the 3 dots actually drawn), plus a connecting
  // note while the amber dot is up.
  dotTitle(id: string): string {
    const live = this.liveCounts.get(id) ?? 0;
    if (this.isLaunching(id)) {
      return live > 0 ? `접속 중 ${live}개 · 연결 중…` : '연결 중…';
    }
    return `접속 중 ${live}개`;
  }

  async reload(): Promise<void> {
    // includeBuiltin: false drops Tabby's built-in connection templates (not user-created,
    // can't be renamed/deleted). With them gone, an otherwise-empty Ungrouped folder won't appear.
    // We show every user profile type (ssh / local / telnet / serial / …) — MobaXterm-style; the
    // SFTP tab and status bar stay SSH-only on their own (they bind only to active SSH tabs).
    const all = await this.profilesService.getProfiles({ clone: true, includeBuiltin: false });
    this.folders = this.buildFolders(all);
    this.expandedKeys = [...(this.config.store.mobaxSidebar?.expandedGroups ?? [])];
    const ids = new Set(this.folders.flatMap((f) => f.profiles.map((n) => n.id)));
    if (this.selectedId && !ids.has(this.selectedId)) {
      this.selectedId = null;
    }
    const folderKeys = new Set(this.folders.map((f) => f.key));
    if (this.selectedFolderKey && !folderKeys.has(this.selectedFolderKey)) {
      this.selectedFolderKey = null;
    }
    this.loading = false;
  }

  isExpanded(key: string): boolean {
    return isExpanded(this.expandedKeys, key);
  }

  toggleFolder(key: string): void {
    this.expandedKeys = toggleExpanded(this.expandedKeys, key);
    // expandedGroups default is an array → non-structural → a writable leaf on the ConfigProxy.
    Object.assign(this.config.store.mobaxSidebar, { expandedGroups: this.expandedKeys });
    this.config.save();
  }

  subtitle(profile: PartialProfile<Profile>): string {
    const opts = (profile.options ?? {}) as { user?: string; host?: string; port?: number };
    if (!opts.host) {
      return '';
    }
    const user = opts.user ?? 'root';
    const port = opts.port ?? 22;
    return `${user}@${opts.host}:${port}`;
  }

  select(node: ProfileNode): void {
    this.selectedId = node.id || null;
    this.selectedFolderKey = null;
    // This view is ApplicationRef-attached and not reliably auto-ticked, so the selection
    // highlight would otherwise wait for an unrelated change-detection pass. Repaint now.
    this.safeDetect();
  }

  selectFolder(folder: FolderNode): void {
    this.selectedFolderKey = folder.key;
    this.selectedId = null;
    this.safeDetect();
  }

  toggleFromChevron(event: Event, folder: FolderNode): void {
    event.stopPropagation();
    this.toggleFolder(folder.key);
  }

  launch(node: ProfileNode): void {
    const id = node.id;
    if (id) {
      // Reset any stale connecting state from a previous launch of the same row, then mark it
      // connecting. launchProfile resolves at tab-creation (before the SSH session connects), so we
      // can't await it to clear the dot — refreshConnections clears it when the session opens.
      this.dropLaunching(id);
      this.launchBaseline.set(id, this.liveCounts.get(id) ?? 0);
      this.launchStartedAt.set(id, Date.now());
      this.launchingIds.add(id);
      this.launchTimers.set(
        id,
        setTimeout(() => this.clearLaunching(id), LAUNCH_INDICATOR_TIMEOUT_MS),
      );
      this.safeDetect();
    }
    void this.profilesService.launchProfile(node.profile);
  }

  isLaunching(id: string): boolean {
    return !!id && this.launchingIds.has(id);
  }

  // Connection observed for a launching id. Clear the amber dot now if it's already been visible
  // long enough; otherwise hold it for the remainder of MIN_CONNECTING_VISIBLE_MS so a fast connect
  // still registers, then clear. Runs once per launch (guarded by launchConnected upstream).
  private onLaunchConnected(id: string): void {
    this.launchConnected.add(id);
    const elapsed = Date.now() - (this.launchStartedAt.get(id) ?? 0);
    const remaining = MIN_CONNECTING_VISIBLE_MS - elapsed;
    if (remaining <= 0) {
      // dropLaunching only mutates state; the caller (refreshConnections) repaints afterwards.
      this.dropLaunching(id);
      return;
    }
    const timer = this.launchTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    this.launchTimers.set(
      id,
      setTimeout(() => this.clearLaunching(id), remaining),
    );
  }

  // Backstop / hold-expiry path: clear a row's connecting dot and repaint. No-op (no repaint) if
  // already cleared.
  private clearLaunching(id: string): void {
    if (this.dropLaunching(id)) {
      this.safeDetect();
    }
  }

  // Drop all connecting-dot bookkeeping for a profile id (timer + baseline + start time + connected
  // flag). Returns true if the id was actually connecting, so callers can decide whether to repaint.
  private dropLaunching(id: string): boolean {
    const timer = this.launchTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.launchTimers.delete(id);
    }
    this.launchBaseline.delete(id);
    this.launchStartedAt.delete(id);
    this.launchConnected.delete(id);
    return this.launchingIds.delete(id);
  }

  buildMenu(node: ProfileNode): MenuItemOptions[] {
    return [
      { label: '접속', click: () => this.zone.run(() => this.launch(node)) },
      { type: 'separator' },
      {
        label: '이름 변경',
        enabled: !!node.profile.id,
        click: () => this.zone.run(() => this.startRename(node)),
      },
      {
        label: '삭제',
        enabled: !!node.profile.id,
        click: () => this.zone.run(() => void this.confirmDelete(node)),
      },
    ];
  }

  onProfileContextMenu(event: MouseEvent, node: ProfileNode): void {
    event.preventDefault();
    this.select(node);
    this.platform.popupContextMenu(this.buildMenu(node), event);
  }

  async confirmDelete(node: ProfileNode): Promise<void> {
    if (!node.profile.id) {
      return;
    }
    const result = await this.platform.showMessageBox({
      type: 'warning',
      message: `'${node.name}' 프로필을 삭제할까요?`,
      buttons: ['삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) {
      return;
    }
    await this.profilesService.deleteProfile(node.profile);
    this.config.save();
    await this.reload();
  }

  startRename(node: ProfileNode): void {
    if (!node.profile.id) {
      return;
    }
    this.renamingFolderKey = null;
    this.renamingId = node.id;
    // The input renders on the next change-detection tick; focus it after the view updates.
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.mobax-rename-input',
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  async commitRename(node: ProfileNode, rawValue: string): Promise<void> {
    if (this.renamingId !== node.id) {
      return;
    }
    this.renamingId = null;
    const name = rawValue.trim();
    if (!name || name === node.name || !node.profile.id) {
      this.focusSelectedRow();
      return;
    }
    node.profile.name = name;
    await this.profilesService.writeProfile(node.profile);
    this.config.save();
    await this.reload();
    this.focusSelectedRow();
  }

  cancelRename(): void {
    this.renamingId = null;
    this.renamingFolderKey = null;
    this.focusSelectedRow();
  }

  // When the rename input unmounts, focus falls back to <body>, so the row's (keydown)
  // handler stops receiving F2 — restore focus to the selected row so it keeps working.
  private focusSelectedRow(): void {
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.mobax-profile.selected, .mobax-folder-header.selected',
      ) as HTMLElement | null;
      el?.focus();
    });
  }

  startFolderRename(folder: FolderNode): void {
    if (folder.key === UNGROUPED_KEY) {
      return;
    }
    this.renamingId = null;
    this.renamingFolderKey = folder.key;
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.mobax-rename-input',
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  async commitFolderRename(folder: FolderNode, rawValue: string): Promise<void> {
    if (this.renamingFolderKey !== folder.key) {
      return;
    }
    this.renamingFolderKey = null;
    const name = rawValue.trim();
    if (!name || name === folder.name || folder.key === UNGROUPED_KEY) {
      this.focusSelectedRow();
      return;
    }
    await this.profilesService.writeProfileGroup({ id: folder.key, name });
    this.config.save();
    await this.reload();
    this.focusSelectedRow();
  }

  async confirmDeleteFolder(folder: FolderNode): Promise<void> {
    if (folder.key === UNGROUPED_KEY) {
      return;
    }
    const result = await this.platform.showMessageBox({
      type: 'warning',
      message: `'${folder.name}' 폴더를 삭제할까요? (안의 세션은 미분류로 이동합니다)`,
      buttons: ['삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) {
      return;
    }
    await this.profilesService.deleteProfileGroup({ id: folder.key, name: folder.name });
    this.config.save();
    await this.reload();
  }

  openIconPicker(folder: FolderNode): void {
    if (folder.key === UNGROUPED_KEY) {
      return;
    }
    this.iconPickerFolder = folder;
    // ApplicationRef-attached view — repaint explicitly (same reason as select()).
    this.safeDetect();
  }

  closeIconPicker(): void {
    this.iconPickerFolder = null;
    this.safeDetect();
  }

  // Write path deliberately avoids writeProfileGroup: Object.assign can't delete a field, which
  // "restore default" (icon = null) needs. Direct mutation of config.store.groups items is the
  // same pattern Tabby core uses (newProfileGroup pushes into it).
  async onIconChosen(icon: string | null): Promise<void> {
    const folder = this.iconPickerFolder;
    this.iconPickerFolder = null;
    if (!folder) {
      return;
    }
    const groups = (this.config.store.groups ?? []) as Array<{ id: string; icon?: string }>;
    const group = groups.find((g) => g?.id === folder.key);
    if (group) {
      if (icon === null) {
        delete group.icon;
      } else {
        group.icon = icon;
      }
      await this.config.save();
    }
    // Group gone (deleted elsewhere while the picker was open): fall through silently — no write,
    // just re-sync the view.
    await this.reload();
    this.safeDetect();
  }

  buildFolderMenu(folder: FolderNode): MenuItemOptions[] {
    const real = folder.key !== UNGROUPED_KEY;
    return [
      {
        label: '이름 변경',
        enabled: real,
        click: () => this.zone.run(() => this.startFolderRename(folder)),
      },
      {
        label: '아이콘 변경...',
        enabled: real,
        click: () => this.zone.run(() => this.openIconPicker(folder)),
      },
      {
        label: '삭제',
        enabled: real,
        click: () => this.zone.run(() => void this.confirmDeleteFolder(folder)),
      },
    ];
  }

  onFolderContextMenu(event: MouseEvent, folder: FolderNode): void {
    event.preventDefault();
    this.selectFolder(folder);
    this.platform.popupContextMenu(this.buildFolderMenu(folder), event);
  }

  onFolderKeydown(event: KeyboardEvent, folder: FolderNode): void {
    if (this.renamingFolderKey) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.toggleFolder(folder.key);
    } else if (event.key === 'F2') {
      event.preventDefault();
      this.startFolderRename(folder);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void this.confirmDeleteFolder(folder);
    }
  }

  onProfileKeydown(event: KeyboardEvent, node: ProfileNode): void {
    if (this.renamingId) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.launch(node);
    } else if (event.key === 'F2') {
      event.preventDefault();
      this.startRename(node);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void this.confirmDelete(node);
    }
  }

  get dropListIds(): string[] {
    return this.folders.map((f) => 'mobax-folder-' + f.key);
  }

  async onProfileDrop(event: CdkDragDrop<FolderNode>): Promise<void> {
    if (event.previousContainer === event.container) {
      return;
    }
    const node = event.item.data as ProfileNode;
    const target = event.container.data;
    if (!node.profile.id) {
      return;
    }
    // Optimistic UI move; reload() re-sorts authoritatively afterwards.
    transferArrayItem(
      event.previousContainer.data.profiles,
      event.container.data.profiles,
      event.previousIndex,
      event.currentIndex,
    );
    // node.profile is a clone (getProfiles({ clone: true })), so writeProfile's full replace is safe.
    if (target.key === UNGROUPED_KEY) {
      delete node.profile.group;
    } else {
      node.profile.group = target.key;
    }
    await this.profilesService.writeProfile(node.profile);
    this.config.save();
    await this.reload();
  }

  async createGroup(): Promise<void> {
    const group = { id: '', name: '새 그룹' };
    await this.profilesService.newProfileGroup(group, { genId: true });
    this.config.save();
    await this.reload();
    const folder = this.folders.find((f) => f.key === group.id);
    if (folder) {
      this.selectFolder(folder);
      this.startFolderRename(folder);
    }
  }

  openProfileSettings(): void {
    const existing = this.app.tabs.find((t) => t instanceof SettingsTabComponent) as
      | SettingsTabComponent
      | undefined;
    if (existing) {
      existing.activeTab = 'profiles';
      this.app.selectTab(existing);
    } else {
      this.app.openNewTabRaw({
        type: SettingsTabComponent,
        inputs: { activeTab: 'profiles' },
      });
    }
  }

  get canModifySelection(): boolean {
    return (
      !!this.selectedId ||
      (!!this.selectedFolderKey && this.selectedFolderKey !== UNGROUPED_KEY)
    );
  }

  renameSelected(): void {
    if (this.selectedFolderKey && this.selectedFolderKey !== UNGROUPED_KEY) {
      const folder = this.folders.find((f) => f.key === this.selectedFolderKey);
      if (folder) {
        this.startFolderRename(folder);
      }
      return;
    }
    const node = this.findSelectedNode();
    if (node) {
      this.startRename(node);
    }
  }

  deleteSelected(): void {
    if (this.selectedFolderKey && this.selectedFolderKey !== UNGROUPED_KEY) {
      const folder = this.folders.find((f) => f.key === this.selectedFolderKey);
      if (folder) {
        void this.confirmDeleteFolder(folder);
      }
      return;
    }
    const node = this.findSelectedNode();
    if (node) {
      void this.confirmDelete(node);
    }
  }

  private findSelectedNode(): ProfileNode | undefined {
    if (!this.selectedId) {
      return undefined;
    }
    for (const folder of this.folders) {
      const node = folder.profiles.find((n) => n.id === this.selectedId);
      if (node) {
        return node;
      }
    }
    return undefined;
  }

  private buildFolders(profiles: PartialProfile<Profile>[]): FolderNode[] {
    const groups = (this.config.store.groups ?? []) as Array<{
      id: string;
      name?: string;
      icon?: string;
    }>;
    const groupNames = new Map<string, string>();
    const groupIcons = new Map<string, string>();
    const buckets = new Map<string, ProfileNode[]>();
    // Seed every real group so empty groups still render (lets you drop sessions into a new folder).
    for (const g of groups) {
      if (g?.id) {
        groupNames.set(g.id, g.name ?? g.id);
        if (g.icon) {
          groupIcons.set(g.id, g.icon);
        }
        buckets.set(g.id, []);
      }
    }
    const ungrouped: ProfileNode[] = [];
    for (const p of profiles) {
      const { icon, color } = this.resolveIconColor(p);
      const node: ProfileNode = {
        profile: p,
        name: p.name ?? '',
        subtitle: this.subtitle(p),
        id: p.id ?? '',
        icon,
        color,
      };
      if (p.group) {
        const list = buckets.get(p.group) ?? [];
        list.push(node);
        buckets.set(p.group, list);
      } else {
        ungrouped.push(node);
      }
    }
    const folders: FolderNode[] = [...buckets.entries()].map(([key, list]) => ({
      key,
      name: groupNames.get(key) ?? key,
      icon: groupIcons.get(key),
      profiles: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));
    folders.sort((a, b) => a.name.localeCompare(b.name));
    if (ungrouped.length) {
      folders.push({
        key: UNGROUPED_KEY,
        name: 'Ungrouped',
        profiles: ungrouped.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    return folders;
  }
}
