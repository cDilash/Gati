import {
  PlanGeneratorConfig,
  GeneratedPlan,
  TrainingPlan,
  TrainingWeek,
  Workout,
  IntervalStep,
  Phase,
  WorkoutType,
  PaceZoneName,
  UserProfile,
} from '../types';
import * as Crypto from 'expo-crypto';

const uuid = () => Crypto.randomUUID();

/** Parse a YYYY-MM-DD string as local midnight (not UTC). */
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/** Format a Date as YYYY-MM-DD in local timezone. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Generate a full marathon training plan using a 5-step macrocycle algorithm:
 *
 * 1. Initialization — compute total weeks, peak volume, phase distribution
 * 2. Volume Interpolation — sigmoid ramp with cutback weeks and 12% cap
 * 3. Long Run Distribution — progressive long runs capped by level
 * 4. Quality Sessions — phase-appropriate workouts (MP, tempo, intervals)
 * 5. Fill — distribute remaining volume as easy/recovery runs
 */
export function generatePlan(config: PlanGeneratorConfig): GeneratedPlan {
  // -----------------------------------------------------------------------
  // Step 1: Initialization
  // -----------------------------------------------------------------------
  // Snap start date to previous Monday so day_of_week labels are correct
  // (day_of_week 0 = Mon, 1 = Tue, ..., 6 = Sun)
  // IMPORTANT: Use local-midnight parsing to avoid UTC timezone shift
  const rawStart = parseLocalDate(config.startDate);
  const jsDay = rawStart.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToSubtract = jsDay === 0 ? 6 : jsDay - 1; // Mon=0, Tue=1, ..., Sun=6
  const startDate = new Date(rawStart);
  startDate.setDate(startDate.getDate() - daysToSubtract);

  const raceDate = parseLocalDate(config.raceDate);
  const totalWeeks = Math.floor(
    (raceDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const vStart = config.currentWeeklyMileage;
  const levelCaps: Record<string, number> = {
    beginner: 40,
    intermediate: 55,
    advanced: 80,
  };
  const vPeak = Math.min(
    config.currentWeeklyMileage * 1.5,
    levelCaps[config.level]
  );

  const taperWeeks = 3;
  const buildWeeks = totalWeeks - taperWeeks;

  // Phase distribution (of build weeks)
  const baseWeeks = Math.floor(buildWeeks * 0.35);
  const buildPhaseWeeks = Math.floor(buildWeeks * 0.35);
  // peakWeeks is the remainder
  // const peakWeeks = buildWeeks - baseWeeks - buildPhaseWeeks;

  // -----------------------------------------------------------------------
  // Step 2: Volume Interpolation with sigmoid
  // -----------------------------------------------------------------------
  const weeklyVolumes: number[] = [];
  for (let w = 0; w < buildWeeks; w++) {
    const t = buildWeeks > 1 ? w / (buildWeeks - 1) : 1; // 0 to 1
    const sigmoid = 1 / (1 + Math.exp(-12 * (t - 0.4)));
    let volume = vStart + (vPeak - vStart) * sigmoid;

    // Enforce max 12% week-over-week increase
    if (w > 0 && volume > weeklyVolumes[w - 1] * 1.12) {
      volume = weeklyVolumes[w - 1] * 1.12;
    }

    // Cutback every 4th week (20% reduction)
    const isCutback = (w + 1) % 4 === 0;
    if (isCutback) {
      volume = volume * 0.8;
    }

    weeklyVolumes.push(Math.round(volume * 10) / 10);
  }

  // Add taper weeks: 75%, 50%, 25% of peak
  const actualPeak = Math.max(...weeklyVolumes);
  weeklyVolumes.push(Math.round(actualPeak * 0.75 * 10) / 10);
  weeklyVolumes.push(Math.round(actualPeak * 0.5 * 10) / 10);
  weeklyVolumes.push(Math.round(actualPeak * 0.25 * 10) / 10);

  // -----------------------------------------------------------------------
  // Build the plan, weeks, and workouts
  // -----------------------------------------------------------------------
  const now = new Date().toISOString();
  const planId = uuid();
  const plan: TrainingPlan = {
    id: planId,
    start_date: config.startDate,
    race_date: config.raceDate,
    total_weeks: totalWeeks,
    peak_weekly_mileage: actualPeak,
    vdot_at_creation: config.vdot,
    created_at: now,
    updated_at: now,
  };

  const weeks: TrainingWeek[] = [];
  const allWorkouts: Workout[] = [];

  for (let w = 0; w < totalWeeks; w++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    let phase: Phase;
    if (w >= totalWeeks - taperWeeks) {
      phase = 'taper';
    } else if (w < baseWeeks) {
      phase = 'base';
    } else if (w < baseWeeks + buildPhaseWeeks) {
      phase = 'build';
    } else {
      phase = 'peak';
    }

    const isCutback = phase !== 'taper' && (w + 1) % 4 === 0;
    const weekVolume = weeklyVolumes[w];

    const weekId = uuid();
    const week: TrainingWeek = {
      id: weekId,
      plan_id: planId,
      week_number: w + 1,
      phase,
      is_cutback: isCutback,
      target_volume_miles: weekVolume,
      actual_volume_miles: 0,
      start_date: formatLocalDate(weekStart),
      end_date: formatLocalDate(weekEnd),
    };
    weeks.push(week);

    // -----------------------------------------------------------------
    // Step 3: Long Run Distribution
    // -----------------------------------------------------------------
    const maxLongRun =
      config.level === 'beginner'
        ? 16
        : config.level === 'intermediate'
          ? 22
          : 24;
    let longRunDistance: number;

    if (phase === 'taper') {
      const taperWeekIndex = w - (totalWeeks - taperWeeks);
      const taperMultipliers = [0.7, 0.5, 0.3];
      longRunDistance = Math.min(
        actualPeak * 0.3 * taperMultipliers[taperWeekIndex],
        maxLongRun
      );
    } else {
      const progressionRatio = w / buildWeeks;
      longRunDistance =
        config.longestRecentRun +
        progressionRatio * (maxLongRun - config.longestRecentRun);
      longRunDistance = Math.min(longRunDistance, weekVolume * 0.3, maxLongRun);
      if (isCutback) longRunDistance *= 0.75;
    }
    longRunDistance = Math.round(longRunDistance * 10) / 10;
    longRunDistance = Math.max(longRunDistance, 3); // min 3 miles

    // -----------------------------------------------------------------
    // Step 4: Quality Sessions
    // -----------------------------------------------------------------
    const qualityWorkouts: {
      type: WorkoutType;
      distance: number;
      zone: PaceZoneName;
      intervals?: IntervalStep[];
    }[] = [];

    if (!isCutback && phase !== 'taper') {
      if (phase === 'base') {
        // Marathon pace segment
        const mpDistance = Math.min(weekVolume * 0.1, 10);
        if (mpDistance >= 3) {
          const warmup = 1.5;
          const cooldown = 1.5;
          const workDistance = Math.max(mpDistance - warmup - cooldown, 1);
          qualityWorkouts.push({
            type: 'marathon_pace',
            distance: Math.round(mpDistance * 10) / 10,
            zone: 'M',
            intervals: [
              {
                type: 'warmup',
                distance_miles: warmup,
                pace_zone: 'E',
                description: 'Easy warmup',
              },
              {
                type: 'work',
                distance_miles: Math.round(workDistance * 10) / 10,
                pace_zone: 'M',
                description: 'Marathon pace',
              },
              {
                type: 'cooldown',
                distance_miles: cooldown,
                pace_zone: 'E',
                description: 'Easy cooldown',
              },
            ],
          });
        }
      }

      if (phase === 'build' || phase === 'peak') {
        // Threshold session
        const thresholdCap = weekVolume * 0.1;
        const thresholdDistance = Math.min(thresholdCap, 8);
        if (thresholdDistance >= 3) {
          const warmup = 1.5;
          const cooldown = 1.5;
          const workDistance = Math.max(thresholdDistance - warmup - cooldown, 1);
          const reps = Math.max(Math.floor(workDistance), 1);
          const repDistance =
            Math.round((workDistance / reps) * 10) / 10;
          const intervals: IntervalStep[] = [
            {
              type: 'warmup',
              distance_miles: warmup,
              pace_zone: 'E',
              description: 'Easy warmup',
            },
          ];
          for (let r = 0; r < reps; r++) {
            intervals.push({
              type: 'work',
              distance_miles: repDistance,
              pace_zone: 'T',
              description: `Mile rep ${r + 1} at threshold`,
            });
            if (r < reps - 1) {
              intervals.push({
                type: 'recovery',
                distance_miles: 0.25,
                pace_zone: 'E',
                description: 'Recovery jog',
              });
            }
          }
          intervals.push({
            type: 'cooldown',
            distance_miles: cooldown,
            pace_zone: 'E',
            description: 'Easy cooldown',
          });

          const totalDist = intervals.reduce(
            (sum, i) => sum + i.distance_miles,
            0
          );
          qualityWorkouts.push({
            type: 'tempo',
            distance: Math.round(totalDist * 10) / 10,
            zone: 'T',
            intervals,
          });
        }
      }

      if (phase === 'peak') {
        // VO2max intervals
        const intervalCap = weekVolume * 0.08;
        const intervalDistance = Math.min(intervalCap, 7);
        if (intervalDistance >= 3) {
          const warmup = 1.5;
          const cooldown = 1.5;
          const workDistance = Math.max(intervalDistance - warmup - cooldown, 1);
          const reps = Math.max(Math.round(workDistance / 0.5), 2); // 800m reps
          const repDist = 0.5; // ~800m
          const intervals: IntervalStep[] = [
            {
              type: 'warmup',
              distance_miles: warmup,
              pace_zone: 'E',
              description: 'Easy warmup',
            },
          ];
          for (let r = 0; r < reps; r++) {
            intervals.push({
              type: 'work',
              distance_miles: repDist,
              pace_zone: 'I',
              description: `800m rep ${r + 1} at interval pace`,
            });
            if (r < reps - 1) {
              intervals.push({
                type: 'recovery',
                distance_miles: 0.25,
                pace_zone: 'E',
                description: 'Recovery jog',
              });
            }
          }
          intervals.push({
            type: 'cooldown',
            distance_miles: cooldown,
            pace_zone: 'E',
            description: 'Easy cooldown',
          });

          const totalDist = intervals.reduce(
            (sum, i) => sum + i.distance_miles,
            0
          );
          qualityWorkouts.push({
            type: 'interval',
            distance: Math.round(totalDist * 10) / 10,
            zone: 'I',
            intervals,
          });
        }
      }
    }

    // -----------------------------------------------------------------
    // Step 5: Fill remaining volume with easy/recovery
    // -----------------------------------------------------------------
    const qualityVolume =
      longRunDistance +
      qualityWorkouts.reduce((sum, q) => sum + q.distance, 0);
    let remainingVolume = Math.max(weekVolume - qualityVolume, 0);

    // Determine available days for scheduling
    const longRunDay = config.preferredLongRunDay;
    const dayAfterLong = (longRunDay + 1) % 7;

    // Assign workouts to days
    const dayWorkouts: Map<
      number,
      {
        type: WorkoutType;
        distance: number;
        zone: PaceZoneName;
        intervals?: IntervalStep[];
      }
    > = new Map();

    // Place long run
    dayWorkouts.set(longRunDay, {
      type: 'long',
      distance: longRunDistance,
      zone: 'E',
    });

    // Place recovery after long run
    const recoveryDistance = Math.min(
      remainingVolume,
      Math.max(3, remainingVolume * 0.2)
    );
    if (config.availableDays.includes(dayAfterLong) && remainingVolume >= 3) {
      dayWorkouts.set(dayAfterLong, {
        type: 'recovery',
        distance: Math.round(recoveryDistance * 10) / 10,
        zone: 'E',
      });
      remainingVolume -= recoveryDistance;
    }

    // Place quality workouts on available midweek days
    const qualityDays = config.availableDays.filter(
      (d) => d !== longRunDay && d !== dayAfterLong
    );
    for (
      let q = 0;
      q < qualityWorkouts.length && q < qualityDays.length;
      q++
    ) {
      dayWorkouts.set(qualityDays[q], qualityWorkouts[q]);
      // Quality volume already subtracted via qualityVolume calculation
    }

    // Fill remaining easy runs — always leave at least 1 rest day (cap at availableDays.length - 1)
    const easyDays = config.availableDays.filter((d) => !dayWorkouts.has(d));
    const maxMoreRuns = Math.max(config.availableDays.length - 1 - dayWorkouts.size, 0);
    if (remainingVolume >= 3 && easyDays.length > 0 && maxMoreRuns > 0) {
      const runsNeeded = Math.min(
        easyDays.length,
        maxMoreRuns,
        Math.floor(remainingVolume / 3)
      );
      const perRun = remainingVolume / Math.max(runsNeeded, 1);
      for (let i = 0; i < runsNeeded; i++) {
        const dist = Math.max(Math.round(perRun * 10) / 10, 3);
        dayWorkouts.set(easyDays[i], {
          type: 'easy',
          distance: dist,
          zone: 'E',
        });
      }
    }

    // Create Workout objects for each day of the week
    for (let d = 0; d < 7; d++) {
      const workoutDate = new Date(weekStart);
      workoutDate.setDate(workoutDate.getDate() + d);
      const dateStr = formatLocalDate(workoutDate);

      const scheduled = dayWorkouts.get(d);
      const workout: Workout = {
        id: uuid(),
        week_id: weekId,
        date: dateStr,
        day_of_week: d,
        workout_type: scheduled?.type || 'rest',
        distance_miles: scheduled?.distance || 0,
        target_pace_zone: scheduled?.zone || 'E',
        intervals: scheduled?.intervals,
        intervals_json: scheduled?.intervals
          ? JSON.stringify(scheduled.intervals)
          : undefined,
        status: 'scheduled',
        notes: '',
        created_at: now,
        updated_at: now,
      };
      allWorkouts.push(workout);
    }
  }

  return { plan, weeks, workouts: allWorkouts };
}

/** Generate a human-readable summary of a training plan. */
export function summarizePlan(
  plan: TrainingPlan,
  weeks: TrainingWeek[],
  workouts: Workout[]
): string {
  const lines: string[] = [];
  lines.push(`Training Plan: ${plan.total_weeks} weeks`);
  lines.push(`Race Date: ${plan.race_date}`);
  lines.push(`Peak Volume: ${plan.peak_weekly_mileage} miles/week`);
  lines.push(`VDOT: ${plan.vdot_at_creation}`);
  lines.push('');

  for (const week of weeks) {
    const weekWorkouts = workouts.filter(
      (w) => w.week_id === week.id && w.workout_type !== 'rest'
    );
    const completed = weekWorkouts.filter(
      (w) => w.status === 'completed'
    ).length;
    const total = weekWorkouts.length;
    const cutbackTag = week.is_cutback ? ' [CUTBACK]' : '';
    lines.push(
      `Week ${week.week_number} (${week.phase}${cutbackTag}): ${week.target_volume_miles}mi target, ${completed}/${total} completed`
    );
  }

  return lines.join('\n');
}

/**
 * Generates a new plan anchored to the runner's current fitness,
 * not their original profile inputs. Used when trajectory has shifted.
 *
 * V_start = actual recent mileage (not profile.current_weekly_mileage)
 * VDOT = current (possibly updated)
 * startDate = next Monday from today
 * Race date, available days, long run day = unchanged from profile
 *
 * Returns null if < 2 weeks remain before race.
 */
export function replanFromCurrentState(
  profile: UserProfile,
  currentVDOT: number,
  actualRecentMileage: number,
  today: string,
): GeneratedPlan | null {
  // Calculate next Monday
  const todayDate = new Date(today + 'T00:00:00');
  const dayOfWeek = todayDate.getDay(); // 0=Sun
  // Always start next Monday (even if today is Monday — keep current week intact)
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : (8 - dayOfWeek);
  const nextMonday = new Date(todayDate);
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  const startDate = formatLocalDate(nextMonday);

  // Check minimum weeks remaining
  const raceDate = new Date(profile.race_date + 'T00:00:00');
  const msRemaining = raceDate.getTime() - nextMonday.getTime();
  const weeksRemaining = Math.floor(msRemaining / (7 * 24 * 60 * 60 * 1000));

  if (weeksRemaining < 2) {
    return null; // Too close to race — refuse replan
  }

  // < 4 weeks: generate taper-only plan (no base/build/peak phases)
  if (weeksRemaining < 4) {
    const availableDaysParsed = typeof profile.available_days === 'string'
      ? JSON.parse(profile.available_days)
      : profile.available_days;
    // Use reduced mileage with forced taper multipliers
    const taperMileage = Math.max(actualRecentMileage * 0.75, 10);
    return generatePlan({
      startDate,
      raceDate: profile.race_date,
      currentWeeklyMileage: taperMileage,
      longestRecentRun: Math.min(Math.round(taperMileage * 0.3), 16),
      level: profile.level,
      vdot: currentVDOT,
      availableDays: availableDaysParsed,
      preferredLongRunDay: profile.preferred_long_run_day,
    });
  }

  // Parse available_days (stored as JSON string or number[])
  const availableDays = typeof profile.available_days === 'string'
    ? JSON.parse(profile.available_days)
    : profile.available_days;

  return generatePlan({
    startDate,
    raceDate: profile.race_date,
    currentWeeklyMileage: Math.max(actualRecentMileage, 10), // floor at 10mi
    longestRecentRun: Math.round(actualRecentMileage * 0.3), // estimate from recent volume
    level: profile.level,
    vdot: currentVDOT,
    availableDays,
    preferredLongRunDay: profile.preferred_long_run_day,
  });
}
