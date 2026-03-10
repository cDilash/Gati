import { PaceZones, PaceRange, HRZones, HRZone, PaceZoneName } from '../types';
import { formatPace } from './vdot';

/**
 * Pace zone calculator using Daniels methodology.
 *
 * Threshold pace is derived from an exponential decay model:
 *   P_t = 0.0697 * VDOT^(-0.8081)  (pace in days/km)
 * Converted: days/km -> seconds/km -> seconds/mile
 */

export function calculatePaceZones(vdot: number): PaceZones {
  // Calculate threshold pace in seconds per mile
  const thresholdDaysPerKm = 0.0697 * Math.pow(vdot, -0.8081);
  const thresholdSecPerKm = thresholdDaysPerKm * 86400;
  const thresholdSecPerMile = thresholdSecPerKm * 1.60934;

  // Zone ratios relative to threshold pace
  // Slower pace = higher number (more seconds per mile)
  const zones: PaceZones = {
    E: {
      min: Math.round(thresholdSecPerMile * 1.25), // slowest easy
      max: Math.round(thresholdSecPerMile * 1.15), // fastest easy
    },
    M: {
      min: Math.round(thresholdSecPerMile * 1.10),
      max: Math.round(thresholdSecPerMile * 1.05),
    },
    T: {
      min: Math.round(thresholdSecPerMile * 1.02),
      max: Math.round(thresholdSecPerMile * 0.98),
    },
    I: {
      min: Math.round(thresholdSecPerMile * 0.94),
      max: Math.round(thresholdSecPerMile * 0.88),
    },
    R: {
      min: Math.round(thresholdSecPerMile * 0.86),
      max: Math.round(thresholdSecPerMile * 0.80),
    },
  };
  return zones;
}

/** Karvonen formula HR zones. */
export function calculateHRZones(maxHr: number, restHr: number): HRZones {
  const hrr = maxHr - restHr;
  const karvonen = (low: number, high: number): HRZone => ({
    name: '',
    min: Math.round(restHr + hrr * low),
    max: Math.round(restHr + hrr * high),
  });
  return {
    zone1: { ...karvonen(0.50, 0.60), name: 'Recovery' },
    zone2: { ...karvonen(0.60, 0.70), name: 'Easy/Aerobic' },
    zone3: { ...karvonen(0.70, 0.80), name: 'Tempo' },
    zone4: { ...karvonen(0.80, 0.90), name: 'Threshold' },
    zone5: { ...karvonen(0.90, 1.00), name: 'VO2max' },
  };
}

export function formatPaceRange(range: PaceRange): string {
  return `${formatPace(range.min)} - ${formatPace(range.max)}`;
}

export function formatPaceZones(zones: PaceZones): Record<PaceZoneName, string> {
  return {
    E: formatPaceRange(zones.E),
    M: formatPaceRange(zones.M),
    T: formatPaceRange(zones.T),
    I: formatPaceRange(zones.I),
    R: formatPaceRange(zones.R),
  };
}

export function rpeToZone(rpe: number): PaceZoneName {
  if (rpe <= 3) return 'E';
  if (rpe <= 5) return 'M';
  if (rpe <= 7) return 'T';
  if (rpe <= 9) return 'I';
  return 'R';
}

export const ZONE_DESCRIPTIONS: Record<PaceZoneName, string> = {
  E: 'Easy — conversational pace, builds aerobic base',
  M: 'Marathon — goal marathon race pace',
  T: 'Threshold — comfortably hard, lactate threshold',
  I: 'Interval — VO2max development, hard effort',
  R: 'Repetition — speed/form work, very fast',
};

export const ZONE_RPE: Record<PaceZoneName, string> = {
  E: 'RPE 2-3',
  M: 'RPE 4-5',
  T: 'RPE 6-7',
  I: 'RPE 8-9',
  R: 'RPE 9-10',
};
