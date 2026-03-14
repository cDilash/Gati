/**
 * Replan Trigger Detection
 *
 * Pure functions that detect when a full plan regeneration is required,
 * rather than just adjusting individual workouts.
 *
 * 3 deterministic triggers:
 *   1. Low completion rate (2+ consecutive weeks < 60%)
 *   2. VDOT shift >= 3 points
 *   3. Extended training gap (10+ consecutive days)
 */

import { TrainingWeek, Workout } from '../types';

export interface ReplanTriggerResult {
  shouldReplan: boolean;
  reason: string | null;
  trigger: 'low_completion' | 'vdot_shift' | 'extended_gap' | 'ai_flagged' | null;
}

const NO_REPLAN: ReplanTriggerResult = { shouldReplan: false, reason: null, trigger: null };

/**
 * Check if completion rate has been below 60% for 2+ consecutive weeks.
 * Only considers non-taper weeks that are "past" (>=50% of workouts resolved).
 */
export function checkLowCompletion(
  weeks: TrainingWeek[],
  workouts: Workout[],
): ReplanTriggerResult {
  // Get non-taper weeks sorted by week_number descending (most recent first)
  const nonTaperWeeks = weeks
    .filter((w) => w.phase !== 'taper')
    .sort((a, b) => b.week_number - a.week_number);

  let consecutiveLowWeeks = 0;

  for (const week of nonTaperWeeks) {
    const weekWorkouts = workouts.filter(
      (wo) => wo.week_id === week.id && wo.workout_type !== 'rest',
    );

    if (weekWorkouts.length === 0) continue;

    // Count resolved (completed or skipped) workouts
    const resolvedCount = weekWorkouts.filter(
      (wo) => wo.status === 'completed' || wo.status === 'skipped',
    ).length;

    // Only count weeks that are "past" — at least 50% resolved
    if (resolvedCount / weekWorkouts.length < 0.5) continue;

    const completedCount = weekWorkouts.filter(
      (wo) => wo.status === 'completed',
    ).length;
    const completionRate = completedCount / weekWorkouts.length;

    if (completionRate < 0.6) {
      consecutiveLowWeeks++;
    } else {
      // Streak broken — stop checking
      break;
    }
  }

  if (consecutiveLowWeeks >= 2) {
    return {
      shouldReplan: true,
      reason: `Completion rate below 60% for ${consecutiveLowWeeks} consecutive weeks. Plan needs recalibration to match your actual training load.`,
      trigger: 'low_completion',
    };
  }

  return NO_REPLAN;
}

/**
 * Check if VDOT has shifted by 3+ points from plan creation.
 */
export function checkVDOTShift(
  currentVDOT: number,
  vdotAtCreation: number,
): ReplanTriggerResult {
  const diff = Math.abs(currentVDOT - vdotAtCreation);

  if (diff >= 3) {
    const direction = currentVDOT > vdotAtCreation ? 'improved' : 'decreased';
    return {
      shouldReplan: true,
      reason: `VDOT has ${direction} from ${vdotAtCreation.toFixed(1)} to ${currentVDOT.toFixed(1)} (shift of ${diff.toFixed(1)}). Training paces and volume targets need recalculation.`,
      trigger: 'vdot_shift',
    };
  }

  return NO_REPLAN;
}

/**
 * Check if there's been 10+ consecutive days without completed training.
 * Looks at non-rest workouts from the last 21 days.
 */
export function checkExtendedGap(
  workouts: Workout[],
  today: string,
): ReplanTriggerResult {
  const todayDate = new Date(today + 'T00:00:00');
  const cutoff = new Date(todayDate);
  cutoff.setDate(cutoff.getDate() - 21);

  // Get non-rest workouts in the last 21 days, sorted by date
  const recentWorkouts = workouts
    .filter((wo) => {
      if (wo.workout_type === 'rest') return false;
      const woDate = new Date(wo.date + 'T00:00:00');
      return woDate >= cutoff && woDate <= todayDate;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recentWorkouts.length === 0) {
    // No workouts at all in 21 days — definitely a gap
    return {
      shouldReplan: true,
      reason: '21 consecutive days without training. Plan assumptions no longer hold — need fresh start from current fitness.',
      trigger: 'extended_gap',
    };
  }

  // Build a set of dates with completed workouts
  const completedDates = new Set<string>();
  for (const wo of recentWorkouts) {
    if (wo.status === 'completed') {
      completedDates.add(wo.date);
    }
  }

  // Walk through the 21-day window and find the longest gap without a completed workout
  let maxGapDays = 0;
  let currentGap = 0;

  for (let i = 0; i <= 21; i++) {
    const checkDate = new Date(cutoff);
    checkDate.setDate(checkDate.getDate() + i);
    const dateStr =
      checkDate.getFullYear() +
      '-' +
      String(checkDate.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(checkDate.getDate()).padStart(2, '0');

    if (completedDates.has(dateStr)) {
      currentGap = 0;
    } else {
      currentGap++;
      if (currentGap > maxGapDays) {
        maxGapDays = currentGap;
      }
    }
  }

  if (maxGapDays >= 10) {
    return {
      shouldReplan: true,
      reason: `${maxGapDays} consecutive days without training. Plan assumptions no longer hold — need fresh start from current fitness.`,
      trigger: 'extended_gap',
    };
  }

  return NO_REPLAN;
}

/**
 * Run all 3 deterministic replan checks in priority order.
 * Returns the first trigger that fires, or no-replan if none do.
 *
 * Priority: extended_gap > vdot_shift > low_completion
 */
export function checkReplanTriggers(
  weeks: TrainingWeek[],
  workouts: Workout[],
  currentVDOT: number,
  vdotAtCreation: number,
  today: string,
): ReplanTriggerResult {
  // 1. Extended gap (most urgent — fitness has decayed)
  const gapResult = checkExtendedGap(workouts, today);
  if (gapResult.shouldReplan) return gapResult;

  // 2. VDOT shift (paces are wrong)
  const vdotResult = checkVDOTShift(currentVDOT, vdotAtCreation);
  if (vdotResult.shouldReplan) return vdotResult;

  // 3. Low completion (plan is too ambitious)
  const completionResult = checkLowCompletion(weeks, workouts);
  if (completionResult.shouldReplan) return completionResult;

  return NO_REPLAN;
}
