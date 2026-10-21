import { describe, it, expect } from 'vitest';
import {
  calculateDistance,
  calculateAngleClockwiseFromTop,
  getRadialSectorHit,
  polarToCartesian,
  generateArcSvgPath
} from '../src/renderer/src/core/RadialGeometry';

describe('RadialGeometry Trigonometry Suite', () => {
  const CX = 200;
  const CY = 200;
  const R_INNER = 60;
  const R_OUTER = 140;

  it('calculates Euclidean distance accurately', () => {
    expect(calculateDistance(0, 0, 3, 4)).toBeCloseTo(5);
    expect(calculateDistance(CX, CY, CX + 50, CY)).toBeCloseTo(50);
    expect(calculateDistance(CX, CY, CX, CY + 50)).toBeCloseTo(50);
  });

  it('calculates clockwise angles from 12 oclock accurately', () => {
    // 12 o'clock (North) -> 0°
    expect(calculateAngleClockwiseFromTop(CX, CY - 100, CX, CY)).toBeCloseTo(0);
    // 3 o'clock (East) -> 90°
    expect(calculateAngleClockwiseFromTop(CX + 100, CY, CX, CY)).toBeCloseTo(90);
    // 6 o'clock (South) -> 180°
    expect(calculateAngleClockwiseFromTop(CX, CY + 100, CX, CY)).toBeCloseTo(180);
    // 9 o'clock (West) -> 270°
    expect(calculateAngleClockwiseFromTop(CX - 100, CY, CX, CY)).toBeCloseTo(270);
  });

  it('detects hits inside the primary central circle', () => {
    // Exactly at center
    const hitCenter = getRadialSectorHit(CX, CY, CX, CY, R_INNER, R_OUTER, 4);
    expect(hitCenter.isInsideCenter).toBe(true);
    expect(hitCenter.isInsideRing).toBe(false);
    expect(hitCenter.isOutside).toBe(false);

    // Near center (distance 30 < 60)
    const hitInner = getRadialSectorHit(CX + 20, CY + 20, CX, CY, R_INNER, R_OUTER, 4);
    expect(hitInner.isInsideCenter).toBe(true);
  });

  it('detects hits inside the outer ring with correct sector indexing', () => {
    // 4 sectors:
    // Sector 0: 0° - 90° (Top-Right quadrant)
    // Sector 1: 90° - 180° (Bottom-Right quadrant)
    // Sector 2: 180° - 270° (Bottom-Left quadrant)
    // Sector 3: 270° - 360° (Top-Left quadrant)

    const distance = 100; // between 60 and 140

    // Test Sector 0 (45°)
    const p0 = polarToCartesian(CX, CY, distance, 45);
    const hit0 = getRadialSectorHit(p0.x, p0.y, CX, CY, R_INNER, R_OUTER, 4);
    expect(hit0.isInsideRing).toBe(true);
    expect(hit0.sectorIndex).toBe(0);

    // Test Sector 1 (135°)
    const p1 = polarToCartesian(CX, CY, distance, 135);
    const hit1 = getRadialSectorHit(p1.x, p1.y, CX, CY, R_INNER, R_OUTER, 4);
    expect(hit1.isInsideRing).toBe(true);
    expect(hit1.sectorIndex).toBe(1);

    // Test Sector 2 (225°)
    const p2 = polarToCartesian(CX, CY, distance, 225);
    const hit2 = getRadialSectorHit(p2.x, p2.y, CX, CY, R_INNER, R_OUTER, 4);
    expect(hit2.isInsideRing).toBe(true);
    expect(hit2.sectorIndex).toBe(2);

    // Test Sector 3 (315°)
    const p3 = polarToCartesian(CX, CY, distance, 315);
    const hit3 = getRadialSectorHit(p3.x, p3.y, CX, CY, R_INNER, R_OUTER, 4);
    expect(hit3.isInsideRing).toBe(true);
    expect(hit3.sectorIndex).toBe(3);
  });

  it('detects drops outside the outer boundary as safe outside cancel', () => {
    // Beyond outer radius (e.g. distance 180 > 140)
    const hitOutside = getRadialSectorHit(CX + 180, CY, CX, CY, R_INNER, R_OUTER, 4);
    expect(hitOutside.isOutside).toBe(true);
    expect(hitOutside.isInsideRing).toBe(false);
    expect(hitOutside.isInsideCenter).toBe(false);
    expect(hitOutside.sectorIndex).toBe(-1);
  });

  it('generates valid SVG arc path string', () => {
    const path = generateArcSvgPath(CX, CY, R_INNER, R_OUTER, 0, 90, 2);
    expect(path).toContain('M ');
    expect(path).toContain('A 140 140');
    expect(path).toContain('Z');
  });
});
