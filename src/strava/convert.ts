/**
 * Unit conversion helpers for Strava data.
 * Strava returns everything in metric (meters, m/s).
 * Our app works in imperial (miles, sec/mile).
 */

const METERS_PER_MILE = 1609.344;

/** Convert meters to miles */
export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Convert miles to meters */
export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

/** Convert meters/second to seconds per mile */
export function mpsToSecondsPerMile(mps: number): number {
  if (mps <= 0) return 0;
  return METERS_PER_MILE / mps;
}

/** Convert meters to feet */
export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

/**
 * Format m/s speed as "M:SS /mi" pace string.
 * e.g. 3.0 m/s → "8:56 /mi"
 */
export function formatPaceFromMps(mps: number): string {
  if (mps <= 0) return '--:--';
  const totalSeconds = Math.round(mpsToSecondsPerMile(mps));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
