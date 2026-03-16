/**
 * Cross-Training Advisor — pure logic, zero Gemini calls.
 *
 * Evaluates the impact of cross-training on tomorrow's scheduled workout
 * and suggests modifications when conflicts exist.
 */

import { CrossTraining, Workout } from '../types';

export interface SwapOption {
  label: string;
  action: 'keep' | 'swap_to_easy' | 'reduce_distance';
  description: string;
}

export interface SwapSuggestion {
  shouldSuggest: boolean;
  severity: 'strong' | 'moderate' | 'none';
  tomorrowWorkout: Workout | null;
  message: string;
  options: SwapOption[];
}

const QUALITY_TYPES = new Set(['threshold', 'interval', 'tempo', 'marathon_pace', 'hill_repeats']);

export function evaluateCrossTrainingImpact(
  crossTraining: CrossTraining,
  tomorrowWorkout: Workout | null,
  recoveryScore: number | null,
): SwapSuggestion {
  const noSuggestion: SwapSuggestion = {
    shouldSuggest: false,
    severity: 'none',
    tomorrowWorkout,
    message: '',
    options: [],
  };

  // No tomorrow workout or it's rest/already done → no suggestion
  if (!tomorrowWorkout) return noSuggestion;
  if (tomorrowWorkout.status !== 'upcoming') return noSuggestion;
  if (tomorrowWorkout.workout_type === 'rest') return noSuggestion;

  const impact = crossTraining.impact;
  const isQuality = QUALITY_TYPES.has(tomorrowWorkout.workout_type);
  const isLongRun = tomorrowWorkout.workout_type === 'long';
  const isEasy = tomorrowWorkout.workout_type === 'easy' || tomorrowWorkout.workout_type === 'recovery';
  const ctLabel = crossTraining.type === 'leg_day' ? 'heavy leg day'
    : crossTraining.type === 'full_body' ? 'full body workout'
    : crossTraining.type === 'cycling' ? 'cycling session'
    : crossTraining.type === 'swimming' ? 'swimming session'
    : crossTraining.type;

  const lowRecovery = recoveryScore !== null && recoveryScore < 60;

  // HIGH IMPACT (leg day)
  if (impact === 'high') {
    if (isQuality) {
      const recoveryNote = lowRecovery
        ? ` Your recovery score is ${recoveryScore}/100 — your body is telling you to back off.`
        : '';
      return {
        shouldSuggest: true,
        severity: 'strong',
        tomorrowWorkout,
        message: `You logged a ${ctLabel}. Tomorrow's ${tomorrowWorkout.title} will be compromised — your legs won't recover in time.${recoveryNote}`,
        options: [
          { label: 'Swap to Easy', action: 'swap_to_easy', description: `Convert to easy run, same distance` },
          { label: 'Keep as Planned', action: 'keep', description: 'Proceed with the quality session' },
        ],
      };
    }

    if (isLongRun) {
      return {
        shouldSuggest: true,
        severity: 'strong',
        tomorrowWorkout,
        message: `Heavy leg day before a long run is risky. Consider reducing tomorrow's ${tomorrowWorkout.target_distance_miles?.toFixed(1) ?? ''}mi long run.`,
        options: [
          { label: 'Reduce by 25%', action: 'reduce_distance', description: `Cut to ${((tomorrowWorkout.target_distance_miles ?? 0) * 0.75).toFixed(1)}mi` },
          { label: 'Swap to Easy', action: 'swap_to_easy', description: 'Convert to easy run' },
          { label: 'Keep as Planned', action: 'keep', description: 'Run the full long run' },
        ],
      };
    }

    // Easy/recovery after leg day is fine
    return noSuggestion;
  }

  // MODERATE IMPACT (full body, cycling, swimming)
  if (impact === 'moderate') {
    if (isQuality && (tomorrowWorkout.workout_type === 'interval' || tomorrowWorkout.workout_type === 'hill_repeats')) {
      return {
        shouldSuggest: true,
        severity: 'moderate',
        tomorrowWorkout,
        message: `You did a ${ctLabel} today. Tomorrow's high-intensity ${tomorrowWorkout.title} may be harder than usual. Proceed but listen to your body.`,
        options: [
          { label: 'Swap to Easy', action: 'swap_to_easy', description: 'Play it safe' },
          { label: 'Keep as Planned', action: 'keep', description: 'Go for it' },
        ],
      };
    }
    return noSuggestion;
  }

  // LOW or POSITIVE → no suggestion
  return noSuggestion;
}
