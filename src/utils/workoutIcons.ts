/**
 * Workout type and metric icon mappings.
 * Uses MaterialCommunityIcons names from @expo/vector-icons.
 */

// Workout type → MaterialCommunityIcons name
export const WORKOUT_TYPE_ICONS: Record<string, string> = {
  easy: 'run',
  long_run: 'map-marker-distance',
  threshold: 'flash',
  intervals: 'timer-outline',
  tempo: 'speedometer',
  hill_repeats: 'terrain',
  fartlek: 'shuffle-variant',
  marathon_pace: 'flag-checkered',
  recovery: 'heart-pulse',
  rest: 'power-sleep',
};

// Metric type → MaterialCommunityIcons name
export const METRIC_ICONS = {
  hr: 'heart-pulse',
  pace: 'speedometer',
  distance: 'map-marker-distance',
  duration: 'timer-outline',
  calories: 'fire',
  elevation: 'terrain',
  cadence: 'shoe-print',
  rpe: 'gauge',
  effort: 'lightning-bolt',
} as const;

export function getWorkoutIcon(type: string): string {
  return WORKOUT_TYPE_ICONS[type] || 'run';
}
