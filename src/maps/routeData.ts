/**
 * routeData.ts — Merge polyline coordinates with Strava stream data.
 *
 * The polyline and streams have different lengths:
 *   - Polyline: spatially simplified (200-2000 lat/lng points)
 *   - Streams: time-series, subsampled to ~60 points (originally per-second)
 *
 * Strategy: map each polyline point to the nearest stream sample by
 * interpolating along the position fraction [0..1] of each array.
 * This assumes polyline points are roughly proportionally distributed
 * along the route — valid for Google Encoded Polyline (Ramer-Douglas-Peucker).
 */

import { decodePolyline, Coordinate } from './polyline';
import { metersToMiles } from '../strava/convert';
import { PaceZones, HRZones } from '../types';
import { generateColorSegments } from './colorEngine';

export interface RoutePoint {
  latitude: number;
  longitude: number;
  pace: number | null;         // seconds per mile at this point
  heartRate: number | null;    // bpm
  elevation: number | null;    // meters
  distanceMiles: number;       // cumulative distance estimate at this point
}

export interface ColorSegment {
  coordinates: Coordinate[];
  color: string;               // hex
  zone: string;                // "easy" | "marathon" | "threshold" | "interval" | "repetition" | "rest" | "unknown"
}

export interface RouteData {
  points: RoutePoint[];
  bounds: { north: number; south: number; east: number; west: number };
  startPoint: Coordinate;
  endPoint: Coordinate;
  totalDistanceMiles: number;
  colorSegments: ColorSegment[];  // placeholder — populated by colorEngine in Phase 10B
}

// ─── Stream Interpolation ───────────────────────────────────

/**
 * Interpolate a stream value for polyline point at index `polyIdx`.
 * Maps the polyline fraction [0..1] to the stream fraction [0..1].
 */
function interpolateStream(
  stream: number[] | null,
  polyIdx: number,
  polyLength: number,
): number | null {
  if (!stream || stream.length === 0) return null;
  if (stream.length === 1) return stream[0];

  // Map polyline position fraction to stream index
  const fraction = polyIdx / Math.max(polyLength - 1, 1);
  const rawIdx = fraction * (stream.length - 1);
  const lo = Math.floor(rawIdx);
  const hi = Math.min(Math.ceil(rawIdx), stream.length - 1);
  const t = rawIdx - lo;

  // Linear interpolation between neighbouring stream samples
  return stream[lo] + t * (stream[hi] - stream[lo]);
}

// ─── Pace Conversion ────────────────────────────────────────

/** Convert m/s (Strava velocity) to seconds per mile. */
function mpsToSecPerMile(mps: number): number {
  if (mps <= 0) return 0;
  return 1609.344 / mps;
}

// ─── Route Bounds ───────────────────────────────────────────

function computeBounds(coords: Coordinate[]): RouteData['bounds'] {
  let north = -90, south = 90, east = -180, west = 180;
  for (const c of coords) {
    if (c.latitude > north) north = c.latitude;
    if (c.latitude < south) south = c.latitude;
    if (c.longitude > east) east = c.longitude;
    if (c.longitude < west) west = c.longitude;
  }
  return { north, south, east, west };
}

// ─── Main Builder ───────────────────────────────────────────

/**
 * Merge a Strava encoded polyline with pace, HR, elevation, and distance
 * streams into a structured RouteData object ready for rendering.
 *
 * @param polylineEncoded  Full-precision encoded polyline from Strava detail
 * @param paceStreamMps    velocity_smooth stream in m/s (subsampled ~60 pts)
 * @param hrStream         heartrate stream in bpm (subsampled ~60 pts)
 * @param elevationStream  altitude stream in meters (subsampled ~60 pts)
 * @param distanceStream   cumulative distance stream in meters (subsampled ~60 pts)
 * @param paceZones        User's Daniels pace zones (used for pre-computing pace segments)
 * @param hrZones          User's HR zones (used for pre-computing HR segments)
 */
export function buildRouteData(
  polylineEncoded: string,
  paceStreamMps: number[] | null,
  hrStream: number[] | null,
  elevationStream: number[] | null,
  distanceStream: number[] | null,
  paceZones: PaceZones,
  hrZones: HRZones,
): RouteData | null {
  const coords = decodePolyline(polylineEncoded);
  if (coords.length < 2) return null;

  const n = coords.length;
  const totalDistanceMeters = distanceStream
    ? distanceStream[distanceStream.length - 1]
    : null;
  const totalDistanceMiles = totalDistanceMeters
    ? metersToMiles(totalDistanceMeters)
    : 0;

  const points: RoutePoint[] = coords.map((coord, i) => {
    const velocityMps = interpolateStream(paceStreamMps, i, n);
    const pace = velocityMps != null && velocityMps > 0
      ? mpsToSecPerMile(velocityMps)
      : null;
    const heartRate = interpolateStream(hrStream, i, n);
    const elevation = interpolateStream(elevationStream, i, n);

    // Estimate cumulative distance at this point via position fraction
    const fraction = i / Math.max(n - 1, 1);
    const distanceMiles = totalDistanceMiles * fraction;

    return {
      latitude: coord.latitude,
      longitude: coord.longitude,
      pace,
      heartRate: heartRate != null ? Math.round(heartRate) : null,
      elevation,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
    };
  });

  // Pre-compute pace segments as the default. Component recalculates when
  // the user switches color modes, but this gives an instant first render.
  const colorSegments = generateColorSegments(points, 'pace', paceZones, hrZones);

  return {
    points,
    bounds: computeBounds(coords),
    startPoint: coords[0],
    endPoint: coords[coords.length - 1],
    totalDistanceMiles,
    colorSegments,
  };
}
