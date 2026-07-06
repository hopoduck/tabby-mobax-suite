import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { NotificationsService } from 'tabby-core';
import { getRemoteDialog } from '../electronDialog';
import { buildImageIcon, GroupIconError } from '../groupIconImage';

// Curated Font Awesome presets (~40). FA5 names — the host Tabby's FA build keeps these as
// aliases even on FA6. Categories: folders, server/host, cloud, network/globe, security,
// terminal/code, hardware, misc markers, brands.
const PRESET_ICONS: string[] = [
  'fas fa-folder',
  'fas fa-folder-open',
  'far fa-folder',
  'fas fa-server',
  'fas fa-database',
  'fas fa-hdd',
  'fas fa-desktop',
  'fas fa-laptop',
  'fas fa-cloud',
  'fas fa-cloud-upload-alt',
  'fas fa-globe',
  'fas fa-network-wired',
  'fas fa-sitemap',
  'fas fa-wifi',
  'fas fa-lock',
  'fas fa-shield-alt',
  'fas fa-key',
  'fas fa-user-shield',
  'fas fa-terminal',
  'fas fa-code',
  'fas fa-code-branch',
  'fas fa-bug',
  'fas fa-microchip',
  'fas fa-plug',
  'fas fa-star',
  'fas fa-flag',
  'fas fa-home',
  'fas fa-briefcase',
  'fas fa-flask',
  'fas fa-rocket',
  'fas fa-fire',
  'fas fa-bolt',
  'fab fa-docker',
  'fab fa-linux',
  'fab fa-ubuntu',
  'fab fa-centos',
  'fab fa-redhat',
  'fab fa-windows',
  'fab fa-apple',
  'fab fa-aws',
  'fab fa-github',
  'fab fa-raspberry-pi',
];

@Component({
  selector: 'folder-icon-picker',
  template: `
    <div class="mobax-icon-picker-backdrop" (mousedown)="closed.emit()">
      <div class="mobax-icon-picker" (mousedown)="$event.stopPropagation()">
        <div class="mobax-icon-picker-title">{{ title }}</div>
        <div class="mobax-icon-picker-grid">
          <button
            *ngFor="let icon of presets"
            type="button"
            class="mobax-icon-picker-cell"
            [class.selected]="icon === currentIcon"
            [title]="icon"
            (click)="chosen.emit(icon)"
          >
            <i class="fa-fw" [ngClass]="icon" aria-hidden="true"></i>
          </button>
        </div>
        <div class="mobax-icon-picker-actions">
          <button type="button" class="mobax-icon-picker-btn" (click)="pickImage()">
            이미지 파일 선택...
          </button>
          <button
            *ngIf="currentIcon"
            type="button"
            class="mobax-icon-picker-btn"
            (click)="chosen.emit(null)"
          >
            기본 아이콘으로 복원
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .mobax-icon-picker-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mobax-icon-picker {
        width: 340px;
        max-width: 90vw;
        max-height: 80vh;
        overflow: auto;
        background: var(--theme-bg-more-2, var(--bs-body-bg, #1e1e1e));
        color: var(--bs-body-color, #ddd);
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
      }
      .mobax-icon-picker-title {
        font-weight: 600;
        margin-bottom: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mobax-icon-picker-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
      }
      .mobax-icon-picker-cell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 32px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: inherit;
        font-size: 15px;
        cursor: pointer;
        opacity: 0.85;
      }
      .mobax-icon-picker-cell:hover {
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.08));
        opacity: 1;
      }
      .mobax-icon-picker-cell.selected {
        border-color: var(--bs-primary, #3b82f6);
        opacity: 1;
      }
      .mobax-icon-picker-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      .mobax-icon-picker-btn {
        flex: 1 1 auto;
        padding: 6px 10px;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.08));
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 4px;
        color: inherit;
        cursor: pointer;
      }
      .mobax-icon-picker-btn:hover {
        filter: brightness(1.15);
      }
    `,
  ],
})
export class FolderIconPickerComponent {
  @Input() folderName = '';
  @Input() currentIcon?: string;
  @Output() chosen = new EventEmitter<string | null>();
  @Output() closed = new EventEmitter<void>();

  presets = PRESET_ICONS;

  constructor(private notifications: NotificationsService) {}

  get title(): string {
    return `'${this.folderName}' 폴더 아이콘`;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    event.preventDefault();
    this.closed.emit();
  }

  // Image flow lives inside the picker: pick a file → convert → emit. On failure show a
  // notification and stay open (only a successful conversion emits `chosen`).
  async pickImage(): Promise<void> {
    const dialog = getRemoteDialog();
    if (!dialog) {
      this.notifications.error('이미지 선택 불가', 'Electron 대화상자를 사용할 수 없습니다.');
      return;
    }
    const res = await dialog.showOpenDialog({
      title: '폴더 아이콘 이미지 선택',
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.length) {
      return;
    }
    try {
      this.chosen.emit(await buildImageIcon(res.filePaths[0]));
    } catch (e) {
      if (e instanceof GroupIconError && e.kind === 'too-large') {
        this.notifications.error('이미지가 너무 큽니다 (최대 100KB)');
      } else {
        this.notifications.error('이미지를 불러올 수 없습니다');
      }
    }
  }
}
