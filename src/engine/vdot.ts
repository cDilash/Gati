/**
 * VDOT Calculator based on Jack Daniels' Running Formula.
 *
 * The lookup table contains race-time predictions (in seconds) for VDOT
 * values from 30 to 85 at increments of 5. Linear interpolation is used
 * for values between table entries.
 */

interface VDOTEntry {
  vdot: number;
  fiveK: number;      // seconds
  tenK: number;        // seconds
  halfMarathon: number; // seconds
  marathon: number;     // seconds
}

const VDOT_TABLE: VDOTEntry[] = [
  { vdot: 30, fiveK: 1800, tenK: 3750, halfMarathon: 8340, marathon: 17400 },
  { vdot: 35, fiveK: 1560, tenK: 3246, halfMarathon: 7194, marathon: 14988 },
  { vdot: 40, fiveK: 1380, tenK: 2868, halfMarathon: 6348, marathon: 13212 },
  { vdot: 45, fiveK: 1236, tenK: 2568, halfMarathon: 5682, marathon: 11826 },
  { vdot: 50, fiveK: 1116, tenK: 2316, halfMarathon: 5124, marathon: 10656 },
  { vdot: 55, fiveK: 1014, tenK: 2106, halfMarathon: 4656, marathon: 9684 },
  { vdot: 60, fiveK: 928,  tenK: 1926, halfMarathon: 4260, marathon: 8856 },
  { vdot: 65, fiveK: 854,  tenK: 1770, halfMarathon: 3918, marathon: 8148 },
  { vdot: 70, fiveK: 790,  tenK: 1638, halfMarathon: 3624, marathon: 7536 },
  { vdot: 75, fiveK: 734,  tenK: 1524, halfMarathon: 3372, marathon: 7008 },
  { vdot: 80, fiveK: 684,  tenK: 1422, halfMarathon: 3150, marathon: 6552 },
  { vdot: 85, fiveK: 640,  tenK: 1332, halfMarathon: 2952, marathon: 6138 },
];

/**
 * Find the two bracketing table entries for a given VDOT and linearly
 * interpolate. If the value is outside the table range, clamp to the
 * nearest entry.
 */
function interpolate(
  vdot: number,
  field: keyof Omit<VDOTEntry, 'vdot'>
): number {
  if (vdot <= VDOT_TABLE[0].vdot) {
    return VDOT_TABLE[0][field];
  }
  if (vdot >= VDOT_TABLE[VDOT_TABLE.length - 1].vdot) {
    return VDOT_TABLE[VDOT_TABLE.length - 1][field];
  }

  for (let i = 0; i < VDOT_TABLE.length - 1; i++) {
    const lo = VDOT_TABLE[i];
    const hi = VDOT_TABLE[i + 1];
    if (vdot >= lo.vdot && vdot <= hi.vdot) {
      const t = (vdot - lo.vdot) / (hi.vdot - lo.vdot);
      return lo[field] + t * (hi[field] - lo[field]);
    }
  }

  // Fallback (should not reach here)
  return VDOT_TABLE[0][field];
}

/**
 * Reverse-interpolate: given a race time in seconds for a particular
 * distance, find the VDOT. Race times decrease as VDOT increases, so
 * the relationship is inverted.
 */
function reverseInterpolate(
  timeSeconds: number,
  field: keyof Omit<VDOTEntry, 'vdot'>
): number {
  // If the time is slower than the slowest entry, clamp
  if (timeSeconds >= VDOT_TABLE[0][field]) {
    return VDOT_TABLE[0].vdot;
  }
  // If the time is faster than the fastest entry, clamp
  if (timeSeconds <= VDOT_TABLE[VDOT_TABLE.length - 1][field]) {
    return VDOT_TABLE[VDOT_TABLE.length - 1].vdot;
  }

  // Table is sorted by ascending VDOT, meaning descending race times.
  // Find the bracket where lo.time >= timeSeconds >= hi.time.
  for (let i = 0; i < VDOT_TABLE.length - 1; i++) {
    const lo = VDOT_TABLE[i];
    const hi = VDOT_TABLE[i + 1];
    if (timeSeconds <= lo[field] && timeSeconds >= hi[field]) {
      const timeDelta = lo[field] - hi[field];
      const t = (lo[field] - timeSeconds) / timeDelta;
      return lo.vdot + t * (hi.vdot - lo.vdot);
    }
  }

  return VDOT_TABLE[0].vdot;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Calculate VDOT from a 5K time in seconds. */
export function calculateVDOTFrom5K(seconds: number): number {
  return Math.round(reverseInterpolate(seconds, 'fiveK') * 10) / 10;
}

/** Calculate VDOT from a 10K time in seconds. */
export function calculateVDOTFrom10K(seconds: number): number {
  return Math.round(reverseInterpolate(seconds, 'tenK') * 10) / 10;
}

/** Calculate VDOT from a half-marathon time in seconds. */
export function calculateVDOTFromHalf(seconds: number): number {
  return Math.round(reverseInterpolate(seconds, 'halfMarathon') * 10) / 10;
}

/** Predict marathon finish time in seconds for a given VDOT. */
export function predictMarathonTime(vdot: number): number {
  return Math.round(interpolate(vdot, 'marathon'));
}

/** Predict half-marathon finish time in seconds for a given VDOT. */
export function predictHalfMarathonTime(vdot: number): number {
  return Math.round(interpolate(vdot, 'halfMarathon'));
}

/** Predict 10K finish time in seconds for a given VDOT. */
export function predict10KTime(vdot: number): number {
  return Math.round(interpolate(vdot, 'tenK'));
}

/** Predict 5K finish time in seconds for a given VDOT. */
export function predict5KTime(vdot: number): number {
  return Math.round(interpolate(vdot, 'fiveK'));
}

/**
 * Format a pace (seconds per mile) as "M:SS".
 * Example: 480 -> "8:00"
 */
export function formatPace(secondsPerMile: number): string {
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format total seconds as "H:MM:SS" or "MM:SS" (if under 1 hour).
 */
export function formatTime(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Parse a time string ("H:MM:SS" or "MM:SS") into total seconds.
 */
export function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}
