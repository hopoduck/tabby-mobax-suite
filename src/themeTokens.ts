// Plugin-scoped semantic status colors.
//
// Tabby themes remap the Bootstrap semantic vars (--bs-success/warning/danger) to arbitrary hues
// (this theme set --bs-warning to a mint green), so colors that must keep a *fixed meaning*
// (green = good/connected, amber = warning/connecting, red = bad/error) cannot derive from them.
// These tokens are theme-independent and defined once on :root, so every component can reference
// var(--mobax-*) instead of scattering literals.

export const MOBAX_COLORS = {
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  // Accent blue for the CPU sparkline's "normal" state; warn/danger override it with the tokens
  // above so the chart colour tracks CPU severity (see serverStatsBar.component.ts).
  info: '#4ea1ff',
  // Lighter (-hi) / darker (-lo) shades of success+warning, used as radial-gradient stops so the
  // session connection dots render as glossy LED beads (top-left highlight → base → shaded bottom).
  successHi: '#7ef3a8',
  successLo: '#15a349',
  warningHi: '#ffd27a',
  warningLo: '#c97c06',
} as const;

const STYLE_ID = 'mobax-theme-tokens';

// Append the :root token stylesheet once. Called at plugin require time (src/index.ts) so the vars
// exist before any component JIT-compiles or mounts — usage sites then need no fallback literal.
// CSS custom properties inherit through the DOM regardless of Angular view encapsulation, so a
// single :root definition reaches every component including the imperatively-injected sidebar/bar.
export function injectThemeTokens(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `:root {
  --mobax-success: ${MOBAX_COLORS.success};
  --mobax-success-hi: ${MOBAX_COLORS.successHi};
  --mobax-success-lo: ${MOBAX_COLORS.successLo};
  --mobax-warning: ${MOBAX_COLORS.warning};
  --mobax-warning-hi: ${MOBAX_COLORS.warningHi};
  --mobax-warning-lo: ${MOBAX_COLORS.warningLo};
  --mobax-danger: ${MOBAX_COLORS.danger};
  --mobax-info: ${MOBAX_COLORS.info};
}`;
  document.head.appendChild(style);
}
