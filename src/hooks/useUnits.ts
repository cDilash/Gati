/**
 * useUnits — hook for unit-aware display formatting.
 * Reads the user's unit preference and returns formatters.
 * Internal storage is always imperial (miles, sec/mile, feet, kg, cm, °F).
 */

import { useSettingsStore } from '../stores/settingsStore';
import {
  UnitSystem,
  formatDistance,
  formatPaceWithUnit,
  formatElevation,
  formatWeightKg,
  formatHeight,
  formatTemp,
  formatVolume,
  distanceLabel,
  paceSuffix,
  elevationLabel,
  displayDistance,
  displayPace,
  displayElevation,
} from '../utils/units';

export function useUnits() {
  const units = useSettingsStore(s => s.units);
  return {
    units,
    // Formatted strings
    dist: (miles: number, decimals?: number) => formatDistance(miles, units, decimals),
    pace: (secPerMile: number) => formatPaceWithUnit(secPerMile, units),
    elev: (feet: number) => formatElevation(feet, units),
    wt: (kg: number) => formatWeightKg(kg, units),
    ht: (cm: number) => formatHeight(cm, units),
    temp: (f: number) => formatTemp(f, units),
    vol: (miles: number, decimals?: number) => formatVolume(miles, units, decimals),
    // Labels
    distLabel: distanceLabel(units),
    paceSuffix: paceSuffix(units),
    elevLabel: elevationLabel(units),
    // Raw conversions (for charts, calculations)
    rawDist: (miles: number) => displayDistance(miles, units),
    rawPace: (secPerMile: number) => displayPace(secPerMile, units),
    rawElev: (feet: number) => displayElevation(feet, units),
  };
}

/** Non-hook version for use outside React components (store actions, AI prompts) */
export function getUnits(): UnitSystem {
  return useSettingsStore.getState().units;
}
