// Pure SVG sparkline geometry. No Angular/Tabby imports so the vitest suite stays runnable.
// Turns a 0..100 value series into a smooth filled area chart (see serverStatsBar.component.ts):
// sparkPoints() maps the series to coordinates, smoothPath() draws the curve, areaPath() closes
// it into a fillable shape. Keeping the math here (instead of inline in the component) makes it
// unit-testable per the repo's "only pure logic is tested" policy.

export interface Point {
  x: number;
  y: number;
}

const DOMAIN_MAX = 100;

function round(n: number): string {
  return n.toFixed(2);
}

/**
 * Map a 0..100 value series onto (x,y) points inside a w×h box, inset by `pad` on every side so
 * strokes/dots near the edges aren't clipped by the SVG viewport. A single sample is duplicated
 * into a flat 2-point line so the chart still draws on the first reading. Values clamp to 0..100;
 * y is flipped (100 → top, 0 → bottom). Returns [] for an empty series.
 *
 * `windowSize` is the full history capacity. The horizontal step is fixed at `innerW /
 * (windowSize - 1)`, so each sample always occupies the same time slice: the newest sample pins to
 * the right edge and older samples extend left, leaving the left side blank until `windowSize`
 * samples have accumulated (then it becomes a right-anchored sliding window). This avoids the
 * "stretch a few points across the whole width, then squish as more arrive" behaviour you'd get
 * from scaling to the current sample count. Omit `windowSize` to stretch the series to full width.
 */
export function sparkPoints(
  values: number[],
  w: number,
  h: number,
  pad = 0,
  windowSize?: number,
): Point[] {
  if (values.length === 0) {
    return [];
  }
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const slots = Math.max(windowSize ?? series.length, series.length, 2);
  const step = innerW / (slots - 1);
  const rightX = pad + innerW;
  const newestIndex = series.length - 1;
  return series.map((v, i) => {
    const clamped = Math.max(0, Math.min(DOMAIN_MAX, v));
    const x = rightX - (newestIndex - i) * step;
    const y = pad + innerH - (clamped / DOMAIN_MAX) * innerH;
    return { x, y };
  });
}

/**
 * A smooth cubic-Bézier path through the points via a Catmull-Rom spline (tension 1/6). The first
 * and last points reuse their only neighbour as the missing control anchor, so the curve starts
 * and ends cleanly. Returns '' for an empty series and a lone "M x y" for a single point.
 */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

/**
 * Close a line path into a filled area by dropping to `baseY` under the last point and back under
 * the first, so it can be filled with a vertical gradient. Returns '' when there is nothing to fill.
 */
export function areaPath(linePath: string, points: Point[], baseY: number): string {
  if (points.length === 0 || linePath === '') {
    return '';
  }
  const last = points[points.length - 1];
  const first = points[0];
  return `${linePath} L ${round(last.x)} ${round(baseY)} L ${round(first.x)} ${round(baseY)} Z`;
}
