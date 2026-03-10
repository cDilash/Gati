/**
 * Adaptive Training Engine — Pure Functions
 *
 * All functions take data in, return adjustments out.
 * Zero side effects: no SQLite, no Zustand, no network calls.
 * The store layer handles all reads/writes.
 */

import {
  PerformanceMetric,
  Workout,
  WorkoutAdjustment,
  VDOTUpdateResult,
  PlanReconciliation,
  TrainingWeek,
  PaceZones,
  HRZones,
  WorkoutType,
  RecoveryStatus,
} from '../types';

// ─── ACWR ───────────────────────────────────────────────────

/**
 * Calculate Acute:Chronic Workload Ratio.
 *
 * Acute  = total distance from the last 7 days
 * Chronic = average weekly distance over the last 28 days
 *
 * @param metrics - All performance metrics from the last 28 days (caller provides)
 * @param today - ISO date string for "today" (injectable for testing)
 */
export function calculateACWR(metrics: PerformanceMetric[], today: string): number {
  const todayMs = new Date(today).getTime();
  const day7Ago = new Date(todayMs - 7 * 86400000).toISOString().split('T')[0];
  const day28Ago = new Date(todayMs - 28 * 86400000).toISOString().split('T')[0];

  const acuteMetrics = metrics.filter(m => m.date >= day7Ago && m.date <= today);
  const chronicMetrics = metrics.filter(m => m.date >= day28Ago && m.date <= today);

  const acuteLoad = acuteMetrics.reduce((sum, m) => sum + m.distance_miles, 0);

  if (chronicMetrics.length === 0) return 1.0; // No history — assume balanced

  // Calculate chronic as average weekly distance
  const chronicTotal = chronicMetrics.reduce((sum, m) => sum + m.distance_miles, 0);
  const weeksOfData = Math.max(
    (new Date(today).getTime() - new Date(chronicMetrics[chronicMetrics.length - 1]?.date || day28Ago).getTime()) / (7 * 86400000),
    1
  );
  const chronicWeeklyAvg = chronicTotal / Math.min(weeksOfData, 4);

  if (chronicWeeklyAvg === 0) return acuteLoad > 0 ? 2.0 : 1.0; // Avoid division by zero

  return Math.round((acuteLoad / chronicWeeklyAvg) * 100) / 100;
}

/**
 * Check ACWR and return safety adjustments for upcoming workouts.
 *
 * - > 1.3: Convert quality sessions to easy runs
 * - > 1.5: Reduce ALL scheduled run distances by 20%
 * - < 0.8: No auto-adjustment (detraining flag only)
 */
export function checkACWRSafety(
  acwr: number,
  upcomingWorkouts: Workout[],
  today: string,
  recoveryStatus?: RecoveryStatus | null,
): WorkoutAdjustment[] {
  const adjustments: WorkoutAdjustment[] = [];
  const now = new Date().toISOString();

  // Recovery-based threshold shifting
  let convertThreshold = 1.3;
  let reduceThreshold = 1.5;
  if (recoveryStatus && recoveryStatus.signalCount >= 2) {
    if (recoveryStatus.score >= 80) {
      convertThreshold = 1.4;
      reduceThreshold = 1.6;
    } else if (recoveryStatus.score < 40) {
      convertThreshold = 1.2;
      reduceThreshold = 1.4;
    }
  }

  // Only adjust future scheduled workouts (not completed, skipped, or rest)
  const eligible = upcomingWorkouts.filter(
    w => w.date >= today && w.status === 'scheduled' && w.workout_type !== 'rest'
  );

  if (acwr > reduceThreshold) {
    // Danger zone: reduce ALL distances by 20%
    for (const w of eligible) {
      const newDistance = Math.max(Math.round(w.distance_miles * 0.8 * 10) / 10, 3);
      if (newDistance < w.distance_miles) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'reduce_distance',
          originalDistance: w.distance_miles,
          newDistance,
          originalType: w.workout_type,
          newType: w.workout_type,
          reason: `ACWR ${acwr.toFixed(2)} exceeds ${reduceThreshold} threshold${recoveryStatus ? ` (recovery ${recoveryStatus.score}/100)` : ''}. Distance reduced 20%.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  } else if (acwr > convertThreshold) {
    // Elevated: convert quality sessions to easy
    const qualityTypes: WorkoutType[] = ['tempo', 'interval', 'marathon_pace'];
    for (const w of eligible) {
      if (qualityTypes.includes(w.workout_type)) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'convert_to_easy',
          originalDistance: w.distance_miles,
          newDistance: w.distance_miles, // keep distance, change type
          originalType: w.workout_type,
          newType: 'easy',
          reason: `ACWR ${acwr.toFixed(2)} exceeds ${convertThreshold} threshold${recoveryStatus ? ` (recovery ${recoveryStatus.score}/100)` : ''}. Quality → easy.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  }

  return adjustments;
}

// ─── VDOT Update ────────────────────────────────────────────

interface WorkoutWithMetric {
  workout: Workout;
  metric: PerformanceMetric;
}

/**
 * Evaluate whether VDOT should be updated based on recent performance.
 *
 * With HR data (2+ weeks): +/- 1.0 VDOT, confidence "high"
 * Without HR (3+ weeks): +/- 0.5 VDOT, confidence "moderate"
 */
export function evaluateVDOTUpdate(
  completedQualityWorkouts: WorkoutWithMetric[],
  currentVDOT: number,
  paceZones: PaceZones,
  hrZones: HRZones,
  recoveryStatus?: RecoveryStatus | null,
): VDOTUpdateResult | null {
  if (completedQualityWorkouts.length < 2) return null;

  // Recovery guard: skip VDOT update if poorly recovered (distorted performance)
  if (recoveryStatus && recoveryStatus.signalCount >= 2 && recoveryStatus.score < 40) {
    return null;
  }

  // Split into workouts with and without HR data
  const withHR = completedQualityWorkouts.filter(wm => wm.metric.avg_hr != null);
  const allWorkouts = completedQualityWorkouts;

  // Check for overperformance (faster than target)
  const overperforming: WorkoutWithMetric[] = [];
  const underperforming: WorkoutWithMetric[] = [];

  for (const wm of allWorkouts) {
    const zone = wm.workout.target_pace_zone;
    const targetPace = paceZones[zone];
    if (!targetPace) continue;

    const actualPace = wm.metric.avg_pace_per_mile;
    // targetPace.max = fastest expected pace (lowest seconds)
    // If actual is 10+ sec/mi faster than the fastest expected pace → overperforming
    const paceGap = targetPace.max - actualPace;

    if (paceGap >= 10) {
      // Check HR if available
      if (wm.metric.avg_hr != null) {
        // HR should be in Zone 3-4 (not spiking to Zone 5)
        if (wm.metric.avg_hr <= hrZones.zone4.max) {
          overperforming.push(wm);
        }
        // If HR is in Zone 5 despite fast pace, it's a max effort — not adaptation
      } else {
        // No HR — still count it, but will require more evidence
        overperforming.push(wm);
      }
    } else if (paceGap <= -10) {
      // 10+ sec/mi SLOWER than slowest expected pace
      if (wm.metric.avg_hr != null) {
        // HR elevated above Zone 4 → struggling
        if (wm.metric.avg_hr > hrZones.zone4.max) {
          underperforming.push(wm);
        }
      } else {
        underperforming.push(wm);
      }
    }
  }

  // Determine if we have enough evidence
  const hasHREvidence = withHR.length >= 2;

  // With HR: need 2+ consistent workouts over 2+ weeks
  // Without HR: need 3+ consistent workouts over 3+ weeks
  const requiredCount = hasHREvidence ? 2 : 3;
  const vdotDelta = hasHREvidence ? 1.0 : 0.5;
  const confidence = hasHREvidence ? 'high' as const : 'moderate' as const;

  // Check span covers enough weeks
  function spansEnoughWeeks(workouts: WorkoutWithMetric[], minWeeks: number): boolean {
    if (workouts.length < 2) return false;
    const dates = workouts.map(wm => new Date(wm.workout.date).getTime()).sort();
    const spanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
    return spanDays >= (minWeeks - 1) * 7;
  }

  const requiredWeeks = hasHREvidence ? 2 : 3;

  if (overperforming.length >= requiredCount && spansEnoughWeeks(overperforming, requiredWeeks)) {
    return {
      previousVDOT: currentVDOT,
      newVDOT: Math.round((currentVDOT + vdotDelta) * 10) / 10,
      reason: hasHREvidence
        ? 'Consistent threshold overperformance with controlled heart rate'
        : 'Consistent threshold overperformance (pace data only)',
      evidenceWorkouts: overperforming.map(wm => wm.workout.id),
      confidenceLevel: confidence,
    };
  }

  if (underperforming.length >= requiredCount && spansEnoughWeeks(underperforming, requiredWeeks)) {
    return {
      previousVDOT: currentVDOT,
      newVDOT: Math.round((currentVDOT - vdotDelta) * 10) / 10,
      reason: hasHREvidence
        ? 'Sustained underperformance with elevated heart rate'
        : 'Sustained underperformance (pace data only)',
      evidenceWorkouts: underperforming.map(wm => wm.workout.id),
      confidenceLevel: confidence,
    };
  }

  return null;
}

// ─── Weekly Reconciliation ──────────────────────────────────

/**
 * Reconcile a completed week: compare planned vs actual, generate adjustments.
 */
export function reconcileWeek(
  completedWeek: TrainingWeek,
  weekWorkouts: Workout[],
  weekMetrics: PerformanceMetric[],
  upcomingWorkouts: Workout[],
  acwr: number,
): PlanReconciliation {
  const adjustments: WorkoutAdjustment[] = [];
  const now = new Date().toISOString();

  const plannedVolume = completedWeek.target_volume_miles;
  const actualVolume = weekMetrics.reduce((sum, m) => sum + m.distance_miles, 0);

  const nonRestWorkouts = weekWorkouts.filter(w => w.workout_type !== 'rest');
  const completedCount = nonRestWorkouts.filter(w => w.status === 'completed').length;
  const completionRate = nonRestWorkouts.length > 0 ? completedCount / nonRestWorkouts.length : 1;

  const volumeRatio = plannedVolume > 0 ? actualVolume / plannedVolume : 1;

  // Get upcoming easy runs for adjustments
  const upcomingEasy = upcomingWorkouts.filter(
    w => w.status === 'scheduled' && (w.workout_type === 'easy' || w.workout_type === 'recovery')
  );

  if (volumeRatio < 0.8 && upcomingEasy.length > 0) {
    // Undertrained — slightly extend next 2-3 easy runs
    const deficit = plannedVolume - actualVolume;
    const runsToExtend = Math.min(upcomingEasy.length, 3);
    const extraPerRun = Math.min(deficit * 0.3 / runsToExtend, 1.0); // max 1mi extra per run

    for (let i = 0; i < runsToExtend; i++) {
      const w = upcomingEasy[i];
      const newDistance = Math.round((w.distance_miles + extraPerRun) * 10) / 10;
      // Enforce max 15% increase
      const maxAllowed = Math.round(w.distance_miles * 1.15 * 10) / 10;
      const finalDistance = Math.min(newDistance, maxAllowed);

      if (finalDistance > w.distance_miles) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'increase_distance',
          originalDistance: w.distance_miles,
          newDistance: finalDistance,
          originalType: w.workout_type,
          newType: w.workout_type,
          reason: `Week ${completedWeek.week_number} was ${Math.round(volumeRatio * 100)}% of target. Adding ${(finalDistance - w.distance_miles).toFixed(1)}mi to maintain chronic load.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  } else if (volumeRatio > 1.2 && upcomingEasy.length > 0) {
    // Overtrained — reduce next week's easy runs
    const excess = actualVolume - plannedVolume;
    const runsToReduce = Math.min(upcomingEasy.length, 3);
    const reducePerRun = Math.min(excess * 0.3 / runsToReduce, 1.5);

    for (let i = 0; i < runsToReduce; i++) {
      const w = upcomingEasy[i];
      const newDistance = Math.max(Math.round((w.distance_miles - reducePerRun) * 10) / 10, 3);
      if (newDistance < w.distance_miles) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'reduce_distance',
          originalDistance: w.distance_miles,
          newDistance,
          originalType: w.workout_type,
          newType: w.workout_type,
          reason: `Week ${completedWeek.week_number} exceeded target by ${Math.round((volumeRatio - 1) * 100)}%. Reducing easy volume to compensate.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  }

  // Flag for AI analysis if completion rate is low or ACWR is out of range
  const aiAnalysisNeeded = completionRate < 0.6 || acwr > 1.3 || acwr < 0.8;

  return {
    weekNumber: completedWeek.week_number,
    plannedVolume,
    actualVolume: Math.round(actualVolume * 10) / 10,
    completionRate: Math.round(completionRate * 100) / 100,
    acwr,
    adjustments,
    vdotUpdate: null, // Caller adds this after running evaluateVDOTUpdate
    aiAnalysisNeeded,
  };
}

// ─── Missed Workout Triage ──────────────────────────────────

/**
 * Triage a skipped workout and redistribute volume if appropriate.
 */
export function triageMissedWorkout(
  skippedWorkout: Workout,
  remainingWeekWorkouts: Workout[],
): WorkoutAdjustment[] {
  const adjustments: WorkoutAdjustment[] = [];
  const now = new Date().toISOString();

  // Rest/recovery: no action
  if (skippedWorkout.workout_type === 'rest' || skippedWorkout.workout_type === 'recovery') {
    return adjustments;
  }

  // Quality session (tempo, interval, marathon_pace): do NOT redistribute
  const qualityTypes: WorkoutType[] = ['tempo', 'interval', 'marathon_pace'];
  if (qualityTypes.includes(skippedWorkout.workout_type)) {
    return adjustments;
  }

  // Get remaining scheduled easy/recovery runs this week
  const remaining = remainingWeekWorkouts.filter(
    w => w.status === 'scheduled' &&
         w.id !== skippedWorkout.id &&
         (w.workout_type === 'easy' || w.workout_type === 'recovery')
  );

  if (skippedWorkout.workout_type === 'easy' && remaining.length > 0) {
    // Distribute 50% of missed distance across remaining easy runs
    const redistributeVolume = skippedWorkout.distance_miles * 0.5;
    const perRun = redistributeVolume / remaining.length;

    for (const w of remaining) {
      const extra = Math.min(perRun, 1.0); // max 1mi extra per run
      const newDistance = Math.round((w.distance_miles + extra) * 10) / 10;
      // Enforce max 15% increase
      const maxAllowed = Math.round(w.distance_miles * 1.15 * 10) / 10;
      const finalDistance = Math.min(newDistance, maxAllowed);

      if (finalDistance > w.distance_miles) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'increase_distance',
          originalDistance: w.distance_miles,
          newDistance: finalDistance,
          originalType: w.workout_type,
          newType: w.workout_type,
          reason: `Redistributing ${(finalDistance - w.distance_miles).toFixed(1)}mi from skipped easy run on ${skippedWorkout.date}.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  }

  if (skippedWorkout.workout_type === 'long') {
    // Long run: try to slot a shorter version on a remaining weekend day
    const weekendDays = remaining.filter(w => w.day_of_week >= 5); // Sat=5, Sun=6
    if (weekendDays.length > 0) {
      const target = weekendDays[0];
      const shorterDistance = Math.round(skippedWorkout.distance_miles * 0.75 * 10) / 10;
      // Only if it would actually increase the workout
      if (shorterDistance > target.distance_miles) {
        adjustments.push({
          workoutId: target.id,
          adjustmentType: 'increase_distance',
          originalDistance: target.distance_miles,
          newDistance: shorterDistance,
          originalType: target.workout_type,
          newType: 'long',
          reason: `Rescheduled shortened long run (${shorterDistance}mi vs original ${skippedWorkout.distance_miles}mi) after skipping on ${skippedWorkout.date}.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
    // If no weekend day available, the long run is gone — accept lower volume
  }

  return adjustments;
}
