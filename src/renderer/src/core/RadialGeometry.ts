/**
 * RadialGeometry - Precision trigonometry for circular hit-testing and SVG arc rendering
 */

export interface HitTestResult {
  isInsideCenter: boolean;
  isInsideRing: boolean;
  isOutside: boolean;
  sectorIndex: number;
  angleDegrees: number;
  distance: number;
}

export function calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates angle in degrees [0, 360) clockwise from 12 o'clock (North = 0°, East = 90°, South = 180°, West = 270°)
 */
export function calculateAngleClockwiseFromTop(x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx;
  const dy = y - cy;
  // atan2(dy, dx) returns angle from 3 o'clock counter-clockwise/clockwise [-PI, PI]
  const radians = Math.atan2(dy, dx);
  let degrees = (radians * 180) / Math.PI + 90; // Rotate 90 deg so top is 0
  if (degrees < 0) {
    degrees += 360;
  }
  return degrees % 360;
}

/**
 * Performs hit testing for concentric circular widget with N sectors
 */
export function getRadialSectorHit(
  x: number,
  y: number,
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  sectorCount: number
): HitTestResult {
  const distance = calculateDistance(x, y, cx, cy);
  const angleDegrees = calculateAngleClockwiseFromTop(x, y, cx, cy);

  if (distance < innerRadius) {
    return {
      isInsideCenter: true,
      isInsideRing: false,
      isOutside: false,
      sectorIndex: -1,
      angleDegrees,
      distance
    };
  }

  if (distance >= innerRadius && distance <= outerRadius && sectorCount > 0) {
    const sectorSpan = 360 / sectorCount;
    const sectorIndex = Math.floor(angleDegrees / sectorSpan) % sectorCount;
    return {
      isInsideCenter: false,
      isInsideRing: true,
      isOutside: false,
      sectorIndex,
      angleDegrees,
      distance
    };
  }

  return {
    isInsideCenter: false,
    isInsideRing: false,
    isOutside: true,
    sectorIndex: -1,
    angleDegrees,
    distance
  };
}

/**
 * Converts polar coordinates (angle from top clockwise, radius) to Cartesian (x, y)
 */
export function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number): { x: number; y: number } {
  // Angle is measured clockwise from 12 o'clock (North)
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

/**
 * Generates an SVG path string for a donut arc slice with optional angular gap
 */
export function generateArcSvgPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  gapDeg = 2
): string {
  const actualStart = startAngleDeg + gapDeg / 2;
  const actualEnd = endAngleDeg - gapDeg / 2;
  const arcLength = actualEnd - actualStart;

  if (arcLength <= 0) return '';

  const outerStart = polarToCartesian(cx, cy, outerRadius, actualStart);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, actualEnd);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, actualEnd);
  const innerStart = polarToCartesian(cx, cy, innerRadius, actualStart);

  const largeArcFlag = arcLength > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
    'Z'
  ].join(' ');
}
