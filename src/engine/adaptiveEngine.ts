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
 *
 * @param recentRPEAvg - Average RPE from the last 4-7 runs (optional Strava data).
 *   High subjective effort (≥ 7) lowers thresholds even without HealthKit recovery data.
 */
export function checkACWRSafety(
  acwr: number,
  upcomingWorkouts: Workout[],
  today: string,
  recoveryStatus?: RecoveryStatus | null,
  recentRPEAvg?: number | null,
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

  // RPE-based threshold shifting — catches subjective fatigue even without HealthKit
  // High RPE (≥ 7 average) means the athlete is working harder than volume alone shows
  if (recentRPEAvg != null && (!recoveryStatus || recoveryStatus.signalCount < 2)) {
    if (recentRPEAvg >= 8) {
      convertThreshold = Math.min(convertThreshold, 1.2);
      reduceThreshold = Math.min(reduceThreshold, 1.4);
    } else if (recentRPEAvg >= 7) {
      convertThreshold = Math.min(convertThreshold, 1.25);
      reduceThreshold = Math.min(reduceThreshold, 1.45);
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
  stravaWorkoutType?: number | null; // 0=default, 1=race, 2=long run, 3=workout
}

/**
 * Extracts effective workout pace from Strava splits.
 * For tempo/threshold: uses median of "work" splits (excludes first and last mile as warmup/cooldown)
 * For intervals: uses laps data, taking faster half as "work" laps
 * For races: uses overall pace directly (most accurate for VDOT lookup)
 * Returns seconds per mile, or null if splits unavailable.
 */
export function extractEffectivePace(
  metric: PerformanceMetric,
  stravaDetail: any | null,
  workoutType: WorkoutType,
): number | null {
  if (!stravaDetail) return metric.avg_pace_per_mile || null;

  // Race: use overall finish pace
  const stravaWorkoutType = stravaDetail.strava_workout_type;
  if (stravaWorkoutType === 1) {
    return metric.avg_pace_per_mile || null;
  }

  // Tempo/Threshold/Marathon Pace: extract work splits (skip warmup/cooldown miles)
  if ((workoutType === 'tempo' || workoutType === 'marathon_pace') && stravaDetail.splits_json) {
    try {
      const splits = typeof stravaDetail.splits_json === 'string'
        ? JSON.parse(stravaDetail.splits_json)
        : stravaDetail.splits_json;
      if (splits.length >= 3) {
        const workSplits = splits.slice(1, -1);
        const paces = workSplits.map((s: any) => {
          const miles = s.distance / 1609.34;
          return miles > 0 ? s.movingTime / miles : null;
        }).filter((p: number | null) => p !== null) as number[];

        if (paces.length > 0) {
          paces.sort((a, b) => a - b);
          return Math.round(paces[Math.floor(paces.length / 2)]);
        }
      }
    } catch { /* fall through */ }
  }

  // Intervals: use laps, take faster half as "work" laps
  if (workoutType === 'interval' && stravaDetail.laps_json) {
    try {
      const laps = typeof stravaDetail.laps_json === 'string'
        ? JSON.parse(stravaDetail.laps_json)
        : stravaDetail.laps_json;
      if (laps.length >= 2) {
        const lapPaces = laps.map((l: any) => {
          const miles = l.distance / 1609.34;
          return { pace: miles > 0 ? l.movingTime / miles : 9999, distance: l.distance };
        });
        lapPaces.sort((a: any, b: any) => a.pace - b.pace);
        const workLaps = lapPaces.slice(0, Math.ceil(lapPaces.length / 2));
        if (workLaps.length > 0) {
          const avgWorkPace = workLaps.reduce((s: number, l: any) => s + l.pace, 0) / workLaps.length;
          return Math.round(avgWorkPace);
        }
      }
    } catch { /* fall through */ }
  }

  // Default: overall avg pace
  return metric.avg_pace_per_mile || null;
}

/**
 * Evaluate whether VDOT should be updated based on recent performance.
 *
 * With HR data (2+ weeks): +/- 1.0 VDOT, confidence "high"
 * Without HR (3+ weeks): +/- 0.5 VDOT, confidence "moderate"
 *
 * RPE improvements:
 * - Low RPE (≤ 5) on a fast effort = athlete is coasting → counts as HR evidence
 * - High RPE (≥ 8) on a fast effort = max effort, not adaptation → excluded
 * - Race-tagged workouts (stravaWorkoutType === 1) count immediately as high confidence
 */
export function evaluateVDOTUpdate(
  completedQualityWorkouts: WorkoutWithMetric[],
  currentVDOT: number,
  paceZones: PaceZones,
  hrZones: HRZones,
  recoveryStatus?: RecoveryStatus | null,
  stravaDetails?: Record<string, any>,
): VDOTUpdateResult | null {
  if (completedQualityWorkouts.length < 2) return null;

  // Recovery guard: skip VDOT update if poorly recovered (distorted performance)
  if (recoveryStatus && recoveryStatus.signalCount >= 2 && recoveryStatus.score < 40) {
    return null;
  }

  // Race check: a Strava-tagged race (stravaWorkoutType === 1) is a max-effort
  // timed performance — the strongest possible VDOT signal. One race is enough.
  for (const wm of completedQualityWorkouts) {
    if (wm.stravaWorkoutType === 1 && wm.metric.avg_pace_per_mile > 0) {
      const zone = wm.workout.target_pace_zone;
      const targetPace = paceZones[zone];
      if (targetPace) {
        const raceStravaDetail = stravaDetails?.[wm.metric.id] || null;
        const racePace = extractEffectivePace(wm.metric, raceStravaDetail, wm.workout.workout_type)
          || wm.metric.avg_pace_per_mile;
        const paceGap = targetPace.max - racePace;
        if (paceGap >= 10) {
          return {
            previousVDOT: currentVDOT,
            newVDOT: Math.round((currentVDOT + 1.0) * 10) / 10,
            reason: 'Race-effort run exceeded target pace — strong fitness signal',
            evidenceWorkouts: [wm.workout.id],
            confidenceLevel: 'high',
          };
        }
      }
    }
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

    const stravaDetail = stravaDetails?.[wm.metric.id] || null;
    const actualPace = extractEffectivePace(wm.metric, stravaDetail, wm.workout.workout_type)
      || wm.metric.avg_pace_per_mile;
    // targetPace.max = fastest expected pace (lowest seconds)
    // If actual is 10+ sec/mi faster than the fastest expected pace → overperforming
    const paceGap = targetPace.max - actualPace;

    const rpe: number | null = wm.metric.rpe_score ?? null;

    if (paceGap >= 10) {
      // High RPE (≥ 8) means athlete is maxing out — not an adaptation signal
      if (rpe != null && rpe >= 8) continue;

      if (wm.metric.avg_hr != null) {
        // HR in Zone 3-4 (not spiking to Zone 5) → confirmed adaptation
        if (wm.metric.avg_hr <= hrZones.zone4.max) {
          overperforming.push(wm);
        }
      } else if (rpe != null && rpe <= 5) {
        // No HR but RPE is low → athlete found it easy despite fast pace
        // Treat as equivalent to HR evidence
        overperforming.push({ ...wm, metric: { ...wm.metric, avg_hr: -1 } }); // sentinel to signal "has evidence"
      } else {
        // No HR or RPE — still count but needs more evidence
        overperforming.push(wm);
      }
    } else if (paceGap <= -10) {
      // 10+ sec/mi SLOWER than slowest expected pace
      if (wm.metric.avg_hr != null) {
        if (wm.metric.avg_hr > hrZones.zone4.max) {
          underperforming.push(wm);
        }
      } else if (rpe != null && rpe >= 8) {
        // High RPE on an already slow workout = struggling
        underperforming.push(wm);
      } else {
        underperforming.push(wm);
      }
    }
  }

  // Determine if we have enough evidence
  // Low RPE counts as equivalent to HR for evidence quality
  const withQualityEvidence = completedQualityWorkouts.filter(
    wm => wm.metric.avg_hr != null || (wm.metric.rpe_score != null && wm.metric.rpe_score <= 5)
  );
  const hasStrongEvidence = withQualityEvidence.length >= 2 || withHR.length >= 2;

  // With HR/RPE evidence: need 2+ consistent workouts over 2+ weeks
  // Without: need 3+ consistent workouts over 3+ weeks
  const requiredCount = hasStrongEvidence ? 2 : 3;
  const vdotDelta = hasStrongEvidence ? 1.0 : 0.5;
  const confidence = hasStrongEvidence ? 'high' as const : 'moderate' as const;

  // Check span covers enough weeks
  function spansEnoughWeeks(workouts: WorkoutWithMetric[], minWeeks: number): boolean {
    if (workouts.length < 2) return false;
    const dates = workouts.map(wm => new Date(wm.workout.date).getTime()).sort();
    const spanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
    return spanDays >= (minWeeks - 1) * 7;
  }

  const requiredWeeks = hasStrongEvidence ? 2 : 3;

  if (overperforming.length >= requiredCount && spansEnoughWeeks(overperforming, requiredWeeks)) {
    return {
      previousVDOT: currentVDOT,
      newVDOT: Math.round((currentVDOT + vdotDelta) * 10) / 10,
      reason: hasStrongEvidence
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
      reason: hasStrongEvidence
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

// ─── RPE Trend Analysis ──────────────────────────────────────

export interface RPETrend {
  trend: 'fatigued' | 'normal' | 'fresh';
  avgRPE: number;
  sampleSize: number;
}

/**
 * Assess subjective fatigue from recent Strava RPE scores.
 *
 * Uses the last 4-7 runs with RPE data. Strava RPE scale:
 *   1-3 = easy/light  4-6 = moderate  7-8 = hard  9-10 = max
 *
 * Returns 'fatigued' if avg ≥ 7 over 3+ runs (athlete is consistently
 * reporting high effort — a signal ACWR misses entirely since it's volume-only).
 */
export function assessRPETrend(metrics: PerformanceMetric[]): RPETrend {
  const withRPE = metrics
    .filter(m => m.rpe_score != null && m.rpe_score > 0)
    .slice(0, 7); // last 7 runs max

  if (withRPE.length === 0) {
    return { trend: 'normal', avgRPE: 0, sampleSize: 0 };
  }

  const avgRPE = withRPE.reduce((sum, m) => sum + (m.rpe_score ?? 0), 0) / withRPE.length;
  const rounded = Math.round(avgRPE * 10) / 10;

  let trend: RPETrend['trend'] = 'normal';
  if (withRPE.length >= 3 && avgRPE >= 7) {
    trend = 'fatigued';
  } else if (withRPE.length >= 3 && avgRPE <= 4) {
    trend = 'fresh';
  }

  return { trend, avgRPE: rounded, sampleSize: withRPE.length };
}
