/**
 * simplify.ts — Douglas-Peucker polyline simplification.
 *
 * Reduces the number of coordinates in a polyline while preserving shape.
 * Used for RouteThumbnail where a full 500-2000 point polyline would be
 * wasteful for a 120px-tall map tile.
 *
 * Epsilon is in degrees (latitude/longitude space).
 * A good default for running route thumbnails is 0.0001° ≈ 11 meters.
 */

export interface SimplePoint {
  latitude: number;
  longitude: number;
}

/** Perpendicular distance from point P to the line segment A→B (in degrees). */
function perpendicularDistance(p: SimplePoint, a: SimplePoint, b: SimplePoint): number {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;

  if (dx === 0 && dy === 0) {
    return Math.hypot(p.longitude - a.longitude, p.latitude - a.latitude);
  }

  const t = ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / (dx * dx + dy * dy);
  const cx = a.longitude + t * dx;
  const cy = a.latitude + t * dy;
  return Math.hypot(p.longitude - cx, p.latitude - cy);
}

/**
 * Recursively reduce points using the Ramer-Douglas-Peucker algorithm.
 * Points farther than `epsilon` from the simplified line are preserved.
 */
export function simplifyPolyline(points: SimplePoint[], epsilon: number = 0.0001): SimplePoint[] {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the start→end line
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    // Significant point — recursively simplify both halves
    const left = simplifyPolyline(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolyline(points.slice(maxIdx), epsilon);
    // Merge, removing the duplicate junction point
    return [...left.slice(0, -1), ...right];
  }

  // All intermediate points are within epsilon — collapse to endpoints
  return [points[0], points[points.length - 1]];
}
