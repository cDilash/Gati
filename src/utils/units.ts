// Unit conversion utilities.
// Internal storage is ALWAYS miles/lbs. Convert at display/input boundary only.

export type UnitSystem = 'imperial' | 'metric';
export type DistanceUnit = 'mi' | 'km';
export type WeightUnit = 'lbs' | 'kg';
export type PaceUnit = 'min/mi' | 'min/km';

const MI_TO_KM = 1.60934;
const KM_TO_MI = 0.621371;
const LBS_TO_KG = 0.453592;
const KG_TO_LBS = 2.20462;

// ─── Distance ────────────────────────────────────────────────

/** Convert miles (internal) to display unit */
export function displayDistance(miles: number, unit: UnitSystem): number {
  return unit === 'metric' ? miles * MI_TO_KM : miles;
}

/** Convert display unit back to miles (internal) */
export function toMiles(value: number, unit: UnitSystem): number {
  return unit === 'metric' ? value * KM_TO_MI : value;
}

/** Format distance with unit label */
export function formatDistance(miles: number, unit: UnitSystem, decimals: number = 1): string {
  const val = displayDistance(miles, unit);
  return `${val.toFixed(decimals)}${distanceLabel(unit)}`;
}

/** Short distance label: "mi" or "km" */
export function distanceLabel(unit: UnitSystem): string {
  return unit === 'metric' ? 'km' : 'mi';
}

/** Full distance label: "miles" or "kilometers" */
export function distanceLabelFull(unit: UnitSystem): string {
  return unit === 'metric' ? 'kilometers' : 'miles';
}

// ─── Weight ──────────────────────────────────────────────────

/** Convert lbs (internal) to display unit */
export function displayWeight(lbs: number, unit: UnitSystem): number {
  return unit === 'metric' ? lbs * LBS_TO_KG : lbs;
}

/** Convert display unit back to lbs (internal) */
export function toLbs(value: number, unit: UnitSystem): number {
  return unit === 'metric' ? value * KG_TO_LBS : value;
}

/** Format weight with unit label */
export function formatWeight(lbs: number, unit: UnitSystem, decimals: number = 0): string {
  const val = displayWeight(lbs, unit);
  return `${val.toFixed(decimals)}${weightLabel(unit)}`;
}

/** Short weight label: "lbs" or "kg" */
export function weightLabel(unit: UnitSystem): string {
  return unit === 'metric' ? 'kg' : 'lbs';
}

// ─── Pace ────────────────────────────────────────────────────

/** Convert seconds-per-mile (internal) to display pace */
export function displayPace(secPerMile: number, unit: UnitSystem): number {
  return unit === 'metric' ? secPerMile / MI_TO_KM : secPerMile;
}

/** Format pace as M:SS with unit */
export function formatPaceWithUnit(secPerMile: number, unit: UnitSystem): string {
  const sec = displayPace(secPerMile, unit);
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Pace unit label: "min/mi" or "min/km" */
export function paceLabel(unit: UnitSystem): string {
  return unit === 'metric' ? 'min/km' : 'min/mi';
}

/** Format a pace range (min=slowest, max=fastest in sec/mi) */
export function formatPaceRangeWithUnit(range: { min: number; max: number }, unit: UnitSystem): string {
  return `${formatPaceWithUnit(range.min, unit)} - ${formatPaceWithUnit(range.max, unit)}`;
}

// ─── Volume ──────────────────────────────────────────────────

/** Format weekly volume: "25 mi/week" or "40 km/week" */
export function formatVolume(miles: number, unit: UnitSystem, decimals: number = 0): string {
  const val = displayDistance(miles, unit);
  return `${val.toFixed(decimals)} ${distanceLabel(unit)}`;
}
