/**
 * Training Load Engine — TRIMP calculator and PMC (Performance Management Chart).
 *
 * TRIMP (Training Impulse) = daily training stress score.
 * CTL (Chronic Training Load, 42-day EWMA) = fitness.
 * ATL (Acute Training Load, 7-day EWMA) = fatigue.
 * TSB (Training Stress Balance = yesterday's CTL - yesterday's ATL) = form.
 *
 * Three TRIMP methods, used based on data availability:
 *   1. HR-based (Bannister) — most accurate, needs avg HR + max/rest HR
 *   2. Pace-based — needs avg pace + VDOT pace zones
 *   3. Simple — distance × 10, always available as fallback
 */

import {
  TRIMPInput,
  TRIMPResult,
  TRIMPMethod,
  DailyTrainingLoad,
  PMCDayData,
  PMCData,
  PMCDataQuality,
  PaceZones,
  PaceZoneName,
  PerformanceMetric,
  Workout,
  UserProfile,
} from '../types';

// ─── TRIMP Calculator ─────────────────────────────────────────

/**
 * Calculate TRIMP for a single workout.
 * Automatically selects the best method based on available data.
 */
export function calculateTRIMP(input: TRIMPInput): TRIMPResult {
  const { durationMinutes, distanceMiles } = input;

  // Rest day or zero-duration workout
  if (durationMinutes <= 0 && distanceMiles <= 0) {
    return { score: 0, method: 'rest', intensity: 0 };
  }

  // Method 1: HR-based (Bannister TRIMP) — most accurate
  if (canUseHRMethod(input)) {
    return calculateHRBasedTRIMP(input);
  }

  // Method 2: Pace-based — good, needs pace zones
  if (canUsePaceMethod(input)) {
    return calculatePaceBasedTRIMP(input);
  }

  // Method 3: Simple fallback — distance only
  return calculateSimpleTRIMP(input);
}

// ─── Method 1: HR-Based (Bannister) ────────────────────────────

function canUseHRMethod(input: TRIMPInput): boolean {
  return (
    input.avgHR != null &&
    input.avgHR > 0 &&
    input.maxHR != null &&
    input.maxHR > 0 &&
    input.restHR != null &&
    input.restHR > 0 &&
    input.durationMinutes > 0
  );
}

/**
 * Bannister TRIMP:
 *   TRIMP = duration × HRratio × coefficient × e^(exponent × HRratio)
 *
 * Where HRratio = (avgHR - restHR) / (maxHR - restHR), clamped to [0, 1]
 *
 * Gender coefficients:
 *   Male:   coefficient = 0.64, exponent = 1.92
 *   Female: coefficient = 0.86, exponent = 1.67
 *
 * Typical outputs:
 *   Easy run (30 min, 65% HRR): ~40-60
 *   Threshold (40 min, 80% HRR): ~80-120
 *   Long run (120 min, 70% HRR): ~150-200+
 */
function calculateHRBasedTRIMP(input: TRIMPInput): TRIMPResult {
  const { durationMinutes, avgHR, maxHR, restHR, gender } = input;

  const hrRatio = Math.max(0, Math.min(1, (avgHR! - restHR!) / (maxHR! - restHR!)));

  // Gender-specific Bannister coefficients
  const coefficient = gender === 'male' ? 0.64 : 0.86;
  const exponent = gender === 'male' ? 1.92 : 1.67;

  const score = durationMinutes * hrRatio * coefficient * Math.exp(exponent * hrRatio);

  return {
    score: Math.round(score * 10) / 10,
    method: 'hr',
    intensity: hrRatio,
  };
}

// ─── Method 2: Pace-Based ──────────────────────────────────────

function canUsePaceMethod(input: TRIMPInput): boolean {
  return (
    input.avgPaceSecPerMile != null &&
    input.avgPaceSecPerMile > 0 &&
    input.paceZones != null &&
    input.durationMinutes > 0
  );
}

/**
 * Pace-based TRIMP:
 *   Determine which zone the avg pace falls in, apply a stress multiplier per minute.
 *
 * Zone multipliers:
 *   E (Easy):       0.7 per minute
 *   M (Marathon):   1.0 per minute
 *   T (Threshold):  1.4 per minute
 *   I (Interval):   1.8 per minute
 *   R (Repetition): 2.2 per minute
 */
function calculatePaceBasedTRIMP(input: TRIMPInput): TRIMPResult {
  const { durationMinutes, avgPaceSecPerMile, paceZones } = input;

  const zone = determinePaceZone(avgPaceSecPerMile!, paceZones!);
  const multiplier = ZONE_MULTIPLIERS[zone];

  const score = durationMinutes * multiplier;

  // Normalize intensity: E=0.3, M=0.5, T=0.7, I=0.85, R=1.0
  const intensityMap: Record<PaceZoneName, number> = {
    E: 0.3, M: 0.5, T: 0.7, I: 0.85, R: 1.0,
  };

  return {
    score: Math.round(score * 10) / 10,
    method: 'pace',
    intensity: intensityMap[zone],
  };
}

const ZONE_MULTIPLIERS: Record<PaceZoneName, number> = {
  E: 0.7,
  M: 1.0,
  T: 1.4,
  I: 1.8,
  R: 2.2,
};

/**
 * Determine which pace zone the avg pace falls in.
 * Pace zones have min (slower) and max (faster) in sec/mile.
 * A lower sec/mile = faster. We check from fastest (R) to slowest (E).
 */
function determinePaceZone(avgPaceSecPerMile: number, zones: PaceZones): PaceZoneName {
  // R zone: faster than or equal to R.min (R.max is fastest, R.min is slowest of R zone)
  if (avgPaceSecPerMile <= zones.R.min) return 'R';
  // I zone: between I.max (fastest) and I.min (slowest)
  if (avgPaceSecPerMile <= zones.I.min) return 'I';
  // T zone
  if (avgPaceSecPerMile <= zones.T.min) return 'T';
  // M zone
  if (avgPaceSecPerMile <= zones.M.min) return 'M';
  // Everything else is Easy
  return 'E';
}

// ─── Method 3: Simple (Distance-Based) ─────────────────────────

/**
 * Simple TRIMP = distance_miles × 10.
 * Rough estimate when no HR or pace data available.
 */
function calculateSimpleTRIMP(input: TRIMPInput): TRIMPResult {
  const { distanceMiles, durationMinutes } = input;

  // Use distance if available, otherwise rough duration estimate
  const score = distanceMiles > 0
    ? distanceMiles * 10
    : durationMinutes * 0.5; // ~30 for a 60 min unknown workout

  // Estimate intensity from pace if possible, otherwise default 0.4
  let intensity = 0.4;
  if (distanceMiles > 0 && durationMinutes > 0) {
    const paceMinPerMile = durationMinutes / distanceMiles;
    // Rough: 12+ min/mi = very easy (0.2), 6 min/mi = very hard (0.9)
    intensity = Math.max(0.1, Math.min(1.0, 1.0 - (paceMinPerMile - 6) / 8));
  }

  return {
    score: Math.round(score * 10) / 10,
    method: 'simple',
    intensity,
  };
}

// ═══════════════════════════════════════════════════════════════
// PMC Engine — CTL / ATL / TSB
// ═══════════════════════════════════════════════════════════════

// ─── Constants ────────────────────────────────────────────────

const CTL_CONSTANT = 42; // days — chronic / fitness
const ATL_CONSTANT = 7;  // days — acute / fatigue

// ─── Date helpers ─────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(s: string): Date {
  return new Date(s + 'T12:00:00'); // noon to avoid timezone edge cases
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ─── buildDailyTrimps ─────────────────────────────────────────

/**
 * Bridge real performance_metric data to the PMC engine.
 *
 * Generates an array of ALL dates from startDate to endDate,
 * calculates TRIMP for each day from available metrics.
 * Days with multiple workouts (doubles) sum their TRIMPs.
 */
export function buildDailyTrimps(
  metrics: PerformanceMetric[],
  startDate: string,
  endDate: string,
  profile: { maxHR: number | null; restHR: number | null; gender: 'male' | 'female' },
  paceZones: PaceZones | null,
): DailyTrainingLoad[] {
  // Group metrics by date
  const byDate = new Map<string, PerformanceMetric[]>();
  for (const m of metrics) {
    if (!m.date || m.distance_miles < 0) continue; // skip garbled data
    const existing = byDate.get(m.date) ?? [];
    existing.push(m);
    byDate.set(m.date, existing);
  }

  // Generate all dates in range
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const totalDays = daysBetween(start, end) + 1;
  const result: DailyTrainingLoad[] = [];

  for (let i = 0; i < totalDays; i++) {
    const date = toDateStr(addDays(start, i));
    const dayMetrics = byDate.get(date);

    if (!dayMetrics || dayMetrics.length === 0) {
      result.push({ date, trimp: 0, method: 'rest', workoutCount: 0, workoutTypes: [] });
      continue;
    }

    // Calculate TRIMP for each workout on this day, sum them
    let totalTrimp = 0;
    let bestMethod: TRIMPMethod = 'rest';
    const workoutTypes: string[] = [];

    for (const m of dayMetrics) {
      const trimpResult = calculateTRIMP({
        durationMinutes: m.duration_minutes ?? 0,
        distanceMiles: m.distance_miles ?? 0,
        avgHR: m.avg_hr,
        maxHR: profile.maxHR,
        restHR: profile.restHR,
        gender: profile.gender,
        avgPaceSecPerMile: m.avg_pace_sec_per_mile,
        paceZones,
      });

      totalTrimp += trimpResult.score;

      // Best method = highest priority used across day's workouts
      if (methodPriority(trimpResult.method) > methodPriority(bestMethod)) {
        bestMethod = trimpResult.method;
      }

      // Try to infer workout type from strava_workout_type or linked workout
      workoutTypes.push(inferWorkoutType(m));
    }

    result.push({
      date,
      trimp: Math.round(totalTrimp * 10) / 10,
      method: bestMethod,
      workoutCount: dayMetrics.length,
      workoutTypes,
    });
  }

  return result;
}

function methodPriority(m: TRIMPMethod): number {
  switch (m) {
    case 'hr': return 3;
    case 'pace': return 2;
    case 'simple': return 1;
    default: return 0;
  }
}

function inferWorkoutType(m: PerformanceMetric): string {
  // Strava workout types: 0=default, 1=race, 2=long run, 3=workout
  if (m.strava_workout_type === 1) return 'race';
  if (m.strava_workout_type === 2) return 'long_run';
  if (m.strava_workout_type === 3) return 'workout';
  // Rough heuristic from distance
  if (m.distance_miles >= 13) return 'long_run';
  if (m.distance_miles >= 8) return 'moderate';
  return 'easy';
}

// ─── calculatePMC ─────────────────────────────────────────────

/**
 * Calculate CTL / ATL / TSB from daily TRIMP values.
 *
 * For each day:
 *   TSB = yesterday's CTL - yesterday's ATL   (BEFORE today's workout)
 *   CTL_today = CTL_yesterday + (TRIMP_today - CTL_yesterday) / 42
 *   ATL_today = ATL_yesterday + (TRIMP_today - ATL_yesterday) / 7
 */
export function calculatePMC(
  dailyTrimps: DailyTrainingLoad[],
  startingCTL: number = 0,
  startingATL: number = 0,
): PMCDayData[] {
  const result: PMCDayData[] = [];
  let ctl = startingCTL;
  let atl = startingATL;

  for (const day of dailyTrimps) {
    // TSB uses YESTERDAY's values (before today's workout is applied)
    const tsb = ctl - atl;

    // EWMA update
    ctl = ctl + (day.trimp - ctl) / CTL_CONSTANT;
    atl = atl + (day.trimp - atl) / ATL_CONSTANT;

    result.push({
      date: day.date,
      trimp: day.trimp,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      workoutCount: day.workoutCount,
      workoutTypes: day.workoutTypes,
      method: day.method,
      isProjected: false,
    });
  }

  return result;
}

// ─── projectToRaceDay ─────────────────────────────────────────

/**
 * Project CTL/ATL/TSB forward from today to race day using planned workouts.
 *
 * Estimates future daily TRIMPs from planned workout distances + types,
 * then continues the EWMA calculation forward.
 */
export function projectToRaceDay(
  currentCTL: number,
  currentATL: number,
  todayStr: string,
  raceDateStr: string,
  futureWorkouts: Workout[],
  paceZones: PaceZones | null,
): PMCDayData[] {
  const today = parseDate(todayStr);
  const raceDay = parseDate(raceDateStr);
  const daysToProject = daysBetween(today, raceDay);

  if (daysToProject <= 0) return [];

  // Group future workouts by date
  const byDate = new Map<string, Workout[]>();
  for (const w of futureWorkouts) {
    if (w.workout_type === 'rest' || !w.scheduled_date) continue;
    const existing = byDate.get(w.scheduled_date) ?? [];
    existing.push(w);
    byDate.set(w.scheduled_date, existing);
  }

  const result: PMCDayData[] = [];
  let ctl = currentCTL;
  let atl = currentATL;

  for (let i = 1; i <= daysToProject; i++) {
    const date = toDateStr(addDays(today, i));
    const dayWorkouts = byDate.get(date);

    let trimp = 0;
    const workoutTypes: string[] = [];

    if (dayWorkouts) {
      for (const w of dayWorkouts) {
        trimp += estimateFutureTrimp(w, paceZones);
        workoutTypes.push(w.workout_type);
      }
    }

    const tsb = ctl - atl;
    ctl = ctl + (trimp - ctl) / CTL_CONSTANT;
    atl = atl + (trimp - atl) / ATL_CONSTANT;

    result.push({
      date,
      trimp: Math.round(trimp * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      workoutCount: dayWorkouts?.length ?? 0,
      workoutTypes,
      method: 'simple',
      isProjected: true,
    });
  }

  return result;
}

/**
 * Estimate TRIMP for a planned workout that hasn't happened yet.
 * Uses target distance × zone multiplier approach.
 */
function estimateFutureTrimp(workout: Workout, paceZones: PaceZones | null): number {
  const dist = workout.target_distance_miles ?? 0;
  if (dist <= 0) return 0;

  // Estimate duration from distance and workout type
  // (assume ~9 min/mile for easy, ~8 for marathon, ~7.5 for threshold)
  const paceEstimates: Record<string, number> = {
    easy: 9, recovery: 9.5, long_run: 9.2, long: 9.2,
    marathon_pace: 8, tempo: 7.5, threshold: 7.5,
    interval: 7, intervals: 7, repetition: 6.5,
  };
  const paceMin = paceEstimates[workout.workout_type] ?? 9;
  const durationMin = dist * paceMin;

  // Zone multiplier from workout type
  const zoneMap: Record<string, PaceZoneName> = {
    easy: 'E', recovery: 'E', long_run: 'E', long: 'E',
    marathon_pace: 'M', tempo: 'T', threshold: 'T',
    interval: 'I', intervals: 'I', repetition: 'R',
  };
  const zone = zoneMap[workout.workout_type] ?? 'E';
  const multiplier = ZONE_MULTIPLIERS[zone];

  return Math.round(durationMin * multiplier * 10) / 10;
}

// ─── buildFullPMC ─────────────────────────────────────────────

/**
 * Full PMC pipeline: metrics → daily TRIMPs → CTL/ATL/TSB → projection → PMCData.
 *
 * This is the main entry point for the store to call.
 */
export function buildFullPMC(
  metrics: PerformanceMetric[],
  profile: UserProfile,
  paceZones: PaceZones | null,
  planStartDate: string,
  todayStr: string,
  raceDateStr: string,
  futureWorkouts: Workout[],
): PMCData {
  // 1. Build daily TRIMPs from historical data
  const dailyTrimps = buildDailyTrimps(
    metrics,
    planStartDate,
    todayStr,
    { maxHR: profile.max_hr, restHR: profile.rest_hr, gender: profile.gender },
    paceZones,
  );

  // 2. Calculate PMC (CTL/ATL/TSB) for historical period
  const historicalPMC = calculatePMC(dailyTrimps);

  // 3. Get current values (last day)
  const lastDay = historicalPMC.length > 0
    ? historicalPMC[historicalPMC.length - 1]
    : { ctl: 0, atl: 0, tsb: 0 };

  // 4. Project forward to race day
  const projectedPMC = projectToRaceDay(
    lastDay.ctl,
    lastDay.atl,
    todayStr,
    raceDateStr,
    futureWorkouts,
    paceZones,
  );

  // 5. Combine historical + projected
  const allDays = [...historicalPMC, ...projectedPMC];

  // 6. Find peak CTL
  let peakCTL = 0;
  let peakCTLDate: string | null = null;
  for (const day of allDays) {
    if (day.ctl > peakCTL) {
      peakCTL = day.ctl;
      peakCTLDate = day.date;
    }
  }

  // 7. Race day projection
  const raceDayData = projectedPMC.length > 0
    ? projectedPMC[projectedPMC.length - 1]
    : null;

  // 8. Data quality assessment
  const workoutDays = dailyTrimps.filter(d => d.workoutCount > 0);
  const hrDays = workoutDays.filter(d => d.method === 'hr').length;
  const hrPercent = workoutDays.length > 0 ? (hrDays / workoutDays.length) * 100 : 0;

  let dataQuality: PMCDataQuality;
  if (hrPercent >= 70) dataQuality = 'high';
  else if (hrPercent >= 30) dataQuality = 'moderate';
  else dataQuality = 'low';

  return {
    daily: allDays,
    currentCTL: lastDay.ctl,
    currentATL: lastDay.atl,
    currentTSB: lastDay.ctl - lastDay.atl, // TSB = CTL - ATL (current moment)
    peakCTL,
    peakCTLDate,
    raceDayTSB: raceDayData?.tsb ?? null,
    raceDayProjectedCTL: raceDayData?.ctl ?? null,
    dataQuality,
    hrMethodPercent: Math.round(hrPercent),
    totalDays: historicalPMC.length,
    projectedDays: projectedPMC.length,
  };
}
