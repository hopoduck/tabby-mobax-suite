import { Component } from '@angular/core';
import { ConfigService } from 'tabby-core';
import { Variable, validVarName } from '../logic/variables';

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Global, plain-text variable manager. Lives inside the Macros sidebar tab (a "변수" mode),
// since substitution only ever applies to macro command steps. Reads/writes config directly.
@Component({
  selector: 'variables-tab',
  template: `
    <div class="vars-box">
      <p class="hint">
        변수 이름은 <code>{{ nameExample }}</code>처럼 기호 없이 입력하세요. 매크로 명령에서
        <code>{{ tokenExample }}</code>로 쓰면 실행 시 그 값으로 치환됩니다.
      </p>
      <div class="var-row" *ngFor="let v of list; trackBy: trackById">
        <input
          class="var-name"
          [class.invalid]="invalid(v)"
          placeholder="이름 (예: HOST)"
          [ngModel]="v.name"
          (change)="setName(v, $any($event.target).value)"
        />
        <input
          class="var-value"
          placeholder="값"
          [ngModel]="v.value"
          (change)="setValue(v, $any($event.target).value)"
        />
        <button class="var-del" (click)="remove(v)" title="삭제">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <p class="hint warn" *ngIf="anyInvalid">
        이름은 영문/숫자/_/.- 만 허용되며 중복될 수 없습니다. 무효한 변수는 치환에서 제외됩니다.
      </p>
      <button class="var-add" (click)="add()"><i class="fas fa-plus"></i> 변수 추가</button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vars-box {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 10px;
      }
      .hint {
        font-size: 12px;
        margin: 0 0 4px;
      }
      .hint code {
        color: inherit;
        background: color-mix(in srgb, currentColor 16%, transparent);
        padding: 0 5px;
        border-radius: 4px;
        font-weight: 600;
      }
      .hint.warn {
        color: var(--mobax-warning);
        opacity: 0.9;
      }
      .var-row {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .var-name {
        flex: 1 1 38%;
        min-width: 0;
      }
      .var-value {
        flex: 1 1 62%;
        min-width: 0;
      }
      .var-name,
      .var-value {
        background: var(--bs-body-bg, #1e1e1e);
        color: inherit;
        border: 1px solid var(--bs-border-color, #333);
        border-radius: 3px;
        padding: 3px 6px;
        font: inherit;
      }
      .var-name.invalid {
        border-color: var(--mobax-warning);
      }
      .var-del {
        flex: 0 0 auto;
        background: transparent;
        border: none;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        border-radius: 4px;
        padding: 2px 5px;
      }
      .var-del:hover {
        opacity: 1;
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
      .var-add {
        align-self: flex-start;
        margin-top: 4px;
        background: transparent;
        border: 1px solid var(--bs-border-color, #333);
        color: inherit;
        border-radius: 4px;
        padding: 3px 10px;
        cursor: pointer;
      }
      .var-add:hover {
        background: var(--bs-secondary-bg, rgba(255, 255, 255, 0.06));
      }
    `,
  ],
})
export class VariablesTabComponent {
  // Example pair shown in the hint: the bare name typed in the 이름 field (nameExample) vs. how it
  // is referenced inside a macro command (tokenExample). Bound via interpolation (not written raw in
  // the template) so Angular doesn't parse the `{` in `${HOST}` as ICU message syntax.
  nameExample = 'HOST';
  tokenExample = '${HOST}';

  constructor(private config: ConfigService) {}

  get list(): Variable[] {
    return this.config.store.mobaxVariables?.list ?? [];
  }

  trackById(_i: number, v: Variable): string {
    return v.id;
  }

  // Persist a new list snapshot. ConfigProxy: mobaxVariables is getter-only → mutate the leaf.
  private persist(list: Variable[]): void {
    Object.assign(this.config.store.mobaxVariables, { list });
    this.config.save();
  }

  add(): void {
    this.persist([...this.list, { id: genId(), name: '', value: '' }]);
  }

  setName(v: Variable, name: string): void {
    this.persist(this.list.map((x) => (x.id === v.id ? { ...x, name } : x)));
  }

  setValue(v: Variable, value: string): void {
    this.persist(this.list.map((x) => (x.id === v.id ? { ...x, value } : x)));
  }

  remove(v: Variable): void {
    this.persist(this.list.filter((x) => x.id !== v.id));
  }

  // Flag a row red only when its non-empty name is malformed or duplicated.
  // An empty name is "incomplete" (no flag) and is simply excluded from substitution.
  invalid(v: Variable): boolean {
    if (!v.name) {
      return false;
    }
    if (!validVarName(v.name)) {
      return true;
    }
    return this.list.some((x) => x.id !== v.id && x.name === v.name);
  }

  get anyInvalid(): boolean {
    return this.list.some((v) => this.invalid(v));
  }
}
