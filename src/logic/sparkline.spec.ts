import { describe, it, expect } from 'vitest';
import { sparkPoints, smoothPath, areaPath } from './sparkline';

describe('sparkPoints', () => {
  it('returns an empty array for no samples', () => {
    expect(sparkPoints([], 56, 18, 2)).toEqual([]);
  });

  it('duplicates a single sample into a flat 2-point line spanning the width', () => {
    const pts = sparkPoints([40], 56, 18, 2);
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBe(2); // left inset
    expect(pts[1].x).toBe(54); // right inset (w - pad)
    expect(pts[0].y).toBe(pts[1].y); // flat
  });

  it('flips the value axis: 100 maps to the top inset, 0 to the bottom', () => {
    const [hi, lo] = sparkPoints([100, 0], 56, 18, 2);
    expect(hi.y).toBeCloseTo(2); // top = pad
    expect(lo.y).toBeCloseTo(16); // bottom = h - pad
  });

  it('places the midpoint value at the vertical centre', () => {
    const [mid] = sparkPoints([50], 56, 18, 2);
    expect(mid.y).toBeCloseTo(9); // (2 + 16) / 2
  });

  it('clamps out-of-range values to 0..100', () => {
    const [over, under] = sparkPoints([150, -20], 56, 18, 2);
    expect(over.y).toBeCloseTo(2); // treated as 100 → top
    expect(under.y).toBeCloseTo(16); // treated as 0 → bottom
  });

  it('spreads x evenly across the inset width', () => {
    const pts = sparkPoints([10, 20, 30], 56, 18, 2);
    expect(pts.map((p) => p.x)).toEqual([2, 28, 54]);
  });

  it('with a window, pins the newest to the right edge and extends older samples left at a fixed step', () => {
    // 3 samples in a 30-slot window occupy only the rightmost slots; the left stays blank.
    const pts = sparkPoints([10, 20, 30], 56, 18, 2, 30);
    const step = 52 / 29;
    expect(pts).toHaveLength(3);
    expect(pts[2].x).toBeCloseTo(54); // newest at the right edge
    expect(pts[1].x).toBeCloseTo(54 - step);
    expect(pts[0].x).toBeCloseTo(54 - 2 * step);
    expect(pts[0].x).toBeGreaterThan(40); // bunched on the right, not stretched to the left edge
  });

  it('fills the full width once the window is full, newest still at the right edge', () => {
    const full = Array.from({ length: 30 }, (_, i) => i);
    const pts = sparkPoints(full, 56, 18, 2, 30);
    expect(pts[0].x).toBeCloseTo(2); // oldest at the left inset
    expect(pts[29].x).toBeCloseTo(54); // newest at the right inset
  });

  it('keeps the horizontal step constant as samples accumulate (no squishing)', () => {
    const stepAt = (count: number): number => {
      const pts = sparkPoints(Array.from({ length: count }, () => 50), 56, 18, 2, 30);
      return pts[1].x - pts[0].x;
    };
    expect(stepAt(5)).toBeCloseTo(stepAt(20)); // same spacing whether 5 or 20 samples exist
  });
});

describe('smoothPath', () => {
  it('returns an empty string for no points', () => {
    expect(smoothPath([])).toBe('');
  });

  it('returns a lone move command for a single point', () => {
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3.00 4.00');
  });

  it('starts with a move and uses cubic segments between points', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith('M 0.00 0.00')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(2); // one cubic per gap
  });
});

describe('areaPath', () => {
  it('returns an empty string when there is nothing to fill', () => {
    expect(areaPath('', [], 18)).toBe('');
  });

  it('closes the line down to the baseline and back, ending with Z', () => {
    const pts = [
      { x: 2, y: 5 },
      { x: 54, y: 8 },
    ];
    const area = areaPath('M 2.00 5.00 L 54.00 8.00', pts, 18);
    expect(area).toBe('M 2.00 5.00 L 54.00 8.00 L 54.00 18.00 L 2.00 18.00 Z');
  });
});
